package settings

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestKeyVerificationIsAnUnpaidStatusCheckWithRedactedErrors(t *testing.T) {
	for _, test := range []struct {
		upstream, want int
	}{
		{http.StatusOK, 0},
		{http.StatusUnauthorized, fiber.StatusBadRequest},
		{http.StatusForbidden, fiber.StatusBadRequest},
		{http.StatusTooManyRequests, fiber.StatusTooManyRequests},
		{http.StatusInternalServerError, fiber.StatusBadGateway},
	} {
		t.Run(http.StatusText(test.upstream), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/key" || r.Header.Get("Authorization") != "Bearer "+testKey {
					t.Error("key check used an unexpected request")
				}
				w.WriteHeader(test.upstream)
				w.Write([]byte(testKey))
			}))
			defer server.Close()
			err := verifyKey(context.Background(), server.Client(), server.URL+"/key", testKey)
			if test.want == 0 {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var responseError *fiber.Error
			if !errors.As(err, &responseError) || responseError.Code != test.want || strings.Contains(err.Error(), testKey) {
				t.Fatalf("unsafe or unexpected error: %v", err)
			}
		})
	}
}

func TestKeyCheckDoesNotFollowRedirects(t *testing.T) {
	forwarded := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded = true }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client := server.Client()
	client.CheckRedirect = keyCheckClient.CheckRedirect
	if err := verifyKey(context.Background(), client, server.URL, testKey); err == nil || forwarded {
		t.Fatal("key check followed a redirect")
	}
}
