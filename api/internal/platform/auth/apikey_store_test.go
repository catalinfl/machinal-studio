package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPocketBaseKeyStoreUsesServiceCredentialAndNeverStoresSecret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer service-only" {
			t.Error("missing service credential")
		}
		if !strings.HasPrefix(r.URL.Path, "/api/collections/direction_api_keys/records") {
			t.Error("wrong collection")
		}
		if r.Method == http.MethodPost {
			var fields map[string]any
			if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
				t.Fatal(err)
			}
			if _, ok := fields["key"]; ok {
				t.Fatal("stored raw application secret")
			}
			if fields["hash"] != strings.Repeat("a", 64) || fields["owner"] != "owner" {
				t.Fatal("invalid hash or owner")
			}
			fields["id"] = "key-one"
			json.NewEncoder(w).Encode(fields)
			return
		}
		if !strings.Contains(r.URL.Query().Get("filter"), `owner = "owner"`) {
			t.Error("list was not owner-scoped")
		}
		json.NewEncoder(w).Encode(map[string]any{"items": []APIKeyRecord{}})
	}))
	defer server.Close()
	store := pocketBaseKeys{base: server.URL, token: "service-only", client: server.Client()}
	if _, err := store.List(context.Background(), "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(context.Background(), APIKeyRecord{Owner: "owner", Hash: strings.Repeat("a", 64), Name: "Pipeline", Prefix: "mach_aaaaaaaa"}); err != nil {
		t.Fatal(err)
	}
}

func TestAPIKeyPremiumLookupUsesCurrentBackendUserRecord(t *testing.T) {
	paid := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer service-only" {
			t.Error("customer key reached PocketBase")
		}
		if strings.Contains(r.URL.Path, "/users/records/owner") {
			json.NewEncoder(w).Encode(map[string]any{"id": "owner", "isPaid": paid})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/subscriptions/records/owner") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"items": []any{}})
	}))
	defer server.Close()
	t.Setenv("POCKETBASE_URL", server.URL)
	t.Setenv("PB_SERVICE_TOKEN", "service-only")
	if _, allowed, err := apiKeyPaidAccess(context.Background(), "owner"); err != nil || !allowed {
		t.Fatalf("paid lookup: %v, %v", allowed, err)
	}
	paid = false
	if _, allowed, err := apiKeyPaidAccess(context.Background(), "owner"); err != nil || allowed {
		t.Fatalf("expired lookup: %v, %v", allowed, err)
	}
}
