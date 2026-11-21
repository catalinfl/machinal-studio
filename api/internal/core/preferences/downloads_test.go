package preferences

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestDownloadPreferencePersistsPerAccountAndKey(t *testing.T) {
	root := t.TempDir()
	newApp := func() *fiber.App {
		d := &Downloads{root: func() string { return root }}
		app := fiber.New()
		app.Use(func(c *fiber.Ctx) error {
			c.Locals("pbUserId", c.Get("Owner"))
			c.Locals("machinalAPIKey", c.Get("Key"))
			return c.Next()
		})
		app.Get("/preferences", d.Get)
		app.Post("/preferences", d.Save)
		return app
	}
	request := func(app *fiber.App, method, owner, key, body string) (int, DownloadPreference) {
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
		var p DownloadPreference
		if response.StatusCode == 200 {
			if err := json.NewDecoder(response.Body).Decode(&p); err != nil {
				t.Fatal(err)
			}
		}
		return response.StatusCode, p
	}
	app := newApp()
	status, saved := request(app, "POST", "alice", "desktop", `{"directory":"C:\\Users\\Alice\\Videos"}`)
	if status != 200 || saved.Directory == "" {
		t.Fatal(status, saved)
	}
	app = newApp()
	status, restored := request(app, "GET", "alice", "desktop", "")
	if status != 200 || restored != saved {
		t.Fatal("preference did not survive handler recreation", status, restored)
	}
	for _, identity := range [][2]string{{"alice", "laptop"}, {"bob", "desktop"}} {
		status, p := request(app, "GET", identity[0], identity[1], "")
		if status != 200 || p.Directory != "" {
			t.Fatal("preference leaked across account/key", identity, p)
		}
	}
	for _, body := range []string{`{"directory":"bad\npath"}`, `{"directory":"bad\u0000path"}`, `{"directory":"` + strings.Repeat("a", maxDirectoryBytes+1) + `"}`} {
		status, _ := request(app, "POST", "alice", "desktop", body)
		if status != 400 {
			t.Fatal("accepted invalid directory", status)
		}
	}
	status, _ = request(app, "GET", "../alice", "desktop", "")
	if status != 401 {
		t.Fatal("accepted unsafe identity", status)
	}
	status, cleared := request(app, "POST", "alice", "desktop", `{"directory":""}`)
	if status != 200 || cleared.Directory != "" {
		t.Fatal("could not clear preference")
	}
}
