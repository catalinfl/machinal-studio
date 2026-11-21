package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

type admissionStore struct {
	jobqueue.Repository
	last jobqueue.Job
}

func (s *admissionStore) Enqueue(_ context.Context, job jobqueue.Job) (jobqueue.Job, error) {
	s.last = job
	job.Status = "queued"
	return job, nil
}

func TestAllBrowserLongRunningRoutesAcceptPersistentJobs(t *testing.T) {
	old := storage.DataDir
	storage.DataDir = t.TempDir()
	defer func() { storage.DataDir = old }()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/collections/users/auth-refresh" {
			w.Write([]byte(`{"record":{"id":"user123","paid":true}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	t.Setenv("POCKETBASE_URL", server.URL)
	store := &admissionStore{}
	jobs := jobqueue.New(store, nil, jobqueue.Options{})
	app := fiber.New()
	registerEditorRoutes(app, jobs)
	for route, kind := range map[string]string{
		"/render": "editor-render", "/renders": "render", "/compositions/compile-and-generate": "compile-generate",
		"/ai/edit": "ai-edit", "/ai/compositions": "ai-composition", "/ai/images": "ai-image",
		"/ai/speech": "ai-speech", "/ai/subtitles": "ai-subtitles", "/ai/scenes": "ai-scene",
	} {
		t.Run(route, func(t *testing.T) {
			request := httptest.NewRequest("POST", route, strings.NewReader(`{"test":"saved input","billed":false,"creditPolicy":"mcp-free"}`))
			request.Header.Set("Authorization", "Bearer route-test-token")
			request.Header.Set("X-Session-Id", "u_user123")
			request.Header.Set("Content-Type", "application/json")
			response, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			var view map[string]any
			if err := json.NewDecoder(response.Body).Decode(&view); err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != 202 || store.last.Kind != kind || !store.last.Input.Billed || store.last.Input.CreditPolicy != "" || view["status"] != "queued" || response.Header.Get("Location") == "" {
				t.Fatal(response.StatusCode, store.last.Kind, view)
			}
		})
	}
}
