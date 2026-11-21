package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func localApp(t *testing.T) *fiber.App {
	t.Helper()
	previous := storage.DataDir
	for _, name := range []string{"OPENROUTER_MODEL", "OPENROUTER_VISION_MODEL", "OPENROUTER_STT_MODEL", "OPENROUTER_STT_PROVIDER", "OPENROUTER_IMAGE_MODEL", "OPENROUTER_SPEECH_MODEL", "OPENROUTER_JEV_MODEL"} {
		t.Setenv(name, "")
	}
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	app, err := NewApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := app.Shutdown(); err != nil {
			t.Error(err)
		}
	})
	return app
}

func localRequest(t *testing.T, app *fiber.App, method, path, body string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "127.0.0.1"
	req.Header.Set("Content-Type", "application/json")
	if path == "/mcp" {
		req.Header.Set("Accept", "application/json, text/event-stream")
	}
	response, err := app.Test(req, 10000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func TestLocalRuntimeNeedsNoAccountAndIgnoresHostedServices(t *testing.T) {
	var calls atomic.Int32
	trap := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); w.WriteHeader(500) }))
	defer trap.Close()
	t.Setenv("POCKETBASE_URL", trap.URL)
	t.Setenv("PB_SERVICE_TOKEN", "unused-test-service-token")
	t.Setenv("S3_ENDPOINT", trap.URL)
	t.Setenv("S3_BUCKET", "unused-test-bucket")
	t.Setenv("S3_ACCESS_KEY_ID", "unused-test-id")
	t.Setenv("S3_SECRET_ACCESS_KEY", "unused-test-secret")
	app := localApp(t)
	for _, path := range []string{"/runtime", "/projects", "/v1/projects", "/list", "/settings/openrouter", "/v1/preferences/workflow", "/v1/preferences/downloads"} {
		response := localRequest(t, app, "GET", path, "")
		if response.StatusCode != 200 {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("%s: %d %s", path, response.StatusCode, body)
		}
	}
	for _, path := range []string{"/billing/credits", "/billing/access", "/api-keys", "/v1/billing/credits"} {
		if response := localRequest(t, app, "GET", path, ""); response.StatusCode != 404 {
			t.Fatalf("hosted route exposed: %s = %d", path, response.StatusCode)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("local runtime contacted hosted services")
	}
}

func TestLocalHostOriginAndWorkspaceGuards(t *testing.T) {
	app := localApp(t)
	for _, test := range []struct{ host, origin string }{{"attacker.example", ""}, {"localhost", "https://attacker.example"}, {"127.0.0.1", "null"}} {
		req := httptest.NewRequest("GET", "/projects", nil)
		req.Host = test.host
		if test.origin != "" {
			req.Header.Set("Origin", test.origin)
		}
		response, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 403 {
			t.Fatalf("host/origin guard: %+v = %d", test, response.StatusCode)
		}
	}
	for _, path := range []string{"/list?session=u_someone", "/list?session=../private", "/sessions/u_someone/heartbeat"} {
		method := "GET"
		if strings.Contains(path, "heartbeat") {
			method = "POST"
		}
		if response := localRequest(t, app, method, path, "{}"); response.StatusCode < 400 {
			t.Fatalf("arbitrary workspace accepted: %s", path)
		}
	}
}

func TestLocalMCPWorksWithoutAuthorizationAndHasNoCreditTool(t *testing.T) {
	app := localApp(t)
	initialize := localRequest(t, app, "POST", "/mcp", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`)
	data, _ := io.ReadAll(initialize.Body)
	if initialize.StatusCode != 200 || !strings.Contains(string(data), `"machinal-local"`) {
		t.Fatal(initialize.StatusCode, string(data))
	}
	tools := localRequest(t, app, "POST", "/mcp", `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`)
	data, _ = io.ReadAll(tools.Body)
	if tools.StatusCode != 200 || strings.Contains(string(data), `"name":"get_credits"`) || !strings.Contains(string(data), `"name":"compile_scene"`) {
		t.Fatal(tools.StatusCode, string(data))
	}
	projects := localRequest(t, app, "POST", "/mcp", `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}`)
	var reply map[string]json.RawMessage
	if err := json.NewDecoder(projects.Body).Decode(&reply); err != nil {
		t.Fatal(err)
	}
	if projects.StatusCode != 200 || strings.Contains(string(reply["result"]), `"isError":true`) || !strings.Contains(string(reply["result"]), `Untitled project`) {
		t.Fatal(projects.StatusCode, string(reply["result"]))
	}
}
