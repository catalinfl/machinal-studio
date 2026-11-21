package openrouter

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/credits"
)

func meteredContext(t *testing.T) (context.Context, *credits.Store) {
	t.Helper()
	store, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Begin("alice", "operation", true); err != nil {
		t.Fatal(err)
	}
	return credits.WithMeter(context.Background(), &credits.Meter{Store: store, Owner: "alice", ID: "operation", Pricing: credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}}), store
}

func TestCostIsRecordedFromActualUsageAndMissingUsageFailsClosed(t *testing.T) {
	for _, test := range []struct {
		name, body string
		want       float64
		pending    bool
	}{
		{"fractional", `{"id":"gen-one","usage":{"cost":0.00014}}`, 1000, false},
		{"actual", `{"id":"gen-one","usage":{"cost":0.02000015}}`, 990, false},
		{"fractional credits", `{"id":"gen-one","usage":{"cost":0.025}}`, 988, false},
		{"whole credits", `{"id":"gen-one","usage":{"cost":0.03}}`, 985, false},
		{"ten dollar credit budget", `{"id":"gen-one","usage":{"cost":2}}`, 0, false},
		{"free", `{"id":"gen-one","usage":{"cost":0}}`, 1000, false},
		{"unknown", `{"data":[{"b64_json":"abc"}]}`, 1000, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, store := meteredContext(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, test.body) }))
			defer server.Close()
			request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/chat/completions", strings.NewReader(`{}`))
			if err != nil {
				t.Fatal(err)
			}
			_, _, _, err = (Client{BaseURL: server.URL, HTTPClient: server.Client()}).Do(request, 4096, "response")
			if (err != nil) != test.pending {
				t.Fatalf("provider error %v", err)
			}
			credits.Finish(ctx)
			balance, err := store.Balance("alice", true)
			if err != nil || balance.Remaining != test.want || balance.UsagePending != test.pending {
				t.Fatalf("balance: %+v %v", balance, err)
			}
		})
	}
}

func TestAudioCostIsFetchedUsingGenerationMetadata(t *testing.T) {
	ctx, store := meteredContext(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/generation" {
			if r.URL.Query().Get("id") != "gen-audio" {
				t.Error("wrong generation")
			}
			io.WriteString(w, `{"data":{"id":"gen-audio","total_cost":0.025}}`)
			return
		}
		w.Header().Set("X-Generation-Id", "gen-audio")
		io.WriteString(w, "audio fixture")
	}))
	defer server.Close()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/audio/speech", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, err = (Client{BaseURL: server.URL, HTTPClient: server.Client()}).Do(request, 4096, "audio")
	if err != nil {
		t.Fatal(err)
	}
	credits.Finish(ctx)
	balance, err := store.Balance("alice", true)
	if err != nil || balance.Remaining != 988 {
		t.Fatal(balance, err)
	}
}

func TestDeferredRenderUsagePreservesAudioAndQueriesCostAfterGeneration(t *testing.T) {
	ctx, store := meteredContext(t)
	credits.FromContext(ctx).DeferredUsage = true
	metadataCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/generation" {
			metadataCalls++
			io.WriteString(w, `{"data":{"id":"gen-audio","total_cost":0.025}}`)
			return
		}
		w.Header().Set("X-Generation-Id", "gen-audio")
		io.WriteString(w, "audio fixture")
	}))
	defer server.Close()
	client := Client{BaseURL: server.URL, HTTPClient: server.Client()}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/audio/speech", nil)
	if err != nil {
		t.Fatal(err)
	}
	audio, _, _, err := client.Do(request, 4096, "audio")
	if err != nil || string(audio) != "audio fixture" || metadataCalls != 0 {
		t.Fatalf("audio discarded or cost queried before render: %q %d %v", audio, metadataCalls, err)
	}
	if err := credits.ChargeRender(ctx, 72); err != nil {
		t.Fatal(err)
	}
	if err := client.ReconcileUsage(ctx); err != nil {
		t.Fatal(err)
	}
	credits.Finish(ctx)
	balance, err := store.Balance("alice", true)
	if err != nil || balance.Remaining != 986 || balance.UsagePending || metadataCalls != 1 {
		t.Fatalf("post-render accounting: %+v %d %v", balance, metadataCalls, err)
	}
}

func TestDeferredRenderCanContinueWithMissingProviderUsage(t *testing.T) {
	ctx, store := meteredContext(t)
	credits.FromContext(ctx).DeferredUsage = true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "audio fixture") }))
	defer server.Close()
	client := Client{BaseURL: server.URL, HTTPClient: server.Client()}
	for range 2 {
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/audio/speech", nil)
		if err != nil {
			t.Fatal(err)
		}
		audio, _, _, err := client.Do(request, 4096, "audio")
		if err != nil || string(audio) != "audio fixture" {
			t.Fatalf("audio: %q %v", audio, err)
		}
	}
	if err := credits.ChargeRender(ctx, 72); err != nil {
		t.Fatal(err)
	}
	if err := client.ReconcileUsage(ctx); err != credits.ErrPending {
		t.Fatal(err)
	}
	credits.Finish(ctx)
	pending, err := store.Pending("alice")
	if err != nil || pending == nil || len(pending.Attempts) != 2 || pending.Render != 2*credits.UnitsPerCredit {
		t.Fatalf("unknown usage lost: %+v %v", pending, err)
	}
}

func TestUsageReconciliationTargetsItsOwnOperation(t *testing.T) {
	ctx, store := meteredContext(t)
	if err := store.StartAttempt("alice", "operation", "older-pending"); err != nil {
		t.Fatal(err)
	}
	if err := store.Begin("alice", "new-operation", true); err != nil {
		t.Fatal(err)
	}
	ctx = credits.WithMeter(ctx, &credits.Meter{Store: store, Owner: "alice", ID: "new-operation", DeferredUsage: true,
		Pricing: credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}})
	if err := store.StartAttempt("alice", "new-operation", "new-attempt"); err != nil {
		t.Fatal(err)
	}
	if err := store.NoteGeneration("alice", "new-operation", "new-attempt", "gen-new"); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("id") != "gen-new" {
			t.Error("looked up another operation's cost")
		}
		io.WriteString(w, `{"data":{"id":"gen-new","total_cost":0.02}}`)
	}))
	defer server.Close()
	if err := (Client{BaseURL: server.URL, HTTPClient: server.Client()}).ReconcileUsage(ctx); err != nil {
		t.Fatal(err)
	}
	credits.Finish(ctx)
	balance, err := store.Balance("alice", true)
	if err != nil || balance.Remaining != 990 || !balance.UsagePending || balance.Reserved != 0 {
		t.Fatal("independent operation cost was not settled", balance, err)
	}
}
