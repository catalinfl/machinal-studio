package sceneworker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func fakeWorker(ready bool) *worker {
	w := &worker{ready: make(chan struct{}), done: make(chan struct{})}
	w.stop = sync.OnceFunc(func() { close(w.done) })
	if ready {
		close(w.ready)
	}
	return w
}

func awaitClosed(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for worker lifecycle")
	}
}

func assertOpen(t *testing.T, ch <-chan struct{}, duration time.Duration) {
	t.Helper()
	select {
	case <-ch:
		t.Fatal("worker stopped while in use")
	case <-time.After(duration):
	}
}

func TestConcurrentRequestsShareColdStart(t *testing.T) {
	w := fakeWorker(false)
	var starts atomic.Int32
	m := &manager{idle: time.Hour, start: func() (*worker, error) {
		starts.Add(1)
		return w, nil
	}}
	t.Cleanup(m.close)
	const requests = 24
	var group sync.WaitGroup
	group.Add(requests)
	for range requests {
		go func() {
			defer group.Done()
			release, err := m.acquire(context.Background(), true)
			if err != nil {
				t.Errorf("acquire: %v", err)
				return
			}
			release()
		}()
	}
	close(w.ready)
	group.Wait()
	if got := starts.Load(); got != 1 {
		t.Fatalf("started %d workers for simultaneous requests", got)
	}
}

func TestIdleShutdownWaitsForEveryRequestAndRestarts(t *testing.T) {
	var workers []*worker
	m := &manager{idle: 40 * time.Millisecond, start: func() (*worker, error) {
		w := fakeWorker(true)
		workers = append(workers, w)
		return w, nil
	}}
	t.Cleanup(m.close)
	first, err := m.acquire(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.acquire(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	first()
	first() // Release is idempotent even when cancellation and cleanup overlap.
	assertOpen(t, workers[0].done, 2*m.idle)
	second()
	awaitClosed(t, workers[0].done)
	third, err := m.acquire(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	defer third()
	if len(workers) != 2 {
		t.Fatalf("want a fresh worker after idle shutdown, got %d", len(workers))
	}
}

func TestCancelledCallerDoesNotCancelSharedStartup(t *testing.T) {
	w := fakeWorker(false)
	started := make(chan struct{})
	m := &manager{idle: time.Hour, start: func() (*worker, error) {
		close(started)
		return w, nil
	}}
	t.Cleanup(m.close)
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := m.acquire(ctx, true)
		result <- err
	}()
	awaitClosed(t, started)
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("want cancellation, got %v", err)
	}
	close(w.ready)
	release, err := m.acquire(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	assertOpen(t, w.done, time.Millisecond)
}

func TestFailedStartupCanBeRetriedByNextRequest(t *testing.T) {
	failure := errors.New("tool unavailable")
	failed := fakeWorker(false)
	failed.readyErr = failure
	failed.stop()
	close(failed.ready)
	starts := 0
	m := &manager{idle: time.Hour, start: func() (*worker, error) {
		starts++
		if starts == 1 {
			return failed, nil
		}
		return fakeWorker(true), nil
	}}
	t.Cleanup(m.close)
	if _, err := m.acquire(context.Background(), true); !errors.Is(err, failure) {
		t.Fatalf("want readiness failure, got %v", err)
	}
	release, err := m.acquire(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if starts != 2 {
		t.Fatalf("want two startup attempts, got %d", starts)
	}
}

func TestCrashDoesNotRestartUntilAnotherRequest(t *testing.T) {
	w := fakeWorker(true)
	starts := 0
	m := &manager{idle: time.Hour, start: func() (*worker, error) {
		starts++
		if starts == 1 {
			return w, nil
		}
		return fakeWorker(true), nil
	}}
	t.Cleanup(m.close)
	release, err := m.acquire(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	w.stop()
	release()
	if starts != 1 {
		t.Fatal("crashed request was automatically replayed")
	}
	next, err := m.acquire(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	defer next()
	if starts != 2 {
		t.Fatalf("want restart on next request, got %d starts", starts)
	}
}

func TestCloseStopsWorkerAndPreventsResurrection(t *testing.T) {
	w := fakeWorker(true)
	m := &manager{idle: time.Hour, start: func() (*worker, error) { return w, nil }}
	release, err := m.acquire(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	m.close()
	awaitClosed(t, w.done)
	release()
	m.close()
	if _, err := m.acquire(context.Background(), true); !errors.Is(err, errUnavailable) {
		t.Fatalf("closed manager accepted a new request: %v", err)
	}
}

func TestAlreadyCancelledRequestDoesNotStartWorker(t *testing.T) {
	m := &manager{start: func() (*worker, error) {
		t.Fatal("cancelled caller started a worker")
		return nil, nil
	}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := m.acquire(ctx, true); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
