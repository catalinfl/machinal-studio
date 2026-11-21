package jobqueue

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func testPocketBase(t *testing.T) *PocketBase {
	t.Helper()
	binary := os.Getenv("POCKETBASE_TEST_BINARY")
	if binary == "" {
		t.Skip("set POCKETBASE_TEST_BINARY to run isolated PocketBase migration/hook integration tests")
	}
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	migrations := filepath.Join(dir, "migrations")
	if err := os.MkdirAll(migrations, 0700); err != nil {
		t.Fatal(err)
	}
	bootstrap := `migrate((app) => { try { app.findCollectionByNameOrId('users'); return } catch (_) {} app.save(new Collection({name:'users',type:'auth',fields:[]})) })`
	if err := os.WriteFile(filepath.Join(migrations, "1_test_users.js"), []byte(bootstrap), 0600); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(root, "pocketbase", "pb_migrations"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(root, "pocketbase", "pb_migrations", entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(migrations, entry.Name()), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	flags := []string{"--dir", filepath.Join(dir, "data"), "--migrationsDir", migrations, "--hooksDir", filepath.Join(root, "pocketbase", "pb_hooks")}
	command := exec.Command(binary, append([]string{"superuser", "upsert", "jobs@example.test", "integration-password-123"}, flags...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("create test superuser: %v\n%s", err, output)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	command = exec.Command(binary, append([]string{"serve", "--http", address}, flags...)...)
	logFile, err := os.Create(filepath.Join(dir, "pocketbase.log"))
	if err != nil {
		t.Fatal(err)
	}
	command.Stdout, command.Stderr = logFile, logFile
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { command.Process.Kill(); command.Wait(); logFile.Close() })
	store := &PocketBase{Base: "http://" + address, Client: &http.Client{Timeout: 5 * time.Second}}
	deadline := time.Now().Add(10 * time.Second)
	for {
		response, err := store.Client.Get(store.Base + "/api/health")
		if err == nil {
			response.Body.Close()
			break
		}
		if time.Now().After(deadline) {
			data, _ := os.ReadFile(logFile.Name())
			t.Fatalf("start isolated PocketBase: %v\n%s", err, data)
		}
		time.Sleep(50 * time.Millisecond)
	}
	var auth struct {
		Token string `json:"token"`
	}
	pbJSON(t, store, "/api/collections/_superusers/auth-with-password", "POST", map[string]string{"identity": "jobs@example.test", "password": "integration-password-123"}, &auth)
	store.Token = auth.Token
	for _, id := range []string{"alice0000000000", "bob000000000000", "carol0000000000"} {
		pbJSON(t, store, "/api/collections/users/records", "POST", map[string]string{"id": id, "email": id + "@example.test", "password": "test-password-123", "passwordConfirm": "test-password-123"}, nil)
	}
	return store
}

func pbJSON(t *testing.T, store *PocketBase, path, method string, input, output any) {
	t.Helper()
	data, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(method, store.Base+path, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+store.Token)
	response, err := store.Client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("%s %s: %d %s", method, path, response.StatusCode, body)
	}
	if output != nil {
		if err := json.NewDecoder(response.Body).Decode(output); err != nil {
			t.Fatal(err)
		}
	}
}

func pendingJob(owner, key string) Job {
	hash := sha256.Sum256([]byte(key))
	id := hex.EncodeToString(hash[:16])
	return Job{ID: id, Owner: owner, Session: "u_" + owner, Kind: "ai-image", Fingerprint: hex.EncodeToString(hash[:]),
		IdempotencyKey: hex.EncodeToString(hash[:]), InputBytes: len(`{"prompt":"tree"}`), Input: Input{Payload: id, Digest: hex.EncodeToString(hash[:]), ContentType: "application/json"}}
}

func TestPocketBaseQueueTransactions(t *testing.T) {
	store := testPocketBase(t)
	ctx := context.Background()
	job, err := store.Enqueue(ctx, pendingJob("alice0000000000", "first"))
	if err != nil {
		t.Fatal(err)
	}
	if !idPattern.MatchString(job.ID) || job.Status != "queued" {
		t.Fatal(job)
	}
	again, err := store.Enqueue(ctx, pendingJob("alice0000000000", "first"))
	if err != nil || again.ID != job.ID {
		t.Fatal(again, err)
	}
	conflict := pendingJob("alice0000000000", "first")
	conflict.Fingerprint = fmt.Sprintf("%064d", 1)
	if _, err := store.Enqueue(ctx, conflict); err == nil {
		t.Fatal("idempotency conflict accepted")
	}
	if _, err := store.Get(ctx, "bob000000000000", job.Session, job.ID); err != ErrNotFound {
		t.Fatalf("cross-owner read: %v", err)
	}
	if _, err := store.Cancel(ctx, job.Owner, "wrong-session", job.ID); err != ErrNotFound {
		t.Fatalf("cross-project cancellation: %v", err)
	}
	unauthorized, err := store.Client.Post(store.Base+"/api/direction/jobs/claim", "application/json", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized && unauthorized.StatusCode != http.StatusForbidden {
		t.Fatal("worker endpoint allowed unauthenticated access", unauthorized.StatusCode)
	}
	for _, owner := range []string{"bob000000000000", "carol0000000000"} {
		if _, err := store.Enqueue(ctx, pendingJob(owner, owner)); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	claimed := map[string]Job{}
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			lease, _ := randomID()
			current, err := store.Claim(ctx, lease)
			if err != nil {
				t.Errorf("claim: %v", err)
				return
			}
			if current != nil {
				mu.Lock()
				defer mu.Unlock()
				if _, duplicate := claimed[current.ID]; duplicate {
					t.Error("job claimed twice")
				}
				claimed[current.ID] = *current
			}
		}()
	}
	wg.Wait()
	if len(claimed) != 3 {
		t.Fatalf("claimed %d jobs, want 3", len(claimed))
	}
	running, err := store.Start(ctx, claimed[job.ID])
	if err != nil {
		t.Fatal(err)
	}
	current, err := store.Heartbeat(ctx, running, Update{Progress: .4, Message: "Generating", Snapshot: json.RawMessage(`{"scenes":[]}`)})
	if err != nil || current.Progress != .4 || current.Message != "Generating" {
		t.Fatal(current, err)
	}
	result := Result{StatusCode: 200, ContentType: "application/json", Body: json.RawMessage(`{"filename":"result.mp4"}`)}
	for range 2 {
		if err := store.Finish(ctx, running, result); err != nil {
			t.Fatal(err)
		}
	}
	completed, err := store.Get(ctx, job.Owner, job.Session, job.ID)
	if err != nil || completed.Status != "completed" || completed.View()["filename"] != "result.mp4" {
		t.Fatal(completed, err)
	}
	for id, claimedJob := range claimed {
		if id == job.ID {
			continue
		}
		running, err := store.Start(ctx, claimedJob)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.Cancel(ctx, running.Owner, running.Session, running.ID); err != nil {
			t.Fatal(err)
		}
		observed, err := store.Heartbeat(ctx, running, Update{})
		if err != nil || !observed.CancelRequested {
			t.Fatal("worker could not observe cancellation", observed, err)
		}
		if err := store.Finish(ctx, running, failure(408, "interrupted")); err != nil {
			t.Fatal(err)
		}
		cancelled, err := store.Get(ctx, running.Owner, running.Session, running.ID)
		if err != nil || cancelled.Status != "cancelled" {
			t.Fatal(cancelled, err)
		}
		break
	}
}

func TestPocketBaseQueueRecoveryAndLimits(t *testing.T) {
	store := testPocketBase(t)
	ctx := context.Background()
	job, err := store.Enqueue(ctx, pendingJob("alice0000000000", "restart"))
	if err != nil {
		t.Fatal(err)
	}
	lease, _ := randomID()
	claimed, err := store.Claim(ctx, lease)
	if err != nil || claimed == nil {
		t.Fatal(claimed, err)
	}
	path := "/api/collections/direction_jobs/records/" + job.ID
	pbJSON(t, store, path, "PATCH", map[string]any{"leaseUntil": 1}, nil)
	lease, _ = randomID()
	claimed, err = store.Claim(ctx, lease)
	if err != nil || claimed == nil || claimed.ID != job.ID || claimed.Attempts != 2 {
		t.Fatal(claimed, err)
	}
	running, err := store.Start(ctx, *claimed)
	if err != nil {
		t.Fatal(err)
	}
	pbJSON(t, store, path, "PATCH", map[string]any{"leaseUntil": 1}, nil)
	lease, _ = randomID()
	if replay, err := store.Claim(ctx, lease); err != nil || replay != nil {
		t.Fatalf("running job replayed after interruption: %v %v", replay, err)
	}
	if err := store.Finish(ctx, running, failure(500, "stale worker")); err != ErrLeaseLost {
		t.Fatalf("stale worker wrote a result: %v", err)
	}
	failed, err := store.Get(ctx, job.Owner, job.Session, job.ID)
	if err != nil || failed.Status != "failed" {
		t.Fatal(failed, err)
	}
	for i := range 10 {
		if _, err := store.Enqueue(ctx, pendingJob(job.Owner, fmt.Sprint("limit", i))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.Enqueue(ctx, pendingJob(job.Owner, "overflow")); err == nil {
		t.Fatal("owner backlog limit not enforced")
	}
	jobs, err := store.List(ctx, job.Owner, job.Session)
	if err != nil || len(jobs) != 11 {
		t.Fatal(len(jobs), err)
	}
	cancelled, err := store.Cancel(ctx, job.Owner, job.Session, jobs[0].ID)
	if err != nil || cancelled.Status != "cancelled" {
		t.Fatal(cancelled, err)
	}
}

func TestPocketBaseWorkerRestartProcessesSavedBacklog(t *testing.T) {
	store := testPocketBase(t)
	old := storage.DataDir
	storage.DataDir = t.TempDir()
	defer func() { storage.DataDir = old }()
	ctx := context.Background()
	first, err := store.Enqueue(ctx, pendingJob("alice0000000000", "slow"))
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	service := New(store, map[string]Task{"ai-image": func(ctx context.Context, job Job) Result {
		close(started)
		<-ctx.Done()
		return failure(408, "interrupted")
	}}, Options{Workers: 1, PollInterval: time.Millisecond})
	service.Start(ctx)
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		service.Close()
		t.Fatal("worker did not start")
	}
	second, err := store.Enqueue(ctx, pendingJob("alice0000000000", "saved-backlog"))
	if err != nil {
		service.Close()
		t.Fatal(err)
	}
	pending, err := store.Get(ctx, second.Owner, second.Session, second.ID)
	if err != nil || pending.Status != "queued" {
		service.Close()
		t.Fatal(pending, err)
	}
	service.Close()
	recovered := make(chan string, 1)
	service = New(store, map[string]Task{"ai-image": func(_ context.Context, job Job) Result {
		recovered <- job.ID
		return Result{StatusCode: 200, ContentType: "application/json", Body: json.RawMessage(`{"name":"generated.png"}`)}
	}}, Options{Workers: 1, PollInterval: time.Millisecond})
	service.Start(ctx)
	defer service.Close()
	select {
	case id := <-recovered:
		if id != second.ID || id == first.ID {
			t.Fatal("wrong job resumed", id)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("saved backlog was not resumed by the new worker")
	}
}

func TestPocketBaseHTTPJobDetachesFromTheSubmittingRequest(t *testing.T) {
	const owner = "alice0000000000"
	store := testPocketBase(t)
	old := storage.DataDir
	storage.DataDir = t.TempDir()
	defer func() { storage.DataDir = old }()
	started, release := make(chan struct{}), make(chan struct{})
	service := New(store, map[string]Task{"ai-image": FiberTask(func(c *fiber.Ctx) error {
		close(started)
		select {
		case <-release:
			return c.JSON(fiber.Map{"received": string(c.Body()), "owner": c.Locals("pbUserId")})
		case <-c.UserContext().Done():
			return fiber.NewError(408, "cancelled")
		}
	})}, Options{Workers: 1, PollInterval: time.Millisecond})
	service.Start(context.Background())
	defer service.Close()
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice0000000000"); return c.Next() })
	app.Post("/submit", service.Submit("ai-image", false))
	app.Get("/jobs/:id", service.Status)
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest("POST", "/submit", bytes.NewBufferString(`{"prompt":"saved request"}`)).WithContext(ctx)
	request.Header.Set("X-Session-Id", "u_alice0000000000")
	response, err := app.Test(request)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	var accepted Job
	if err := json.NewDecoder(response.Body).Decode(&accepted); err != nil {
		response.Body.Close()
		cancel()
		t.Fatal(err)
	}
	response.Body.Close()
	cancel()
	if response.StatusCode != 202 || accepted.ID == "" {
		t.Fatal("HTTP request did not return a saved job", response.StatusCode, accepted)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("persisted handler did not execute")
	}
	running, err := store.Get(context.Background(), owner, "u_alice0000000000", accepted.ID)
	if err != nil || running.Status != "running" {
		t.Fatal("submitting request cancellation affected the worker", running, err)
	}
	close(release)
	deadline := time.Now().Add(5 * time.Second)
	for {
		statusRequest := httptest.NewRequest("GET", "/jobs/"+accepted.ID, nil)
		statusRequest.Header.Set("X-Session-Id", "u_alice0000000000")
		response, err := app.Test(statusRequest)
		if err != nil {
			t.Fatal(err)
		}
		var status Job
		err = json.NewDecoder(response.Body).Decode(&status)
		response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if status.Status == "completed" {
			var result map[string]string
			if err := json.Unmarshal(status.Result, &result); err != nil || result["received"] != `{"prompt":"saved request"}` || result["owner"] != owner {
				t.Fatal("saved result did not match the original request", result, err)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("job did not complete", status)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
