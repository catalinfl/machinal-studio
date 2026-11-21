package jobqueue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/url"
	"regexp"
	"strings"
	"time"

	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

var idPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

const MaxCompletionWait = 15 * time.Minute

func (s *Service) Submit(kind string, billed bool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		submission, err := newSubmission(c, kind, billed)
		if err != nil {
			return err
		}
		release := sessions.UseWorkspace(submission.Session)
		defer release()
		if _, err := sessions.TouchOwned(submission.Session, submission.Owner); err != nil {
			log.Printf("job workspace: %v", err)
			return fiber.NewError(fiber.StatusServiceUnavailable, "The project workspace could not be opened. Check API storage permissions and available disk space.")
		}
		sessions.ProtectJobSession(submission.Session)
		job, err := s.persistSubmission(c.UserContext(), submission, c.Body())
		if err != nil {
			return storeError(err)
		}
		statusURL := "/jobs/" + job.ID
		if project := c.Params("projectID"); project != "" {
			statusURL = "/v1/projects/" + url.PathEscape(project) + statusURL
		}
		c.Set(fiber.HeaderLocation, statusURL)
		c.Set(fiber.HeaderCacheControl, "no-store")
		view := s.describe(job, false)
		view["statusUrl"] = statusURL
		return c.Status(fiber.StatusAccepted).JSON(view)
	}
}

func submissionInput(c *fiber.Ctx, billed bool) Input {
	query := url.Values{}
	for _, key := range []string{"fast", "draft", "previewStart", "previewDuration"} {
		if value := c.Query(key); value != "" {
			query.Set(key, value)
		}
	}
	digest := sha256.Sum256(c.Body())
	policy := credits.WorkflowPolicyFromContext(c.UserContext())
	return Input{ContentType: c.Get(fiber.HeaderContentType), Accept: c.Get(fiber.HeaderAccept),
		Query: query.Encode(), Billed: billed && policy != credits.MCPFree, CreditPolicy: policy, Digest: hex.EncodeToString(digest[:])}
}

func newSubmission(c *fiber.Ctx, kind string, billed bool) (Job, error) {
	if len(c.Body()) == 0 {
		return Job{}, fiber.ErrBadRequest
	}
	if len(c.Body()) > MaxInputBytes {
		return Job{}, fiber.ErrRequestEntityTooLarge
	}
	owner, session := auth.UserID(c), sessions.FromRequest(c)
	if owner == "" || session == "" {
		return Job{}, fiber.ErrUnauthorized
	}
	key := strings.TrimSpace(c.Get("Idempotency-Key"))
	if len(key) > 128 {
		return Job{}, fiber.NewError(400, "Idempotency-Key must be at most 128 characters.")
	}
	id, err := randomID()
	if err != nil {
		return Job{}, storeError(err)
	}
	if key == "" {
		key = id
	}
	input := submissionInput(c, billed)
	data, err := json.Marshal(input)
	if err != nil {
		return Job{}, storeError(err)
	}
	fingerprint := sha256.Sum256(data)
	keyHash := sha256.Sum256([]byte(owner + "\x00" + session + "\x00" + kind + "\x00" + key))
	input.Payload = id
	return Job{ID: id, Owner: owner, Session: session, Kind: kind, Input: input, InputBytes: len(c.Body()),
		Fingerprint: hex.EncodeToString(fingerprint[:]), IdempotencyKey: hex.EncodeToString(keyHash[:])}, nil
}

func (s *Service) persistSubmission(ctx context.Context, submission Job, body []byte) (Job, error) {
	if err := savePayload(submission.ID, body); err != nil {
		return Job{}, err
	}
	job, err := s.Store.Enqueue(ctx, submission)
	if err != nil {
		var rejected *StoreError
		if errors.As(err, &rejected) && rejected.Status < 500 {
			removePayload(submission.ID)
		}
		return Job{}, err
	}
	if job.ID != submission.ID {
		removePayload(submission.ID)
	}
	return job, nil
}

func (s *Service) Status(c *fiber.Ctx) error {
	if !idPattern.MatchString(c.Params("id")) {
		return fiber.ErrNotFound
	}
	// Subscribe before reading so a completion between lookup and wait cannot be lost.
	changes, release := s.watchJob(c.Params("id"))
	defer release()
	job, err := s.Store.Get(c.UserContext(), auth.UserID(c), sessions.FromRequest(c), c.Params("id"))
	if err != nil {
		return storeError(err)
	}
	job, err = s.waitForStatus(c, job, changes)
	if err != nil {
		var response *fiber.Error
		if errors.As(err, &response) {
			return response
		}
		return storeError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Set(fiber.HeaderRetryAfter, "3")
	if s.Options.RefreshPendingCost != nil && job.Status == "completed" {
		job.refreshCost(c.UserContext(), s.Options.RefreshPendingCost)
	}
	if c.Query("view") == "summary" {
		return c.JSON(s.describe(job, true))
	}
	if c.Query("view") == "result" {
		return c.JSON(fiber.Map{"id": job.ID, "kind": job.Kind, "status": job.Status, "statusCode": job.StatusCode, "result": job.Result})
	}
	return c.JSON(s.describe(job, false))
}

func (job *Job) refreshCost(ctx context.Context, refresh func(context.Context, Job, map[string]any) bool) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(job.Result, &fields) != nil {
		return
	}
	var cost map[string]any
	if json.Unmarshal(fields["cost"], &cost) != nil || cost["status"] != "pending" || !refresh(ctx, *job, cost) {
		return
	}
	value, err := json.Marshal(cost)
	if err != nil {
		return
	}
	fields["cost"] = value
	if data, err := json.Marshal(fields); err == nil {
		job.Result = data
	}
}

func (s *Service) waitForStatus(c *fiber.Ctx, job Job, changes <-chan struct{}) (Job, error) {
	terminalOnly := c.Query("until") == "terminal"
	maxWait := 25
	if terminalOnly {
		maxWait = int(MaxCompletionWait / time.Second)
	}
	if c.Query("until") != "" && !terminalOnly {
		return Job{}, fiber.NewError(fiber.StatusBadRequest, "until must be terminal or omitted")
	}
	wait := c.QueryInt("wait", 0)
	if wait < 0 || wait > maxWait {
		return Job{}, fiber.NewError(fiber.StatusBadRequest, "Invalid job wait duration.")
	}
	if wait > 0 && (terminalOnly || job.Revision <= c.QueryInt("afterRevision", job.Revision)) && !jobTerminal(job.Status) {
		return s.waitForObservedJob(c.UserContext(), job, time.Duration(wait)*time.Second, terminalOnly, changes)
	}
	return job, nil
}

func jobTerminal(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled"
}

func (s *Service) waitForRevision(ctx context.Context, initial Job, wait time.Duration) (Job, error) {
	return s.waitForJob(ctx, initial, wait, false)
}

func (s *Service) waitForJob(ctx context.Context, initial Job, wait time.Duration, terminalOnly bool) (Job, error) {
	changes, release := s.watchJob(initial.ID)
	defer release()
	return s.waitForObservedJob(ctx, initial, wait, terminalOnly, changes)
}

func (s *Service) waitForObservedJob(ctx context.Context, initial Job, wait time.Duration, terminalOnly bool, watch <-chan struct{}) (Job, error) {
	select {
	case s.waiters <- struct{}{}:
		defer func() { <-s.waiters }()
	default:
		return Job{}, fiber.NewError(fiber.StatusTooManyRequests, "Too many job waits. Retry later; the job is still running.")
	}
	waitCtx, cancel := context.WithTimeout(ctx, wait)
	defer cancel()
	ticker := time.NewTicker(s.Options.StatusPollInterval)
	defer ticker.Stop()
	latest := initial
	for {
		select {
		case <-waitCtx.Done():
			if err := ctx.Err(); err != nil {
				return Job{}, err
			}
			return latest, nil
		case <-ticker.C:
		case <-watch:
			watch = s.jobChanges(initial.ID)
		}
		job, err := s.Store.Get(waitCtx, initial.Owner, initial.Session, initial.ID)
		if err != nil {
			if waitCtx.Err() != nil && ctx.Err() == nil {
				return latest, nil
			}
			return Job{}, err
		}
		latest = job
		if jobTerminal(job.Status) || !terminalOnly && job.Revision != initial.Revision {
			return job, nil
		}
	}
}

func (s *Service) List(c *fiber.Ctx) error {
	jobs, err := s.Store.List(c.UserContext(), auth.UserID(c), sessions.FromRequest(c))
	if err != nil {
		return storeError(err)
	}
	items := make([]map[string]any, 0, len(jobs))
	for _, job := range jobs {
		if c.Query("view") == "summary" {
			items = append(items, s.describe(job, true))
		} else {
			items = append(items, s.describe(job, false))
		}
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(items)
}

func (s *Service) Cancel(c *fiber.Ctx) error {
	if !idPattern.MatchString(c.Params("id")) {
		return fiber.ErrNotFound
	}
	job, err := s.Store.Cancel(c.UserContext(), auth.UserID(c), sessions.FromRequest(c), c.Params("id"))
	if err != nil {
		return storeError(err)
	}
	if job.Status == "cancelled" {
		removePayload(job.ID)
	}
	s.notifyJob(job.ID)
	return c.SendStatus(fiber.StatusNoContent)
}

func storeError(err error) error {
	if errors.Is(err, ErrNotFound) {
		return fiber.ErrNotFound
	}
	var response *StoreError
	if errors.As(err, &response) {
		switch response.Status {
		case 409:
			return fiber.NewError(409, "This Idempotency-Key was already used with a different request.")
		case 429:
			return fiber.NewError(429, "The job queue is full. Retry later.")
		case fiber.StatusBadRequest, fiber.StatusUnprocessableEntity:
			log.Printf("persistent job store: %v", err)
			return fiber.NewError(fiber.StatusBadGateway, "The job store rejected the API request. Check API/PocketBase queue compatibility.")
		}
	}
	log.Printf("persistent job store: %v", err)
	return fiber.NewError(503, "The job queue is unavailable. Check the PocketBase jobs migration, hooks and service token.")
}
