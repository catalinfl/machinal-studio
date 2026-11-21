package openrouter

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"ffmpeg-go-server/internal/platform/credits"
)

func TestAudioProviderMinimumIsSharedByRESTAndMCP(t *testing.T) {
	for _, policy := range []credits.WorkflowPolicy{"", credits.MCPMediaOnly, credits.MCPServerRender} {
		for _, path := range []string{"/audio/speech", "/audio/transcriptions", "/chat/completions", "/images/generations"} {
			t.Run(string(policy)+path, func(t *testing.T) {
				ctx, store := meteredContext(t)
				ctx = credits.WithWorkflowPolicy(ctx, policy)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					io.WriteString(w, `{"id":"gen-tiny","usage":{"cost":0.00014}}`)
				}))
				defer server.Close()
				request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/api/v1"+path, nil)
				if err != nil {
					t.Fatal(err)
				}
				if _, _, _, err := (Client{HTTPClient: server.Client()}).Do(request, 4096, "fixture"); err != nil {
					t.Fatal(err)
				}
				credits.Finish(ctx)
				want := float64(1000)
				if path == "/audio/speech" || path == "/audio/transcriptions" {
					want--
				}
				if balance, err := store.Balance("alice", true); err != nil || balance.Remaining != want || balance.UsagePending {
					t.Fatal("incorrect action-scoped charge", balance, err)
				}
			})
		}
	}
}

func TestDeferredAudioMinimumIsAppliedDuringReconciliation(t *testing.T) {
	ctx, store := meteredContext(t)
	credits.FromContext(ctx).DeferredUsage = true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/generation" {
			io.WriteString(w, `{"data":{"id":"gen-tiny-audio","total_cost":0.00014}}`)
			return
		}
		w.Header().Set("X-Generation-Id", "gen-tiny-audio")
		io.WriteString(w, "audio fixture")
	}))
	defer server.Close()
	client := Client{BaseURL: server.URL, HTTPClient: server.Client()}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/audio/speech", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := client.Do(request, 4096, "audio"); err != nil {
		t.Fatal(err)
	}
	if balance, err := store.Balance("alice", true); err != nil || !balance.UsagePending || balance.Remaining != 1000 {
		t.Fatal("unknown cost was charged before verification", balance, err)
	}
	if err := client.ReconcileUsage(ctx); err != nil {
		t.Fatal(err)
	}
	credits.Finish(ctx)
	if balance, err := store.Balance("alice", true); err != nil || balance.Remaining != 999 || balance.UsagePending {
		t.Fatal(balance, err)
	}
}

func TestAudioMinimumDoesNotChargeExplicitlyFreeOrRejectedRequests(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusBadRequest} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			ctx, store := meteredContext(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				io.WriteString(w, `{"usage":{"cost":0}}`)
			}))
			defer server.Close()
			request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/audio/transcriptions", nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, _, _, err := (Client{HTTPClient: server.Client()}).Do(request, 4096, "fixture"); err != nil {
				t.Fatal(err)
			}
			credits.Finish(ctx)
			if balance, err := store.Balance("alice", true); err != nil || balance.Remaining != 1000 || balance.UsagePending {
				t.Fatal(balance, err)
			}
		})
	}
}
