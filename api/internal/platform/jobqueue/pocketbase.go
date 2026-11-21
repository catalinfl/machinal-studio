package jobqueue

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

type StoreError struct {
	Status  int
	Action  string
	Message string
}

func (e *StoreError) Error() string {
	message := "job store"
	if e.Action != "" {
		message += " " + e.Action
	}
	message += fmt.Sprintf(" returned HTTP %d", e.Status)
	if e.Message != "" {
		message += fmt.Sprintf(": %q", e.Message)
	}
	return message
}

const maxStoreErrorBytes = 8 << 10

type PocketBase struct {
	Base   string
	Token  string
	Client *http.Client
}

func PocketBaseFromEnv() *PocketBase {
	return &PocketBase{Base: strings.TrimRight(strings.TrimSpace(os.Getenv("POCKETBASE_URL")), "/"),
		Token: strings.TrimSpace(os.Getenv("PB_SERVICE_TOKEN")), Client: &http.Client{Timeout: storeTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (s *PocketBase) request(ctx context.Context, action string, input, output any) error {
	return s.requestJSON(ctx, http.MethodPost, "/api/direction/jobs/"+action, action, input, output)
}

func (s *PocketBase) requestJSON(ctx context.Context, method, path, action string, input, output any) error {
	if s.Base == "" || s.Token == "" {
		return &StoreError{Status: http.StatusServiceUnavailable, Action: action}
	}
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return fmt.Errorf("encode job %s: %w", action, err)
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.Base+path, body)
	if err != nil {
		return fmt.Errorf("build job %s: %w", action, err)
	}
	req.Header.Set("Authorization", "Bearer "+s.Token)
	req.Header.Set("Content-Type", "application/json")
	response, err := s.Client.Do(req)
	if err != nil {
		return fmt.Errorf("request job %s: %w", action, err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		switch action {
		case "get", "cancel", "start", "heartbeat", "finish", "metadata":
			return ErrNotFound
		default:
			return s.responseError(response, action)
		}
	}
	if response.StatusCode == http.StatusPreconditionFailed {
		return ErrLeaseLost
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return s.responseError(response, action)
	}
	if output == nil || response.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 3*MaxResultBytes)).Decode(output); err != nil {
		return fmt.Errorf("decode job %s: %w", action, err)
	}
	return nil
}

func (s *PocketBase) responseError(response *http.Response, action string) error {
	rejected := &StoreError{Status: response.StatusCode, Action: action}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxStoreErrorBytes)).Decode(&body); err == nil {
		rejected.Message = strings.ReplaceAll(body.Message, s.Token, "[redacted]")
	}
	return rejected
}

func (s *PocketBase) requestJob(ctx context.Context, action string, input any) (Job, error) {
	var result Job
	if err := s.request(ctx, action, input, &result); err != nil {
		return Job{}, err
	}
	return s.restoreJob(ctx, result)
}

func (s *PocketBase) requestJobs(ctx context.Context, action string, input any) ([]Job, error) {
	var result []Job
	if err := s.request(ctx, action, input, &result); err != nil {
		return nil, err
	}
	for i := range result {
		job, err := s.restoreJob(ctx, result[i])
		if err != nil {
			return nil, err
		}
		result[i] = job
	}
	return result, nil
}

func (s *PocketBase) Enqueue(ctx context.Context, job Job) (Job, error) {
	var result Job
	if err := s.request(ctx, "enqueue", encodeStoredJob(job), &result); err != nil {
		return Job{}, err
	}
	// Acceptance must not depend on a second read: a read rejection could otherwise
	// remove an input file that a successfully queued worker already needs.
	result.Kind, result.Input = job.Kind, job.Input
	result.Input.Payload = result.ID
	return result, nil
}

func scope(owner, session, id string) map[string]any {
	return map[string]any{"owner": owner, "session": session, "id": id}
}

func (s *PocketBase) Get(ctx context.Context, owner, session, id string) (Job, error) {
	return s.requestJob(ctx, "get", scope(owner, session, id))
}

func (s *PocketBase) List(ctx context.Context, owner, session string) ([]Job, error) {
	return s.requestJobs(ctx, "list", scope(owner, session, ""))
}

func (s *PocketBase) Claim(ctx context.Context, lease string) (*Job, error) {
	var result *Job
	err := s.request(ctx, "claim", map[string]string{"lease": lease}, &result)
	if err != nil {
		return nil, err
	}
	if result != nil {
		*result, err = s.restoreJob(ctx, *result)
	}
	return result, err
}

func (s *PocketBase) Active(ctx context.Context) ([]Job, error) {
	return s.requestJobs(ctx, "active", map[string]any{})
}

func (s *PocketBase) Start(ctx context.Context, job Job) (Job, error) {
	return s.requestJob(ctx, "start", map[string]string{"id": job.ID, "lease": job.Lease})
}

func (s *PocketBase) Heartbeat(ctx context.Context, job Job, update Update) (Job, error) {
	return s.requestJob(ctx, "heartbeat", map[string]any{"id": job.ID, "lease": job.Lease, "update": update})
}

func (s *PocketBase) Finish(ctx context.Context, job Job, result Result) error {
	return s.request(ctx, "finish", map[string]any{"id": job.ID, "lease": job.Lease, "output": result}, nil)
}

func (s *PocketBase) Cancel(ctx context.Context, owner, session, id string) (Job, error) {
	return s.requestJob(ctx, "cancel", scope(owner, session, id))
}
