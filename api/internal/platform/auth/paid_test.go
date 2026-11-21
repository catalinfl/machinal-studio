package auth

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func paidTestServer(t *testing.T, authBody string, subOneStatus int, subOneBody string, subStatus int, subBody string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/collections/users/auth-refresh":
			if r.Header.Get("Authorization") != "Bearer test-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
			if _, err := io.WriteString(w, authBody); err != nil {
				t.Errorf("write auth response: %v", err)
			}
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/collections/subscriptions/records/"):
			if r.Header.Get("Authorization") != "Bearer test-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(subOneStatus)
			if _, err := io.WriteString(w, subOneBody); err != nil {
				t.Errorf("write subscription response: %v", err)
			}
		case r.Method == http.MethodGet && r.URL.Path == "/api/collections/subscriptions/records":
			if r.Header.Get("Authorization") != "Bearer test-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(subStatus)
			if _, err := io.WriteString(w, subBody); err != nil {
				t.Errorf("write subscriptions response: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
}

func testPaidApp() *fiber.App {
	app := fiber.New()
	app.Post("/render", RequirePBAuth, RequireOwnedSession, RequirePaid, func(c *fiber.Ctx) error {
		return c.SendString("render-ok")
	})
	return app
}

func doPaidRender(t *testing.T, app *fiber.App, session string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/render?session="+session, nil)
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
	return resp.StatusCode, string(body)
}

func TestRequirePaid(t *testing.T) {
	tests := []struct {
		name         string
		authBody     string
		subOneStatus int
		subOneBody   string
		subStatus    int
		subBody      string
		bypass       string
		session      string
		wantStatus   int
		wantBody     string
	}{
		{
			name:         "paid flag on user record skips subscription lookup",
			authBody:     `{"record":{"id":"user123","isPaid":true}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusNotFound,
			subBody:      `{"data":{},"message":"Missing collection context.","status":404}`,
			session:      "u_user123",
			wantStatus:   http.StatusOK,
			wantBody:     "render-ok",
		},
		{
			name:         "plan string on user record grants access",
			authBody:     `{"record":{"id":"user123","plan":"pro"}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusNotFound,
			subBody:      `{}`,
			session:      "u_user123",
			wantStatus:   http.StatusOK,
			wantBody:     "render-ok",
		},
		{
			name:         "subscription id equals user id with paid plan grants access",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusOK,
			subOneBody:   `{"id":"user123","plan":"pro"}`,
			subStatus:    http.StatusNotFound,
			subBody:      `{}`,
			session:      "u_user123",
			wantStatus:   http.StatusOK,
			wantBody:     "render-ok",
		},
		{
			name:         "subscription id equals user id with free plan denies without list fallback",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusOK,
			subOneBody:   `{"id":"user123","plan":"free"}`,
			subStatus:    http.StatusOK,
			subBody:      `{"items":[{"id":"sub1","user":"user123","status":"active"}]}`,
			session:      "u_user123",
			wantStatus:   http.StatusPaymentRequired,
			wantBody:     PaidPlanRequiredMessage,
		},
		{
			name:         "direct miss falls back to relation list",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusOK,
			subBody:      `{"items":[{"id":"sub1","user":"user123","status":"active"}]}`,
			session:      "u_user123",
			wantStatus:   http.StatusOK,
			wantBody:     "render-ok",
		},
		{
			name:         "active subscription row grants access",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusOK,
			subBody:      `{"items":[{"id":"sub1","user":"user123","status":"active"}]}`,
			session:      "u_user123",
			wantStatus:   http.StatusOK,
			wantBody:     "render-ok",
		},
		{
			name:         "bare membership row denies with 402 (fail closed)",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusOK,
			subBody:      `{"items":[{"id":"sub1","user":"user123"}]}`,
			session:      "u_user123",
			wantStatus:   http.StatusPaymentRequired,
			wantBody:     PaidPlanRequiredMessage,
		},
		{
			name:         "missing paid collection denies with 402",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusNotFound,
			subBody:      `{"data":{},"message":"Missing collection context.","status":404}`,
			session:      "u_user123",
			wantStatus:   http.StatusPaymentRequired,
			wantBody:     PaidPlanRequiredMessage,
		},
		{
			name:         "empty subscriptions denies with 402",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusOK,
			subBody:      `{"items":[]}`,
			session:      "u_user123",
			wantStatus:   http.StatusPaymentRequired,
			wantBody:     PaidPlanRequiredMessage,
		},
		{
			name:         "canceled subscription denies with 402",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusOK,
			subBody:      `{"items":[{"id":"sub1","user":"user123","status":"canceled"}]}`,
			session:      "u_user123",
			wantStatus:   http.StatusPaymentRequired,
			wantBody:     PaidPlanRequiredMessage,
		},
		{
			name:         "bypass env allows free users",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusNotFound,
			subBody:      `{}`,
			bypass:       "false",
			session:      "u_user123",
			wantStatus:   http.StatusOK,
			wantBody:     "render-ok",
		},
		{
			name:         "wrong project space still 403 before paid check",
			authBody:     `{"record":{"id":"user123"}}`,
			subOneStatus: http.StatusNotFound,
			subOneBody:   `{}`,
			subStatus:    http.StatusOK,
			subBody:      `{"items":[]}`,
			session:      "u_someoneelse",
			wantStatus:   http.StatusForbidden,
			wantBody:     "wrong project space",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := paidTestServer(t, tt.authBody, tt.subOneStatus, tt.subOneBody, tt.subStatus, tt.subBody)
			defer server.Close()
			t.Setenv("POCKETBASE_URL", server.URL)
			if tt.bypass != "" {
				t.Setenv("EXPORT_REQUIRE_PAID", tt.bypass)
			}
			status, body := doPaidRender(t, testPaidApp(), tt.session)
			if status != tt.wantStatus || body != tt.wantBody {
				t.Fatalf("response = %d %q, want %d %q", status, body, tt.wantStatus, tt.wantBody)
			}
		})
	}
}

func TestRecordHasPaidAccess(t *testing.T) {
	paid := []map[string]any{
		{"id": "u1", "isPaid": true},
		{"id": "u1", "plan": "pro"},
		{"id": "u1", "tier": "PREMIUM"},
		{"id": "u1", "status": "trialing"},
		{"id": "u1", "expiresAt": "2099-01-01T00:00:00Z"},
	}
	for i, record := range paid {
		if !recordHasPaidAccess(record) {
			t.Fatalf("paid case %d not granted: %v", i, record)
		}
	}
	free := []map[string]any{
		{},
		nil,
		{"id": "u1"},
		{"id": "u1", "isPaid": false},
		{"id": "u1", "plan": "free"},
		{"id": "u1", "status": "canceled"},
		{"id": "u1", "expiresAt": "2000-01-01T00:00:00Z"},
		{"id": "u1", "plan": "pro", "expiresAt": "2000-01-01T00:00:00Z"},
		{"id": "u1", "isPaid": true, "expiresAt": "invalid"},
		{"id": "u1", "tier": "premium", "status": "refunded"},
	}
	for i, record := range free {
		if recordHasPaidAccess(record) {
			t.Fatalf("free case %d wrongly granted: %v", i, record)
		}
	}
}

func TestSubscriptionRecordGrantsAccess(t *testing.T) {
	for _, record := range []map[string]any{
		{"plan": "pro", "currentPeriodEnd": "2000-01-01T00:00:00Z"},
		{"active": true, "status": "suspended"},
		{"status": "expired", "paidUntil": "2099-01-01T00:00:00Z"},
	} {
		if subscriptionRecordGrantsAccess(record) {
			t.Fatal("conflicting access signals granted paid access", record)
		}
	}
	if subscriptionRecordGrantsAccess(map[string]any{"id": "s1", "user": "u1"}) {
		t.Fatal("bare membership row must deny (fail closed)")
	}
	if !subscriptionRecordGrantsAccess(map[string]any{"id": "s1", "status": "active"}) {
		t.Fatal("active status should grant access")
	}
	if subscriptionRecordGrantsAccess(map[string]any{"id": "s1", "status": "canceled"}) {
		t.Fatal("canceled status should not grant access")
	}
	if subscriptionRecordGrantsAccess(map[string]any{"id": "s1", "active": false}) {
		t.Fatal("active=false should not grant access")
	}
	if !subscriptionRecordGrantsAccess(map[string]any{"id": "s1", "currentPeriodEnd": "2099-01-01T00:00:00Z"}) {
		t.Fatal("future period end should grant access")
	}
}

func TestCustomPaidPlansEnv(t *testing.T) {
	t.Setenv("PB_PAID_PLANS", "gold, lunar")
	if !paidStatusString("gold") {
		t.Fatal("custom plan gold should count as paid")
	}
	if !paidStatusString(" LUNAR ") {
		t.Fatal("custom plan matching should be case-insensitive")
	}
	if !recordHasPaidAccess(map[string]any{"id": "u1", "plan": "gold"}) {
		t.Fatal("user record with custom plan should grant access")
	}
	if paidStatusString("free") {
		t.Fatal("free should not count as paid even with custom plans set")
	}
}
