package jobqueue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/credits"
)

func legacySceneStore(t *testing.T) *PocketBase {
	t.Helper()
	var stored Job
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer service-only" {
			t.Error("missing service authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/api/collections/direction_jobs/records/") {
			if r.Method != http.MethodGet || r.URL.Query().Get("fields") != "id,owner,session,input" {
				t.Error("metadata lookup was not a restricted read")
			}
			json.NewEncoder(w).Encode(stored)
			return
		}
		action := strings.TrimPrefix(r.URL.Path, "/api/direction/jobs/")
		if action == "enqueue" {
			var job Job
			if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
				t.Error(err)
			}
			// Deployed hooks predate client-authored scene compilation.
			if job.Kind != "ai-scene" {
				w.WriteHeader(http.StatusBadRequest)
				fmt.Fprint(w, `{"status":400,"message":"Invalid job.","data":{}}`)
				return
			}
			if stored.ID == "" {
				stored = job
				stored.Status = "queued"
			}
		}
		view := stored
		if action != "claim" {
			view.Input = Input{}
		}
		switch action {
		case "list", "active":
			json.NewEncoder(w).Encode([]Job{view})
		case "finish":
			w.WriteHeader(http.StatusNoContent)
		default:
			json.NewEncoder(w).Encode(view)
		}
	}))
	t.Cleanup(server.Close)
	return &PocketBase{Base: server.URL, Token: "service-only", Client: server.Client()}
}

func TestPocketBaseSceneCompilationUsesLegacyQueueWithoutLosingTaskOrBilling(t *testing.T) {
	store := legacySceneStore(t)
	ctx := context.Background()
	submission := pendingJob("alice0000000000", "client-compile")
	submission.Kind = "scene-compile"
	submission.Input.CreditPolicy = credits.MCPFree
	submission.Input.Query = "draft=1&fast=1"
	check := func(job Job, err error) {
		t.Helper()
		if err != nil || job.Kind != submission.Kind || job.ID != submission.ID || job.Input.CreditPolicy != credits.MCPFree || job.Input.Billed {
			t.Fatalf("lost compilation identity or free policy: %+v, %v", job, err)
		}
		if job.Fingerprint != submission.Fingerprint || job.IdempotencyKey != submission.IdempotencyKey || job.Input.Digest != submission.Input.Digest || job.Input.Payload != submission.Input.Payload || job.Input.Query != submission.Input.Query {
			t.Fatal("queue adaptation changed idempotency or payload verification")
		}
	}
	for range 2 {
		check(store.Enqueue(ctx, submission))
	}
	check(store.Get(ctx, submission.Owner, submission.Session, submission.ID))
	check(store.Start(ctx, submission))
	check(store.Heartbeat(ctx, submission, Update{}))
	check(store.Cancel(ctx, submission.Owner, submission.Session, submission.ID))
	claimed, err := store.Claim(ctx, "lease")
	if err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	check(*claimed, nil)
	for _, list := range []func(context.Context) ([]Job, error){
		store.Active,
		func(ctx context.Context) ([]Job, error) { return store.List(ctx, submission.Owner, submission.Session) },
	} {
		jobs, err := list(ctx)
		if err != nil || len(jobs) != 1 {
			t.Fatal(jobs, err)
		}
		check(jobs[0], nil)
	}
	if err := store.Finish(ctx, submission, Result{StatusCode: 200}); err != nil {
		t.Fatal(err)
	}
	if submission.Kind != "scene-compile" {
		t.Fatal("enqueue mutated the caller's job")
	}
}

func TestPocketBaseClaimedCompilationNeverDispatchesPaidSceneGeneration(t *testing.T) {
	store := legacySceneStore(t)
	job := pendingJob("alice0000000000", "dispatch-compile")
	job.Kind, job.Input.CreditPolicy = "scene-compile", credits.MCPFree
	if _, err := store.Enqueue(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	claimed, err := store.Claim(context.Background(), "lease")
	if err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	compiled := false
	service := New(store, map[string]Task{
		"scene-compile": func(ctx context.Context, job Job) Result {
			compiled = true
			if job.Input.Billed || credits.WorkflowPolicyFromContext(ctx) != credits.MCPFree {
				t.Error("compilation became billed")
			}
			return Result{StatusCode: 200, Body: json.RawMessage(`{"ok":true}`)}
		},
		"ai-scene": func(context.Context, Job) Result {
			t.Error("client source dispatched to paid AI generation")
			return failure(500, "incorrect dispatch")
		},
	}, Options{})
	service.execute(context.Background(), *claimed)
	if !compiled {
		t.Fatal("compilation task did not run")
	}
}

func TestPocketBasePreservesExistingSceneJobsAndEmptyClaims(t *testing.T) {
	for _, body := range []string{`null`, `{"kind":"ai-scene","input":{"payload":"0123456789abcdef0123456789abcdef","billed":true}}`, `{"kind":"scene-compile","input":{"creditPolicy":"mcp-free"}}`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, body) }))
			defer server.Close()
			store := &PocketBase{Base: server.URL, Token: "service-only", Client: server.Client()}
			job, err := store.Claim(context.Background(), "lease")
			if err != nil {
				t.Fatal(err)
			}
			var expected *Job
			if err := json.Unmarshal([]byte(body), &expected); err != nil {
				t.Fatal(err)
			}
			if expected == nil {
				if job != nil {
					t.Fatal(job)
				}
			} else if job == nil || job.Kind != expected.Kind || job.Input.Billed != expected.Input.Billed {
				t.Fatal("existing job changed", job)
			}
		})
	}
}

func TestPocketBaseRejectionIncludesActionAndSafeReason(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"message":"Invalid job.","data":{"private":"never log response data"}}`)
	}))
	defer server.Close()
	store := &PocketBase{Base: server.URL, Token: "service-only", Client: server.Client()}
	_, err := store.Enqueue(context.Background(), pendingJob("alice0000000000", "rejected"))
	var rejected *StoreError
	if !errors.As(err, &rejected) || rejected.Status != http.StatusBadRequest || !strings.Contains(err.Error(), "enqueue") || !strings.Contains(err.Error(), "Invalid job.") || strings.Contains(err.Error(), "private") {
		t.Fatal("job store discarded rejection context or exposed response data", err)
	}
}

func TestPocketBaseErrorBodyIsBoundedAndRedactsServiceCredentials(t *testing.T) {
	for _, body := range []string{
		`{"message":"rejected service-only\\nrequest","data":{"secret":"ignored"}}`,
		`{"message":"` + strings.Repeat("x", maxStoreErrorBytes) + `"}`,
		`not JSON`,
	} {
		t.Run(body[:min(12, len(body))], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
				fmt.Fprint(w, body)
			}))
			defer server.Close()
			store := &PocketBase{Base: server.URL, Token: "service-only", Client: server.Client()}
			_, err := store.Enqueue(context.Background(), Job{})
			if err == nil || strings.Contains(err.Error(), store.Token) || strings.Contains(err.Error(), "ignored") || strings.ContainsAny(err.Error(), "\r\n") || len(err.Error()) > maxStoreErrorBytes {
				t.Fatal("unbounded or unsafe store diagnostic", err)
			}
		})
	}
}

func TestPocketBaseMetadataLookupFailsClosedOnWrongOwnerOrProject(t *testing.T) {
	for _, field := range []string{"id", "owner", "session", "input"} {
		t.Run(field, func(t *testing.T) {
			job := pendingJob("alice0000000000", "metadata-scope")
			job.Kind = "ai-scene"
			metadata := job
			switch field {
			case "id":
				metadata.ID = strings.Repeat("b", 32)
			case "owner":
				metadata.Owner = "bob000000000000"
			case "session":
				metadata.Session = "another-project"
			case "input":
				metadata.Input = Input{}
			}
			job.Input = Input{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet {
					json.NewEncoder(w).Encode(metadata)
				} else {
					json.NewEncoder(w).Encode(job)
				}
			}))
			defer server.Close()
			store := &PocketBase{Base: server.URL, Token: "service-only", Client: server.Client()}
			if _, err := store.Get(context.Background(), job.Owner, job.Session, job.ID); err == nil {
				t.Fatal("untrusted or missing dispatch metadata was accepted")
			}
		})
	}
}

func TestPocketBaseAcceptanceDoesNotDependOnPrivateMetadataRead(t *testing.T) {
	job := pendingJob("alice0000000000", "accepted-compilation")
	job.Kind, job.Input.CreditPolicy = "scene-compile", credits.MCPFree
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			t.Error("accepted submission performed another fallible read")
			w.WriteHeader(http.StatusForbidden)
			return
		}
		view := job
		view.Kind, view.Input = "ai-scene", Input{}
		json.NewEncoder(w).Encode(view)
	}))
	defer server.Close()
	store := &PocketBase{Base: server.URL, Token: "service-only", Client: server.Client()}
	accepted, err := store.Enqueue(context.Background(), job)
	if err != nil || accepted.Kind != job.Kind || accepted.Input.Payload != job.ID {
		t.Fatal("successful enqueue became an uncertain rejection", accepted, err)
	}
}
