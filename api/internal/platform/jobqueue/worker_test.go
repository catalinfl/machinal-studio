package jobqueue

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

type repositoryStub struct {
	Repository
	enqueue   func(context.Context, Job) (Job, error)
	start     func(context.Context, Job) (Job, error)
	heartbeat func(context.Context, Job, Update) (Job, error)
	finish    func(context.Context, Job, Result) error
}

func (s repositoryStub) Enqueue(ctx context.Context, job Job) (Job, error) {
	return s.enqueue(ctx, job)
}

func (s repositoryStub) Start(ctx context.Context, job Job) (Job, error) {
	if s.start != nil {
		return s.start(ctx, job)
	}
	job.Status = "running"
	return job, nil
}

func (s repositoryStub) Heartbeat(ctx context.Context, job Job, update Update) (Job, error) {
	if s.heartbeat != nil {
		return s.heartbeat(ctx, job, update)
	}
	return job, nil
}

func (s repositoryStub) Finish(ctx context.Context, job Job, result Result) error {
	return s.finish(ctx, job, result)
}

func TestSubmissionRespondsBeforeExecutionAndCopiesRequest(t *testing.T) {
	old := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = old })
	var saved Job
	store := repositoryStub{enqueue: func(_ context.Context, job Job) (Job, error) {
		job.Status = "queued"
		saved = job
		return job, nil
	}, finish: func(_ context.Context, _ Job, result Result) error {
		if result.StatusCode != 200 || string(result.Body) != `{"ok":true}` {
			t.Error(result)
		}
		return nil
	}}
	var calls atomic.Int32
	task := FiberTask(func(c *fiber.Ctx) error {
		calls.Add(1)
		if string(c.Body()) != `{"prompt":"original"}` || auth.UserID(c) != "alice" || c.Get("X-Session-Id") != "u_alice" || c.Query("fast") != "1" {
			t.Error("worker did not receive a detached copy of the original request")
		}
		if c.Get("Authorization") != "" {
			t.Error("user token was persisted into a job")
		}
		return c.JSON(fiber.Map{"ok": true})
	})
	service := New(store, map[string]Task{"ai-image": task}, Options{})
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice"); return c.Next() })
	app.Post("/submit", service.Submit("ai-image", false))
	request := httptest.NewRequest("POST", "/submit?fast=1", strings.NewReader(`{"prompt":"original"}`))
	request.Header.Set("X-Session-Id", "u_alice")
	request.Header.Set("Authorization", "Bearer never-save-this")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 202 || calls.Load() != 0 || response.Header.Get("Location") != "/jobs/"+saved.ID {
		t.Fatalf("submit returned %d with %d executions", response.StatusCode, calls.Load())
	}
	// Recycle Fiber's original request before executing the saved job.
	response, err = app.Test(httptest.NewRequest("POST", "/submit", strings.NewReader("different")))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	service.execute(context.Background(), saved)
	if calls.Load() != 1 {
		t.Fatal(calls.Load())
	}
}

func TestResultWriteRetriesWithoutReexecutingTask(t *testing.T) {
	var calls, writes int
	service := New(repositoryStub{finish: func(_ context.Context, _ Job, result Result) error {
		writes++
		if writes < 3 {
			return errors.New("temporary storage outage")
		}
		if string(result.Snapshot) != `{"scenes":[{"id":"partial"}]}` {
			t.Fatal("final partial results were not preserved", string(result.Snapshot))
		}
		return nil
	}}, map[string]Task{"test": func(ctx context.Context, _ Job) Result {
		calls++
		Report(ctx, Update{Snapshot: json.RawMessage(`{"scenes":[{"id":"partial"}]}`)})
		return failure(502, "provider failed after creating an asset")
	}}, Options{PollInterval: time.Millisecond})
	service.execute(context.Background(), Job{ID: "job", Kind: "test"})
	if calls != 1 || writes != 3 {
		t.Fatal(calls, writes)
	}
}

func TestCancellationReachesTaskAndStopsSideEffects(t *testing.T) {
	var pulses atomic.Int32
	service := New(repositoryStub{heartbeat: func(_ context.Context, job Job, _ Update) (Job, error) {
		pulses.Add(1)
		job.CancelRequested = true
		return job, nil
	}, finish: func(_ context.Context, _ Job, result Result) error {
		if result.StatusCode != 408 {
			t.Error(result)
		}
		return nil
	}}, map[string]Task{"test": func(ctx context.Context, _ Job) Result {
		<-ctx.Done()
		return failure(502, "cancelled provider")
	}}, Options{Heartbeat: time.Millisecond, Timeout: time.Second})
	service.execute(context.Background(), Job{Kind: "test"})
	if pulses.Load() == 0 {
		t.Fatal("worker did not observe cancellation")
	}
}

func TestPanicsBecomeFailedJobs(t *testing.T) {
	service := New(repositoryStub{finish: func(_ context.Context, _ Job, result Result) error {
		if result.StatusCode != 500 {
			t.Error(result)
		}
		return nil
	}}, map[string]Task{"panic": func(context.Context, Job) Result { panic("internal error") }}, Options{})
	service.execute(context.Background(), Job{Kind: "panic"})
}

func TestRenderWorkerPersistsPerformanceWithoutStaleTerminalStage(t *testing.T) {
	service := New(repositoryStub{finish: func(_ context.Context, _ Job, result Result) error {
		job := Job{Kind: "automation-render", Status: "completed", Snapshot: result.Snapshot, Result: result.Body}
		view := job.Summary()
		if view["stage"] != nil || view["performance"] == nil || view["filename"] == nil {
			t.Fatal("terminal render lost evidence or retained stale stage", view)
		}
		var fields map[string]any
		if err := json.Unmarshal(result.Snapshot, &fields); err != nil || fields["stage"] != nil {
			t.Fatal("terminal snapshot still contains active capture", fields, err)
		}
		return nil
	}}, map[string]Task{"automation-render": func(ctx context.Context, _ Job) Result {
		ReportStage(ctx, 0.1, "capture", Stage{Name: "capture", Scope: "scene", Index: 6, Count: 6, Completed: 480, Total: 523})
		ReportStage(ctx, 0.9, "finalizing MP4", Stage{Name: "encoding", Scope: "job"})
		ReportStage(ctx, 0.98, "Saving video to cloud storage", Stage{Name: "publication", Scope: "job"})
		return Result{StatusCode: 200, Body: json.RawMessage(`{"filename":"video.mp4"}`)}
	}}, Options{})
	service.execute(context.Background(), Job{ID: "render", Kind: "automation-render"})
}
