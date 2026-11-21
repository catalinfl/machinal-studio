package settings

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

const testKey = "sk-or-test-only"

func settingsApp(t *testing.T, root string, verify KeyVerifier) *fiber.App {
	t.Helper()
	service, err := New(root, verify)
	if err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Get("/settings/openrouter", service.Status)
	app.Post("/settings/openrouter", service.Save)
	return app
}

func requestSettings(t *testing.T, app *fiber.App, method, body, contentType string) (int, string) {
	t.Helper()
	request := httptest.NewRequest(method, "/settings/openrouter", strings.NewReader(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("key settings response must not be cached")
	}
	result, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(result), testKey) {
		t.Fatal("key appeared in the response")
	}
	return response.StatusCode, string(result)
}

func TestVerifiedKeyPersistsAndActivatesWithoutRestart(t *testing.T) {
	t.Setenv(keyEnvironment, "")
	root := t.TempDir()
	verified := false
	app := settingsApp(t, root, func(_ context.Context, key string) error {
		verified = key == testKey
		return nil
	})
	status, body := requestSettings(t, app, http.MethodGet, "", "")
	if status != http.StatusOK || body != `{"configured":false}` {
		t.Fatalf("initial status = %d %s", status, body)
	}
	status, body = requestSettings(t, app, http.MethodPost, `{"apiKey":"  `+testKey+`  "}`, "application/json")
	if status != http.StatusOK || body != `{"configured":true}` || !verified {
		t.Fatalf("save status = %d %s; verified = %t", status, body, verified)
	}
	if os.Getenv(keyEnvironment) != testKey {
		t.Fatal("AI handlers cannot use the saved key immediately")
	}
	path := filepath.Join(root, keyFilename)
	key, err := os.ReadFile(path)
	if err != nil || string(key) != testKey {
		t.Fatal("key was not persisted")
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("key file must be owner-only")
		}
	}
	t.Setenv(keyEnvironment, "sk-or-environment-fallback")
	settingsApp(t, root, func(context.Context, string) error { t.Fatal("startup must not call OpenRouter"); return nil })
	if os.Getenv(keyEnvironment) != testKey {
		t.Fatal("recreated API did not restore the saved key")
	}
}

func TestRejectedReplacementKeepsTheExistingKey(t *testing.T) {
	t.Setenv(keyEnvironment, testKey)
	root := t.TempDir()
	app := settingsApp(t, root, func(context.Context, string) error {
		return fiber.NewError(fiber.StatusBadRequest, "OpenRouter did not accept this key.")
	})
	status, _ := requestSettings(t, app, http.MethodPost, `{"apiKey":"sk-or-rejected"}`, "application/json")
	if status != http.StatusBadRequest || os.Getenv(keyEnvironment) != testKey {
		t.Fatal("rejected replacement changed the active key")
	}
	if _, err := os.Stat(filepath.Join(root, keyFilename)); !os.IsNotExist(err) {
		t.Fatal("rejected key was persisted")
	}
}

func TestSaveFailureDoesNotActivateKey(t *testing.T) {
	t.Setenv(keyEnvironment, testKey)
	app := settingsApp(t, filepath.Join(t.TempDir(), "missing"), func(context.Context, string) error { return nil })
	status, _ := requestSettings(t, app, http.MethodPost, `{"apiKey":"sk-or-replacement"}`, "application/json")
	if status != http.StatusInternalServerError || os.Getenv(keyEnvironment) != testKey {
		t.Fatal("key activated without durable storage")
	}
}

func TestSettingsRejectsMalformedAndSimpleCrossOriginBodies(t *testing.T) {
	t.Setenv(keyEnvironment, "")
	app := settingsApp(t, t.TempDir(), func(context.Context, string) error { t.Fatal("invalid input reached OpenRouter"); return nil })
	for _, test := range []struct {
		body, contentType string
		want              int
	}{
		{`{"apiKey":"` + testKey + `"}`, "text/plain", http.StatusUnsupportedMediaType},
		{`{`, "application/json", http.StatusBadRequest},
		{`{}`, "application/json", http.StatusBadRequest},
		{`{"apiKey":"sk-or-with space"}`, "application/json", http.StatusBadRequest},
		{`{"apiKey":"sk-or-` + strings.Repeat("x", maxKeyBytes) + `"}`, "application/json", http.StatusBadRequest},
		{strings.Repeat("x", maxBodyBytes+1), "application/json", http.StatusRequestEntityTooLarge},
	} {
		status, _ := requestSettings(t, app, http.MethodPost, test.body, test.contentType)
		if status != test.want {
			t.Fatalf("status = %d, want %d", status, test.want)
		}
	}
}

func TestSavedKeyIsNotMedia(t *testing.T) {
	t.Setenv(keyEnvironment, "")
	root := t.TempDir()
	previousRoot := storage.DataDir
	storage.DataDir = root
	t.Cleanup(func() { storage.DataDir = previousRoot })
	app := settingsApp(t, root, func(context.Context, string) error { return nil })
	requestSettings(t, app, http.MethodPost, `{"apiKey":"`+testKey+`"}`, "application/json")
	app.Get("/list", media.List)
	app.Get("/download", media.Download)
	for _, path := range []string{"/list", "/download?file=" + keyFilename} {
		response, err := app.Test(httptest.NewRequest(http.MethodGet, path, nil))
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || strings.Contains(string(body), testKey) || strings.Contains(string(body), keyFilename) {
			t.Fatal("saved key was exposed as media")
		}
		if strings.HasPrefix(path, "/download") && response.StatusCode == http.StatusOK {
			t.Fatal("saved key was downloadable")
		}
	}
}
