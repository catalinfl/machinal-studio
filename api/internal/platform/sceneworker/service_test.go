package sceneworker

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRequestsThatMustNotWakeWorker(t *testing.T) {
	for _, tc := range []struct {
		name, method, path, token string
		status                    int
	}{
		{"unauthenticated", "POST", "/render", "", 401},
		{"wrong token", "POST", "/text", "wrong", 401},
		{"unknown route", "POST", "/unknown", "secret", 404},
		{"unknown method", "DELETE", "/compile", "secret", 404},
		{"progress for sleeping worker", "GET", "/render-progress/123", "secret", 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := &manager{start: func() (*worker, error) {
				t.Fatal("request must not start Node")
				return nil, nil
			}}
			handler := workerHandler(m, "secret", nil)
			r := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.token != "" {
				r.Header.Set("Authorization", "Bearer "+tc.token)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, r)
			if response.Code != tc.status {
				t.Fatalf("want %d, got %d", tc.status, response.Code)
			}
		})
	}
}

func TestProxyPreservesSceneContract(t *testing.T) {
	for _, path := range []string{"/compile", "/render", "/text", "/inspect", "/health"} {
		t.Run(path, func(t *testing.T) {
			m := &manager{idle: time.Hour, start: func() (*worker, error) { return fakeWorker(true), nil }}
			t.Cleanup(m.close)
			transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host != workerAddress || r.URL.Path != path {
					t.Fatalf("unexpected worker target: %s", r.URL)
				}
				if r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("X-Scene-Request-Id") != "request-id" {
					t.Fatal("lost scene request headers")
				}
				body, err := io.ReadAll(r.Body)
				if err != nil || string(body) != "payload" {
					t.Fatalf("lost request payload: %q, %v", body, err)
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"X-Scene-Manifest": {"manifest"}}, Body: io.NopCloser(strings.NewReader("result"))}, nil
			})
			method := http.MethodPost
			if path == "/health" {
				method = http.MethodGet
			}
			r := httptest.NewRequest(method, path, strings.NewReader("payload"))
			r.Header.Set("Authorization", "Bearer secret")
			r.Header.Set("X-Scene-Request-Id", "request-id")
			response := httptest.NewRecorder()
			workerHandler(m, "secret", transport).ServeHTTP(response, r)
			if response.Code != 200 || response.Body.String() != "result" || response.Header().Get("X-Scene-Manifest") != "manifest" {
				t.Fatalf("lost scene response contract: %v", response.Result())
			}
		})
	}
}

func TestWorkerRemainsAliveWhileResponseStreams(t *testing.T) {
	w := fakeWorker(true)
	m := &manager{idle: 40 * time.Millisecond, start: func() (*worker, error) { return w, nil }}
	t.Cleanup(m.close)
	reader, writer := io.Pipe()
	streaming := make(chan struct{})
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		close(streaming)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: reader}, nil
	})
	r := httptest.NewRequest(http.MethodPost, "/render", nil)
	r.Header.Set("Authorization", "Bearer secret")
	response := httptest.NewRecorder()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		workerHandler(m, "secret", transport).ServeHTTP(response, r)
	}()
	awaitClosed(t, streaming)
	assertOpen(t, w.done, 2*m.idle)
	if _, err := writer.Write([]byte("video bytes")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	awaitClosed(t, finished)
	awaitClosed(t, w.done)
	if response.Body.String() != "video bytes" {
		t.Fatal("truncated video response")
	}
}

func TestStartupFailureDoesNotExposeInternalDetails(t *testing.T) {
	m := &manager{start: func() (*worker, error) {
		return nil, errors.New("private filesystem details")
	}}
	r := httptest.NewRequest(http.MethodPost, "/render", nil)
	r.Header.Set("Authorization", "Bearer secret")
	response := httptest.NewRecorder()
	workerHandler(m, "secret", nil).ServeHTTP(response, r)
	if response.Code != 503 || strings.Contains(response.Body.String(), "private") {
		t.Fatalf("unexpected startup failure response: %d %s", response.Code, response.Body)
	}
}

func TestColdStartPreservesActionableInfrastructureCode(t *testing.T) {
	m := &manager{start: func() (*worker, error) {
		return nil, &healthError{status: 503, code: "scene_renderer_permission_denied"}
	}}
	r := httptest.NewRequest(http.MethodPost, "/compile", nil)
	r.Header.Set("Authorization", "Bearer secret")
	response := httptest.NewRecorder()
	workerHandler(m, "secret", nil).ServeHTTP(response, r)
	if response.Code != 503 || response.Header().Get("X-Scene-Error-Code") != "scene_renderer_permission_denied" {
		t.Fatal("cold start hid the native renderer permission error")
	}
}
