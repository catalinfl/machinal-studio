package jobqueue

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

type statusRepository struct {
	Repository
	lookup func(context.Context, string, string, string) (Job, error)
}

func (s statusRepository) Get(ctx context.Context, owner, session, id string) (Job, error) {
	return s.lookup(ctx, owner, session, id)
}

func TestStatusWaitReturnsChangedRevisionAndUsesOwnedScope(t *testing.T) {
	id := "0123456789abcdef0123456789abcdef"
	calls := 0
	store := statusRepository{lookup: func(_ context.Context, owner, session, jobID string) (Job, error) {
		if owner != "alice" || session != "u_alice" || jobID != id {
			t.Errorf("status escaped ownership scope: %s, %s, %s", owner, session, jobID)
		}
		calls++
		job := Job{ID: id, Owner: owner, Session: session, Status: "running", Revision: 5}
		if calls > 1 {
			job.Status, job.Revision = "completed", 6
			job.Result = json.RawMessage(`{"composition":{"tracks":[1,2,3]},"cost":{"status":"pending","knownCredits":15}}`)
		}
		return job, nil
	}}
	service := New(store, nil, Options{StatusPollInterval: time.Second})
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("pbUserId", "alice")
		return c.Next()
	})
	app.Get("/jobs/:id", service.Status)
	request := httptest.NewRequest("GET", "/jobs/"+id+"?wait=25&afterRevision=5&view=summary", nil)
	request.Header.Set("X-Session-Id", "u_alice")
	response, err := app.Test(request, 5000)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if calls != 2 || result["revision"] != float64(6) || result["status"] != "completed" || result["cost"] == nil || result["composition"] != nil || result["result"] != nil {
		t.Fatal("status wait lost compactness or the changed revision", result, calls)
	}
}

func TestStatusWaitHonorsCancellationWithoutRepositoryPolling(t *testing.T) {
	service := New(statusRepository{lookup: func(context.Context, string, string, string) (Job, error) {
		t.Fatal("cancelled wait polled the repository")
		return Job{}, nil
	}}, nil, Options{StatusPollInterval: time.Second})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := service.waitForRevision(ctx, Job{Status: "running"}, 25*time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestCompletionWaitIgnoresHeartbeatRevisions(t *testing.T) {
	calls := 0
	service := New(statusRepository{lookup: func(_ context.Context, owner, session, id string) (Job, error) {
		calls++
		job := Job{ID: id, Owner: owner, Session: session, Status: "running", Revision: calls + 5, Progress: 0.4}
		if calls == 3 {
			job.Status = "completed"
		}
		return job, nil
	}}, nil, Options{StatusPollInterval: time.Second})
	initial := Job{ID: "job", Owner: "alice", Session: "owned", Status: "running", Revision: 5}
	result, err := service.waitForJob(context.Background(), initial, 5*time.Second, true)
	if err != nil || result.Status != "completed" || calls != 3 {
		t.Fatal("heartbeat ended the completion wait", result, calls, err)
	}
}

func TestCompletionTimeoutReturnsLatestProgressAndBoundsConcurrentWaits(t *testing.T) {
	service := New(statusRepository{lookup: func(context.Context, string, string, string) (Job, error) {
		return Job{Status: "running", Revision: 9, Progress: 0.8}, nil
	}}, nil, Options{StatusPollInterval: time.Second})
	result, err := service.waitForJob(context.Background(), Job{Status: "running", Revision: 1}, 1100*time.Millisecond, true)
	if err != nil || result.Revision != 9 || result.Progress != 0.8 {
		t.Fatal("timeout discarded latest progress", result, err)
	}
	for range maxConcurrentWaits {
		service.waiters <- struct{}{}
	}
	_, err = service.waitForJob(context.Background(), Job{Status: "running"}, time.Second, true)
	var failure *fiber.Error
	if !errors.As(err, &failure) || failure.Code != 429 {
		t.Fatal("unbounded concurrent waits", err)
	}
}

func TestCompletionWaitBoundsAnInFlightRepositoryRead(t *testing.T) {
	service := New(statusRepository{lookup: func(ctx context.Context, _, _, _ string) (Job, error) {
		<-ctx.Done()
		return Job{}, ctx.Err()
	}}, nil, Options{})
	initial := Job{Status: "running", Revision: 3}
	started := time.Now()
	result, err := service.waitForJob(context.Background(), initial, 1100*time.Millisecond, true)
	if err != nil || result.Revision != initial.Revision || time.Since(started) > 2*time.Second {
		t.Fatal("wait deadline did not bound repository I/O", result, err)
	}
}
