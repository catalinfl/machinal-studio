package auth

import (
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

type memoryKeys struct{ record APIKeyRecord }

func (s *memoryKeys) List(_ context.Context, owner string) ([]APIKeyRecord, error) {
	if s.record.ID == "" || s.record.Owner != owner || s.record.Revoked {
		return nil, nil
	}
	return []APIKeyRecord{s.record}, nil
}

func (s *memoryKeys) Create(_ context.Context, key APIKeyRecord) (APIKeyRecord, error) {
	key.ID = "key123456789012"
	s.record = key
	return key, nil
}

func (s *memoryKeys) Find(_ context.Context, hash string) (APIKeyRecord, error) {
	if s.record.Hash != hash || s.record.Revoked {
		return APIKeyRecord{}, errInvalidAPIKey
	}
	return s.record, nil
}

func (s *memoryKeys) Revoke(_ context.Context, owner, id string) error {
	if s.record.Owner != owner || s.record.ID != id {
		return errInvalidAPIKey
	}
	s.record.Revoked = true
	return nil
}

func TestAPIKeyLifecycleAndCurrentPremiumAccess(t *testing.T) {
	store := &memoryKeys{}
	paid := true
	keys := &APIKeys{store: func() keyRepository { return store }, access: func(_ context.Context, owner string) (map[string]any, bool, error) {
		return map[string]any{"id": owner}, paid, nil
	}}
	app := fiber.New()
	management := app.Group("/keys", func(c *fiber.Ctx) error { c.Locals("pbUserId", "owner"); return c.Next() })
	management.Post("/", keys.Create)
	management.Get("/", keys.List)
	management.Delete("/:keyID", keys.Revoke)
	app.Get("/render", keys.Require, func(c *fiber.Ctx) error { return c.SendString(UserID(c)) })
	response, err := app.Test(httptest.NewRequest("POST", "/keys", strings.NewReader(`{"name":"Automation"}`)))
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		Key string `json:"key"`
		ID  string `json:"id"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 201 || !strings.HasPrefix(created.Key, "mach_") || len(created.Key) != 69 || store.record.Hash != tokenHash(created.Key) {
		t.Fatal("key was not securely issued")
	}
	response, err = app.Test(httptest.NewRequest("GET", "/keys", nil))
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || strings.Contains(string(data), created.Key) || strings.Contains(string(data), store.record.Hash) {
		t.Fatal("listing exposed a secret")
	}
	check := func(status int) {
		t.Helper()
		request := httptest.NewRequest("GET", "/render", nil)
		request.Header.Set("Authorization", "Bearer "+created.Key)
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != status {
			t.Fatalf("status = %d, want %d", response.StatusCode, status)
		}
	}
	check(200)
	paid = false
	check(402)
	paid = true
	response, err = app.Test(httptest.NewRequest("DELETE", "/keys/"+created.ID, nil))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 204 {
		t.Fatal("revocation failed")
	}
	check(401)
}

func TestAPIKeyRejectsLoginTokensAndUnavailableStore(t *testing.T) {
	keys := NewAPIKeys()
	app := fiber.New()
	app.Get("/", keys.Require, func(c *fiber.Ctx) error { t.Fatal("unauthorized request reached handler"); return nil })
	for _, token := range []string{"", "login-token", "mach_bad", "mach_" + strings.Repeat("0", 64), "dal_" + strings.Repeat("0", 64)} {
		request := httptest.NewRequest("GET", "/", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		t.Setenv("PB_SERVICE_TOKEN", "")
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		want := 401
		if len(token) == 68 || len(token) == 69 {
			want = 503
		}
		if response.StatusCode != want {
			t.Fatalf("status = %d, want %d", response.StatusCode, want)
		}
	}
}

func TestAPIKeyRevokeDoesNotCrossOwners(t *testing.T) {
	store := &memoryKeys{record: APIKeyRecord{ID: "secret", Owner: "another"}}
	keys := &APIKeys{store: func() keyRepository { return store }}
	app := fiber.New()
	app.Delete("/:keyID", func(c *fiber.Ctx) error { c.Locals("pbUserId", "owner"); return c.Next() }, keys.Revoke)
	response, err := app.Test(httptest.NewRequest("DELETE", "/secret", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 404 || store.record.Revoked {
		t.Fatal("another owner's key was revoked")
	}
}

func TestAPIKeyCreationRequiresCurrentPremiumEvenWhenLegacyPaidGateIsDisabled(t *testing.T) {
	t.Setenv("EXPORT_REQUIRE_PAID", "false")
	store := &memoryKeys{}
	keys := &APIKeys{store: func() keyRepository { return store }, access: func(context.Context, string) (map[string]any, bool, error) { return nil, false, nil }}
	app := fiber.New()
	app.Post("/", func(c *fiber.Ctx) error { c.Locals("pbUserId", "owner"); return c.Next() }, keys.Create)
	response, err := app.Test(httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"Automation"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 402 || store.record.ID != "" {
		t.Fatal("a non-Premium account created an application key")
	}
}
