package paypal

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCaptureUsesStableIdempotencyReferenceAndVerifiesFullOrder(t *testing.T) {
	var captures, lookups, authentications int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/oauth2/token" {
			authentications++
			id, secret, ok := r.BasicAuth()
			if !ok || id != "client" || secret != "secret" {
				t.Error("invalid server credentials")
			}
			io.WriteString(w, `{"access_token":"server-token","expires_in":3600}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer server-token" {
			t.Error("missing server authentication")
		}
		if r.Method == http.MethodPost {
			captures++
			if r.Header.Get("PayPal-Request-Id") != "reference-capture" {
				t.Error("unstable idempotency key")
			}
			if captures > 1 {
				w.WriteHeader(422)
				io.WriteString(w, `{}`)
				return
			}
			io.WriteString(w, `{"id":"ORDER123","status":"COMPLETED"}`)
			return
		}
		lookups++
		io.WriteString(w, `{"id":"ORDER123","status":"COMPLETED","intent":"CAPTURE"}`)
	}))
	defer server.Close()
	client := &Client{BaseURL: server.URL, HTTP: server.Client(), ClientID: "client", Secret: "secret"}
	for i := 0; i < 2; i++ {
		result, err := client.Capture(context.Background(), "ORDER123", "reference")
		if err != nil || result.Intent != "CAPTURE" {
			t.Fatal(result, err)
		}
	}
	if captures != 2 || lookups != 2 || authentications != 1 {
		t.Fatal(captures, lookups, authentications)
	}
}

func TestApprovalURLRejectsExternalHostsAndCredentials(t *testing.T) {
	for _, target := range []string{"https://evil.test/", "https://www.paypal.com.evil.test/", "https://user@www.paypal.com/", "http://www.paypal.com/", "https://www.paypal.com:444/"} {
		raw, err := json.Marshal(map[string]any{"links": []map[string]string{{"rel": "approve", "href": target}}})
		if err != nil {
			t.Fatal(err)
		}
		var order Order
		if err := json.Unmarshal(raw, &order); err != nil {
			t.Fatal(err)
		}
		if order.ApprovalURL() != "" {
			t.Fatal("untrusted redirect accepted", target)
		}
	}
}
