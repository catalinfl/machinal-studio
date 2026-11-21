package preferences

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestWorkflowDefaultsIsolationAndPartialUpdates(t *testing.T) {
	root := t.TempDir()
	newApp := func() *fiber.App {
		workflow := &Workflows{root: func() string { return root }}
		app := fiber.New()
		app.Use(func(c *fiber.Ctx) error {
			c.Locals("pbUserId", c.Get("Owner"))
			c.Locals("machinalAPIKey", c.Get("Key"))
			return c.Next()
		})
		app.Get("/preferences", workflow.Get)
		app.Post("/preferences", workflow.Save)
		return app
	}
	request := func(app *fiber.App, method, owner, key, body string) (int, workflowView) {
		t.Helper()
		r := httptest.NewRequest(method, "/preferences", strings.NewReader(body))
		r.Header.Set("Owner", owner)
		r.Header.Set("Key", key)
		r.Header.Set("Content-Type", "application/json")
		response, err := app.Test(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var view workflowView
		if response.StatusCode == 200 {
			if err := json.NewDecoder(response.Body).Decode(&view); err != nil {
				t.Fatal(err)
			}
		}
		return response.StatusCode, view
	}
	app := newApp()
	status, initial := request(app, "GET", "alice", "desktop", "")
	if status != 200 || initial.Configured || initial.Preferences.CaptionMaxWords != 4 {
		t.Fatal("missing safe defaults", status, initial)
	}
	status, saved := request(app, "POST", "alice", "desktop", `{"style":"documentary","sceneMode":"3d","imagePolicy":"prefer-images"}`)
	if status != 200 || !saved.Configured || saved.Preferences.CaptionMaxWords != 4 {
		t.Fatal(status, saved)
	}
	app = newApp()
	status, updated := request(app, "POST", "alice", "desktop", `{"captionMaxWords":3}`)
	if status != 200 || updated.Preferences.Style != "documentary" || updated.Preferences.SceneMode != "3d" || updated.Preferences.CaptionMaxWords != 3 {
		t.Fatal("partial update lost other preferences", status, updated)
	}
	for _, identity := range [][2]string{{"alice", "laptop"}, {"bob", "desktop"}} {
		status, view := request(app, "GET", identity[0], identity[1], "")
		if status != 200 || view.Configured || view.Preferences != defaultWorkflow() {
			t.Fatal("preferences leaked between keys/accounts", status, view)
		}
	}
	for _, body := range []string{`{"apiKey":"secret"}`, `{"url":"http://localhost"}`, `{"sceneMode":"invalid"}`, `{"captionMaxWords":0}`, `{"captionMaxWords":13}`, `{"style":"unknown"}`, `null`, `{}` + `{}`, strings.Repeat(" ", maxWorkflowBytes+1)} {
		if status, _ := request(app, "POST", "alice", "desktop", body); status != 400 {
			t.Fatalf("accepted invalid or secret preference: %s (status %d)", body, status)
		}
	}
	if status, _ := request(app, "GET", "../alice", "desktop", ""); status != 401 {
		t.Fatal("accepted unsafe identity", status)
	}
}
