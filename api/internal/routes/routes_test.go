package routes

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/auth"

	"github.com/gofiber/fiber/v2"
)

func TestUploadAuthentication(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/collections/users/auth-refresh" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if _, err := io.WriteString(w, `{"record":{"id":"user123"}}`); err != nil {
			t.Errorf("write auth response: %v", err)
		}
	}))
	defer server.Close()
	t.Setenv("POCKETBASE_URL", server.URL)

	tests := []struct {
		name       string
		token      string
		session    string
		wantStatus int
		wantBody   string
	}{
		{"owned session reaches upload handler", "test-token", "u_user123", http.StatusBadRequest, "field 'file' is missing"},
		{"other user's session", "test-token", "u_someoneelse", http.StatusForbidden, "wrong project space"},
		{"missing session", "test-token", "", http.StatusForbidden, "wrong project space"},
		{"missing token", "", "u_user123", http.StatusUnauthorized, "login required"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := fiber.New()
			registerMediaRoutes(app)
			req := httptest.NewRequest(http.MethodPost, "/upload?session="+tt.session, nil)
			if tt.token != "" {
				req.Header.Set("Authorization", "Bearer "+tt.token)
			}
			resp, err := app.Test(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != tt.wantStatus || string(body) != tt.wantBody {
				t.Fatalf("response = %d %q, want %d %q", resp.StatusCode, body, tt.wantStatus, tt.wantBody)
			}
		})
	}
}

func TestLargeCompositionRequiresLogin(t *testing.T) {
	// Race instrumentation can push the 8 MiB fixture past Fiber's one-second test timeout.
	const requestTimeoutMillis = 10000

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/collections/users/auth-refresh" || r.Header.Get("Authorization") != "Bearer test-token" {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `{"record":{"id":"user123"}}`)
	}))
	defer server.Close()
	t.Setenv("POCKETBASE_URL", server.URL)

	app := fiber.New(fiber.Config{BodyLimit: document.MaxProjectBytes})
	registerCompositionRoutes(app)
	project := `"document":{"version":1,"mode":"assemble","inputs":{"shots":{"kind":"image","multiple":true}},"sequence":{"use":"shots","each":{"take":{"from":"0s","duration":"5s"}}}},"bindings":{"shots":["a"]},"assets":[{"id":"a","file":"a.png","kind":"image","version":"v1"}]`
	small := []byte(`{` + project + `}`)
	large := []byte(`{` + project + `,"preparedText":{"key":"saved-key","overlays":[{"image":"` + strings.Repeat("A", 8<<20) + `"}]}}`)
	for _, path := range []string{"/compositions/compile", "/compositions/validate"} {
		request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(small))
		response, err := app.Test(request, requestTimeoutMillis)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode == http.StatusUnauthorized {
			t.Fatalf("small %s request required login", path)
		}

		request = httptest.NewRequest(http.MethodPost, path, bytes.NewReader(large))
		response, err = app.Test(request, requestTimeoutMillis)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("anonymous large %s request returned %d", path, response.StatusCode)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/compositions/compile", bytes.NewReader(large))
	request.Header.Set("Authorization", "Bearer test-token")
	response, err := app.Test(request, requestTimeoutMillis)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("authenticated large compile returned %d: %s", response.StatusCode, body)
	}
}

func TestAIGenerationRequiresLogin(t *testing.T) {
	t.Setenv("AI_EDIT_TOKEN", "")
	for _, path := range []string{"/ai/edit", "/ai/images", "/ai/speech", "/ai/subtitles"} {
		t.Run(path, func(t *testing.T) {
			app := fiber.New()
			registerEditorRoutes(app)
			response, err := app.Test(httptest.NewRequest(http.MethodPost, path, nil))
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != fiber.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", response.StatusCode, fiber.StatusUnauthorized)
			}
		})
	}
}

func TestAIRoutesRequirePaidPlan(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/collections/users/auth-refresh":
			// Logged in, but no paid flags on the record.
			_, _ = io.WriteString(w, `{"record":{"id":"user123"}}`)
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/collections/subscriptions/records/"):
			w.WriteHeader(http.StatusNotFound)
		case r.Method == http.MethodGet && r.URL.Path == "/api/collections/subscriptions/records":
			_, _ = io.WriteString(w, `{"items":[]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("POCKETBASE_URL", server.URL)

	for _, path := range []string{"/ai/edit", "/ai/images", "/ai/speech", "/ai/subtitles"} {
		t.Run(path, func(t *testing.T) {
			app := fiber.New()
			registerEditorRoutes(app)
			req := httptest.NewRequest(http.MethodPost, path+"?session=u_user123", nil)
			req.Header.Set("Authorization", "Bearer test-token")
			response, err := app.Test(req)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != fiber.StatusPaymentRequired || string(body) != auth.PaidPlanRequiredMessage {
				t.Fatalf("response = %d %q, want %d %q", response.StatusCode, body, fiber.StatusPaymentRequired, auth.PaidPlanRequiredMessage)
			}
		})
	}
}

func TestAIEditRequiresOwnedSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/collections/users/auth-refresh" {
			_, _ = io.WriteString(w, `{"record":{"id":"user123","paid":true}}`)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	t.Setenv("POCKETBASE_URL", server.URL)
	app := fiber.New()
	registerEditorRoutes(app)
	for _, test := range []struct {
		name, session string
		status        int
	}{
		{"missing", "", fiber.StatusForbidden},
		{"other user", "u_someoneelse", fiber.StatusForbidden},
		{"own session", "u_user123", fiber.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/ai/edit", nil)
			request.Header.Set("Authorization", "Bearer test-token")
			if test.session != "" {
				request.Header.Set("X-Session-Id", test.session)
			}
			response, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.status {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.status)
			}
		})
	}
}
