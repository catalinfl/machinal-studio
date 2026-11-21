package sceneworker

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestReadinessRetriesConnectionFailuresAndAuthenticates(t *testing.T) {
	attempts := 0
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		attempts++
		if r.URL.String() != workerURL+"/health" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("invalid readiness request: %s", r.URL)
		}
		if attempts < 2 {
			return nil, errors.New("connection refused during Node startup")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("ready"))}, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := waitForWorker(ctx, make(chan struct{}), "secret", transport); err != nil {
		t.Fatal(err)
	}
	if attempts != 2 {
		t.Fatalf("want two readiness attempts, got %d", attempts)
	}
}

func TestReadinessFailsImmediatelyOnNativeInfrastructureError(t *testing.T) {
	attempts := 0
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		attempts++
		return &http.Response{
			StatusCode: 503,
			Header:     http.Header{"X-Scene-Error-Code": {"scene_renderer_permission_denied"}},
			Body:       io.NopCloser(strings.NewReader("private failure details")),
		}, nil
	})
	err := waitForWorker(context.Background(), make(chan struct{}), "secret", transport)
	var unhealthy *healthError
	if !errors.As(err, &unhealthy) || unhealthy.code != "scene_renderer_permission_denied" || attempts != 1 {
		t.Fatalf("native infrastructure error was lost or retried: %v, attempts=%d", err, attempts)
	}
	if strings.Contains(err.Error(), "private") {
		t.Fatal("private diagnostics were exposed")
	}
}

func TestReadinessStopsWhenProcessExits(t *testing.T) {
	done := make(chan struct{})
	close(done)
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		t.Fatal("readiness probed an exited worker")
		return nil, nil
	})
	if err := waitForWorker(context.Background(), done, "secret", transport); !errors.Is(err, errUnavailable) {
		t.Fatal(err)
	}
}

func TestReadinessHasBoundedStartupWait(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return nil, errors.New("connection refused")
	})
	if err := waitForWorker(ctx, make(chan struct{}), "secret", transport); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
}
