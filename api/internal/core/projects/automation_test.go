package projects

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func TestAutomationScopeOnlyUsesOwnedProjectSession(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	store := NewStore()
	project, err := store.Create("owner", "Automation")
	if err != nil {
		t.Fatal(err)
	}
	caller := "owner"
	app := fiber.New()
	app.Get("/projects/:projectID/media", func(c *fiber.Ctx) error { c.Locals("pbUserId", caller); return c.Next() }, store.ScopeAPI, func(c *fiber.Ctx) error {
		if sessions.FromRequest(c) != project.SessionID {
			t.Fatal("caller replaced the owned project scope")
		}
		return c.SendStatus(200)
	})
	request := httptest.NewRequest("GET", "/projects/"+project.ID+"/media?session=another", nil)
	request.Header.Set("X-Session-Id", "another")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("owned scope returned %d", response.StatusCode)
	}
	caller = "other-owner"
	response, err = app.Test(httptest.NewRequest("GET", "/projects/"+project.ID+"/media", nil))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatalf("another account reached project: %d", response.StatusCode)
	}
}

func TestDefaultProjectIssuesUncachedMediaCapabilityOnlyToOwner(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { sessions.Evict("u_alice"); storage.DataDir = previous })
	store := NewStore()
	if _, err := store.EnsureInitial("alice"); err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Get("/projects/:projectID", func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice"); return c.Next() }, store.GetHandler)
	response, err := app.Test(httptest.NewRequest("GET", "/projects/default", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result struct {
		SessionID  string `json:"sessionId"`
		MediaToken string `json:"mediaToken"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" || !sessions.ValidMediaToken(result.SessionID, result.MediaToken) {
		t.Fatal("owned project failed to issue private media access", response.StatusCode)
	}
}
