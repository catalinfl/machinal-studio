package jobqueue

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func localSubmission(id, key string) Job {
	return Job{ID: strings.Repeat(id, 32), Owner: "local", Session: "u_local", Kind: "render",
		Fingerprint: "request", IdempotencyKey: key, Input: Input{Payload: strings.Repeat(id, 32)}}
}

func TestLocalQueuePersistenceIdempotencyAndNoReplay(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "jobs.db")
	store, err := OpenLocal(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	job := localSubmission("a", "first")
	if _, err := store.Enqueue(ctx, job); err != nil {
		t.Fatal(err)
	}
	duplicate := job
	duplicate.ID = strings.Repeat("b", 32)
	result, err := store.Enqueue(ctx, duplicate)
	if err != nil || result.ID != job.ID {
		t.Fatal("idempotency lost", result, err)
	}
	duplicate.Fingerprint = "changed"
	if _, err := store.Enqueue(ctx, duplicate); err == nil {
		t.Fatal("changed request accepted")
	}
	claimed, err := store.Claim(ctx, "lease")
	if err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	if _, err := store.Start(ctx, *claimed); err != nil {
		t.Fatal(err)
	}
	queued := localSubmission("c", "second")
	if _, err := store.Enqueue(ctx, queued); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenLocal(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	interrupted, err := store.Get(ctx, "local", "u_local", job.ID)
	if err != nil || interrupted.Status != "failed" || interrupted.StatusCode != 408 {
		t.Fatal(interrupted, err)
	}
	next, err := store.Claim(ctx, "new-lease")
	if err != nil || next == nil || next.ID != queued.ID {
		t.Fatal("interrupted work replayed or queued work lost", next, err)
	}
	if err := store.Finish(ctx, *claimed, Result{StatusCode: 200}); !errors.Is(err, ErrLeaseLost) {
		t.Fatal("stale worker accepted", err)
	}
}

func TestLocalQueueProjectScopeAndCancellation(t *testing.T) {
	ctx := context.Background()
	store, err := OpenLocal(filepath.Join(t.TempDir(), "jobs.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	job := localSubmission("a", "cancel")
	if _, err := store.Enqueue(ctx, job); err != nil {
		t.Fatal(err)
	}
	for _, scope := range [][2]string{{"other", "u_local"}, {"local", "other"}} {
		if _, err := store.Get(ctx, scope[0], scope[1], job.ID); !errors.Is(err, ErrNotFound) {
			t.Fatal("scope bypass", err)
		}
		if _, err := store.Cancel(ctx, scope[0], scope[1], job.ID); !errors.Is(err, ErrNotFound) {
			t.Fatal("cancel scope bypass", err)
		}
	}
	if result, err := store.Cancel(ctx, "local", "u_local", job.ID); err != nil || result.Status != "cancelled" {
		t.Fatal(result, err)
	}
	if next, err := store.Claim(ctx, "lease"); err != nil || next != nil {
		t.Fatal("cancelled job claimed", next, err)
	}
}
