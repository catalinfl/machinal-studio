package routes

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"github.com/gofiber/fiber/v2"
)

type downloadJobStore struct {
	jobqueue.Repository
	job jobqueue.Job
}

func (s downloadJobStore) Get(_ context.Context, owner, session, id string) (jobqueue.Job, error) {
	if owner != s.job.Owner || session != s.job.Session || id != s.job.ID {
		return jobqueue.Job{}, jobqueue.ErrNotFound
	}
	return s.job, nil
}

func TestJobDownloadRequiresOwnedCompletedRenderBeforeStorageAccess(t *testing.T) {
	id := strings.Repeat("a", 32)
	for _, item := range []struct {
		name, owner, session, status, kind, filename, id string
		want                                             int
	}{
		{"running", "alice", "u_alice", "running", "render", "render_ready.mp4", id, 409},
		{"cancelled", "alice", "u_alice", "cancelled", "render", "render_ready.mp4", id, 409},
		{"not a render", "alice", "u_alice", "completed", "ai-image", "render_ready.mp4", id, 404},
		{"another owner", "bob", "u_bob", "completed", "render", "render_ready.mp4", id, 404},
		{"foreign session", "alice", "u_bob", "completed", "render", "render_ready.mp4", id, 403},
		{"invalid id", "alice", "u_alice", "completed", "render", "render_ready.mp4", "invalid", 404},
		{"path traversal", "alice", "u_alice", "completed", "render", "render_../../secret.mp4", id, 400},
	} {
		t.Run(item.name, func(t *testing.T) {
			body, err := json.Marshal(map[string]string{"filename": item.filename})
			if err != nil {
				t.Fatal(err)
			}
			jobs := jobqueue.New(downloadJobStore{job: jobqueue.Job{ID: id, Owner: "alice", Session: "u_alice", Status: item.status, Kind: item.kind, Result: body}}, nil, jobqueue.Options{})
			app := fiber.New()
			app.Get("/jobs/:id/download", func(c *fiber.Ctx) error { c.Locals("pbUserId", item.owner); return c.Next() }, auth.RequireOwnedSession, downloadJob(jobs))
			request := httptest.NewRequest("GET", "/jobs/"+item.id+"/download", nil)
			request.Header.Set("X-Session-Id", item.session)
			response, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != item.want {
				t.Fatal(response.StatusCode, item.want)
			}
		})
	}
}
