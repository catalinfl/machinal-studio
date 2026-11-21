package jobqueue

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"ffmpeg-go-server/internal/platform/credits"
)

const MaxInputBytes = 128 << 20
const MaxResultBytes = 128 << 20

var ErrNotFound = errors.New("job not found")
var ErrLeaseLost = errors.New("job lease lost")

type Input struct {
	Payload      string                 `json:"payload"`
	Digest       string                 `json:"digest"`
	ContentType  string                 `json:"contentType"`
	Accept       string                 `json:"accept"`
	Query        string                 `json:"query"`
	Billed       bool                   `json:"billed"`
	CreditPolicy credits.WorkflowPolicy `json:"creditPolicy,omitempty"`
}

type Job struct {
	ID              string          `json:"id"`
	Owner           string          `json:"owner"`
	Session         string          `json:"session"`
	Kind            string          `json:"kind"`
	Status          string          `json:"status"`
	Progress        float64         `json:"progress"`
	Message         string          `json:"message"`
	Attempts        int             `json:"attempts"`
	Revision        int             `json:"revision"`
	CreatedAt       string          `json:"createdAt"`
	UpdatedAt       string          `json:"updatedAt"`
	Input           Input           `json:"input"`
	InputBytes      int             `json:"inputBytes"`
	Fingerprint     string          `json:"fingerprint"`
	IdempotencyKey  string          `json:"idempotencyKey"`
	Lease           string          `json:"lease"`
	CancelRequested bool            `json:"cancelRequested"`
	Snapshot        json.RawMessage `json:"snapshot,omitempty"`
	Result          json.RawMessage `json:"result,omitempty"`
	StatusCode      int             `json:"statusCode"`
	ContentType     string          `json:"contentType"`
}

type Update struct {
	Progress float64         `json:"progress"`
	Message  string          `json:"message"`
	Snapshot json.RawMessage `json:"snapshot,omitempty"`
}

type Result struct {
	Body        json.RawMessage `json:"result"`
	Snapshot    json.RawMessage `json:"snapshot,omitempty"`
	StatusCode  int             `json:"statusCode"`
	ContentType string          `json:"contentType"`
}

type Repository interface {
	Enqueue(context.Context, Job) (Job, error)
	Get(context.Context, string, string, string) (Job, error)
	List(context.Context, string, string) ([]Job, error)
	Active(context.Context) ([]Job, error)
	Claim(context.Context, string) (*Job, error)
	Start(context.Context, Job) (Job, error)
	Heartbeat(context.Context, Job, Update) (Job, error)
	Finish(context.Context, Job, Result) error
	Cancel(context.Context, string, string, string) (Job, error)
}

type Task func(context.Context, Job) Result
type Prepare func(context.Context, Job) (context.Context, func(), error)

type Options struct {
	Local              bool
	Workers            int
	PollInterval       time.Duration
	Heartbeat          time.Duration
	Timeout            time.Duration
	Prepare            Prepare
	StatusPollInterval time.Duration
}

type reporterKey struct{}
type identityKey struct{}

func contextWithJobIdentity(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, identityKey{}, id)
}

func Report(ctx context.Context, update Update) {
	if report, ok := ctx.Value(reporterKey{}).(func(Update)); ok {
		report(update)
	}
}

func ID(ctx context.Context) string {
	id, _ := ctx.Value(identityKey{}).(string)
	return id
}

func (j Job) View() map[string]any {
	view := map[string]any{}
	// Preserve scene previews and render filenames on their existing status routes.
	if len(j.Snapshot) > 0 {
		if err := json.Unmarshal(j.Snapshot, &view); err != nil {
			view = nil
		}
	}
	if view == nil {
		view = map[string]any{}
	}
	if len(j.Result) > 0 && j.Status == "completed" {
		var fields map[string]any
		if json.Unmarshal(j.Result, &fields) == nil {
			for key, value := range fields {
				view[key] = value
			}
		}
	}
	view["id"], view["kind"], view["status"] = j.ID, j.Kind, j.Status
	view["progress"], view["message"], view["attempts"] = j.Progress, j.Message, j.Attempts
	view["revision"], view["createdAt"], view["updatedAt"] = j.Revision, j.CreatedAt, j.UpdatedAt
	view["statusCode"], view["contentType"] = j.StatusCode, j.ContentType
	if jobTerminal(j.Status) {
		delete(view, "stage")
		delete(view, "timing")
	}
	if j.Kind == "ai-scene" && view["scenes"] == nil {
		view["scenes"] = []any{}
	}
	if len(j.Result) > 0 {
		view["result"] = j.Result
	}
	return view
}

func (j Job) Summary() map[string]any {
	view := map[string]any{
		"id": j.ID, "kind": j.Kind, "status": j.Status, "statusCode": j.StatusCode,
		"progress": j.Progress, "message": j.Message, "revision": j.Revision,
		"attempts": j.Attempts, "createdAt": j.CreatedAt, "updatedAt": j.UpdatedAt,
	}
	if stage := j.stage(); stage != nil {
		view["stage"] = stage
	}
	var snapshot struct {
		Performance *performanceSummary `json:"performance"`
	}
	if json.Unmarshal(j.Snapshot, &snapshot) == nil && snapshot.Performance != nil {
		view["performance"] = snapshot.Performance
	}
	var result map[string]json.RawMessage
	if json.Unmarshal(j.Result, &result) == nil {
		for _, key := range []string{"cost", "summary", "diagnostics", "requirements", "file", "filename"} {
			if value, exists := result[key]; exists {
				view[key] = value
			}
		}
	}
	return view
}
