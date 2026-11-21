package auth

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestRequirePBAuth(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		body       string
		wantStatus int
		wantBody   string
	}{
		{"valid token", http.StatusOK, `{"record":{"id":"user123"}}`, http.StatusOK, "user123"},
		{"rejected refresh", http.StatusBadRequest, `{}`, http.StatusUnauthorized, "invalid session"},
		{"expired token", http.StatusUnauthorized, `{}`, http.StatusUnauthorized, "invalid session"},
		{"forbidden token", http.StatusForbidden, `{}`, http.StatusUnauthorized, "invalid session"},
		{"missing endpoint", http.StatusNotFound, `{}`, http.StatusBadGateway, "auth service unavailable"},
		{"upstream failure", http.StatusInternalServerError, `{}`, http.StatusBadGateway, "auth service unavailable"},
		{"invalid response", http.StatusOK, `not json`, http.StatusBadGateway, "auth service unavailable"},
		{"missing user", http.StatusOK, `{"record":{}}`, http.StatusBadGateway, "auth service unavailable"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/api/collections/users/auth-refresh" {
					t.Errorf("unexpected auth request: %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
					return
				}
				if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
					t.Errorf("Authorization = %q, want Bearer test-token", got)
				}
				w.WriteHeader(tt.status)
				if _, err := io.WriteString(w, tt.body); err != nil {
					t.Errorf("write auth response: %v", err)
				}
			}))
			defer server.Close()
			t.Setenv("POCKETBASE_URL", server.URL)

			app := fiber.New()
			app.Post("/upload", RequirePBAuth, func(c *fiber.Ctx) error {
				return c.SendString(UserID(c))
			})
			req := httptest.NewRequest(http.MethodPost, "/upload", nil)
			req.Header.Set("Authorization", "Bearer test-token")
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
