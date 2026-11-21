package jobqueue

import (
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func TestStoreErrorSeparatesUpstreamValidationFromQueueOutage(t *testing.T) {
	for _, test := range []struct{ upstream, status int }{{400, 502}, {422, 502}, {409, 409}, {429, 429}, {500, 503}, {503, 503}} {
		err := storeError(&StoreError{Status: test.upstream, Action: "enqueue", Message: "backend-only diagnostic"})
		var response *fiber.Error
		if !errors.As(err, &response) || response.Code != test.status || strings.Contains(response.Message, "backend-only") {
			t.Fatalf("upstream %d: %v", test.upstream, err)
		}
	}
}

func TestSubmissionWorkspaceFailureDoesNotBlameTheJobQueue(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = filepath.Join(t.TempDir(), "not-a-directory")
	t.Cleanup(func() { storage.DataDir = previous })
	if err := os.WriteFile(storage.DataDir, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	service := New(repositoryStub{}, nil, Options{})
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice"); return c.Next() })
	app.Post("/submit", service.Submit("scene-compile", false))
	request := httptest.NewRequest("POST", "/submit", strings.NewReader(`{"component":"source"}`))
	request.Header.Set("X-Session-Id", "u_alice")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 503 || !strings.Contains(string(body), "workspace") || strings.Contains(string(body), "queue") || strings.Contains(string(body), storage.DataDir) {
		t.Fatalf("workspace failure was mislabeled or leaked its path: %d %s, %v", response.StatusCode, body, err)
	}
}
