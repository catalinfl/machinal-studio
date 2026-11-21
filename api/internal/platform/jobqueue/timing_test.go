package jobqueue

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestWaitWakesOnPersistedChangeWithoutWaitingForPoll(t *testing.T) {
	service := New(statusRepository{lookup: func(context.Context, string, string, string) (Job, error) {
		return Job{ID: "job", Status: "completed", Revision: 2}, nil
	}}, nil, Options{StatusPollInterval: time.Hour})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ready := make(chan struct{})
	go func() {
		for {
			service.watchMu.Lock()
			watching := len(service.watches) > 0
			service.watchMu.Unlock()
			if watching {
				service.notifyJob("job")
				close(ready)
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Millisecond):
			}
		}
	}()
	result, err := service.waitForJob(ctx, Job{ID: "job", Status: "running"}, time.Second, true)
	if err != nil || result.Status != "completed" {
		t.Fatal("notification did not wake the wait", result, err)
	}
	<-ready
	if len(service.watches) != 0 {
		t.Fatal("finished wait leaked a subscription")
	}
}

type historyRepository struct {
	Repository
	jobs  []Job
	calls int
}

func (repository *historyRepository) TimingHistory(_ context.Context, job Job) ([]Job, error) {
	if job.Owner != "alice" || job.Session != "owned" {
		return nil, ErrNotFound
	}
	repository.calls++
	return repository.jobs, nil
}

func TestTimingRestoresScopedCompletedPerformanceAfterRestart(t *testing.T) {
	repository := &historyRepository{jobs: []Job{
		{ID: "one", Kind: "render", Status: "completed", Snapshot: json.RawMessage(`{"performance":{"elapsedSeconds":60}}`)},
		{ID: "two", Kind: "render", Status: "completed", Snapshot: json.RawMessage(`{"performance":{"elapsedSeconds":90}}`)},
		{ID: "three", Kind: "render", Status: "completed", Snapshot: json.RawMessage(`{"performance":{"elapsedSeconds":120}}`)},
		{ID: "failure", Kind: "render", Status: "failed", Snapshot: json.RawMessage(`{"performance":{"elapsedSeconds":999}}`)},
	}}
	service := New(repository, nil, Options{})
	job := Job{ID: "active", Owner: "alice", Session: "owned", Kind: "render", Status: "running"}
	service.loadTimingHistory(context.Background(), job)
	service.loadTimingHistory(context.Background(), job)
	if repository.calls != 1 || len(service.durations[job.Kind]) != 3 {
		t.Fatal("history was duplicated or failures were used", repository.calls, service.durations)
	}
	service.started[job.ID] = time.Now().Add(-20 * time.Second)
	timing := service.describe(job, true)["timing"].(map[string]any)
	if timing["basis"] != "recent-jobs" || timing["sampleCount"] != 3 || timing["remainingRangeSeconds"] == nil || timing["estimateUnavailableReason"] != nil {
		t.Fatal(timing)
	}
}

func TestSceneFrameEstimateIsNotPresentedAsWholeJobETA(t *testing.T) {
	service := New(nil, nil, Options{})
	job := Job{ID: "job", Kind: "render", Status: "running", Progress: 0.1}
	service.started[job.ID] = time.Now().Add(-10 * time.Minute)
	job.Snapshot, _ = json.Marshal(map[string]any{"stage": Stage{Name: "capture", Index: 2, Count: 7, Completed: 100, Total: 200, ElapsedSeconds: 30}})
	view := service.describe(job, true)
	timing := view["timing"].(map[string]any)
	if timing["remainingSeconds"] != nil || timing["stageRemainingSeconds"] != 30 || timing["stageBasis"] != "scene-frames" || view["stage"] == nil {
		t.Fatal(view)
	}
	job.Snapshot, _ = json.Marshal(map[string]any{"stage": Stage{Name: "encoding", Completed: 200, Total: 200, ElapsedSeconds: 30}})
	if timing := service.describe(job, true)["timing"].(map[string]any); timing["stageRemainingSeconds"] != nil {
		t.Fatal("encoder drain is not frame capture", timing)
	}
	job.Snapshot, _ = json.Marshal(map[string]any{"stage": Stage{Name: "encoding", Scope: "pass", Completed: 16000, Total: 64000, ElapsedSeconds: 10}})
	if timing := service.describe(job, true)["timing"].(map[string]any); timing["stageRemainingSeconds"] != 30 || timing["stageBasis"] != "encoded-media-time" || timing["remainingSeconds"] != nil {
		t.Fatal("expected live pass-only ETA without historical samples", timing)
	}
	service.durations[job.Kind] = []time.Duration{time.Minute, time.Minute, time.Minute}
	if timing := service.describe(job, true)["timing"].(map[string]any); timing["remainingSeconds"] != nil {
		t.Fatal("outgrown historical estimate must be omitted", timing)
	}
}

func TestTimingIsApproximateAndNeverIncludesOtherOwners(t *testing.T) {
	service := New(nil, nil, Options{})
	job := Job{ID: "job", Kind: "render", Status: "running", Progress: 0.5}
	unknown := service.describe(job, true)["timing"].(map[string]any)
	if unknown["remainingSeconds"] != nil || unknown["basis"] != "unknown" {
		t.Fatal(unknown)
	}
	service.started[job.ID] = time.Now().Add(-20 * time.Second)
	timing := service.describe(job, true)["timing"].(map[string]any)
	if timing["approximate"] != true || timing["basis"] != "unknown" || timing["remainingSeconds"] != nil {
		t.Fatal(timing)
	}
	service.setInventory([]Job{{ID: "secret", Kind: "render", Owner: "another-account", Session: "private", Status: "running"}})
	queued := service.describe(Job{ID: "queued", Kind: "render", Status: "queued"}, true)
	if queued["owner"] != nil || queued["session"] != nil {
		t.Fatal("timing leaked private account metadata", queued)
	}
	if service.inventory[0].Owner != "" || service.inventory[0].Session != "" {
		t.Fatal("timing retained unrelated private fields")
	}
}
