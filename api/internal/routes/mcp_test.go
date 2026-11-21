package routes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ffmpeg-go-server/internal/core/billing"
	"ffmpeg-go-server/internal/core/projects"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/mcpserver"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	mcpAliceKey = "mach_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	mcpBobKey   = "mach_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

type mcpJobStore struct {
	jobqueue.Repository
	mu    sync.Mutex
	items map[string]jobqueue.Job
}

func (s *mcpJobStore) Enqueue(_ context.Context, job jobqueue.Job) (jobqueue.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.items {
		if existing.IdempotencyKey == job.IdempotencyKey {
			if existing.Fingerprint != job.Fingerprint {
				return jobqueue.Job{}, &jobqueue.StoreError{Status: 409}
			}
			return existing, nil
		}
	}
	job.Status = "queued"
	s.items[job.ID] = job
	return job, nil
}

func (s *mcpJobStore) Get(_ context.Context, owner, session, id string) (jobqueue.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.items[id]
	if !ok || job.Owner != owner || job.Session != session {
		return jobqueue.Job{}, jobqueue.ErrNotFound
	}
	return job, nil
}

func (s *mcpJobStore) List(_ context.Context, owner, session string) ([]jobqueue.Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := []jobqueue.Job{}
	for _, job := range s.items {
		if job.Owner == owner && job.Session == session {
			items = append(items, job)
		}
	}
	return items, nil
}

func (s *mcpJobStore) Cancel(ctx context.Context, owner, session, id string) (jobqueue.Job, error) {
	job, err := s.Get(ctx, owner, session, id)
	if err != nil {
		return jobqueue.Job{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	job.Status = "cancelled"
	s.items[id] = job
	return job, nil
}

type mcpFixture struct {
	app         *fiber.App
	store       *projects.Store
	project     projects.Project
	jobs        *mcpJobStore
	billing     *billing.Handler
	revoked     atomic.Bool
	unpaid      atomic.Bool
	keyReads    atomic.Int32
	accessReads atomic.Int32
}

func newMCPFixture(t *testing.T) *mcpFixture {
	t.Helper()
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	t.Setenv("MCP_ALLOWED_ORIGINS", "https://editor.example")
	t.Setenv("PUBLIC_API_URL", "https://api.example")
	t.Setenv("PB_SERVICE_TOKEN", "backend-service-secret")
	fixture := &mcpFixture{jobs: &mcpJobStore{items: make(map[string]jobqueue.Job)}}
	pb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer backend-service-secret" {
			t.Error("customer credential was sent to PocketBase")
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/collections/direction_api_keys/records":
			fixture.keyReads.Add(1)
			items := []map[string]any{}
			for key, owner := range map[string]string{mcpAliceKey: "mcpalice", mcpBobKey: "mcpbob"} {
				digest := sha256.Sum256([]byte(key))
				hash := hex.EncodeToString(digest[:])
				filter := r.URL.Query().Get("filter")
				if (strings.Contains(filter, hash) || strings.Contains(filter, `owner = "`+owner+`"`)) && !(owner == "mcpalice" && fixture.revoked.Load()) {
					items = append(items, map[string]any{"id": "key_" + owner, "owner": owner, "hash": hash, "revoked": false})
				}
			}
			json.NewEncoder(w).Encode(map[string]any{"items": items})
		case strings.HasPrefix(r.URL.Path, "/api/collections/users/records/"):
			fixture.accessReads.Add(1)
			owner := strings.TrimPrefix(r.URL.Path, "/api/collections/users/records/")
			json.NewEncoder(w).Encode(map[string]any{"id": owner, "paid": !fixture.unpaid.Load()})
		case r.URL.Path == "/api/collections/subscriptions/records":
			io.WriteString(w, `{"items":[]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(pb.Close)
	t.Setenv("POCKETBASE_URL", pb.URL)
	fixture.store = projects.NewStore()
	var err error
	fixture.project, err = fixture.store.Create("mcpalice", "MCP film")
	if err != nil {
		t.Fatal(err)
	}
	ledger, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ledger.Close() })
	t.Setenv("CREDIT_PACKS_JSON", "")
	t.Setenv("PAYPAL_CLIENT_ID", "")
	t.Setenv("PAYPAL_CLIENT_SECRET", "")
	fixture.billing, err = billing.New(ledger)
	if err != nil {
		t.Fatal(err)
	}
	fixture.billing.Pricing = credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "1"}
	fixture.app = fiber.New(fiber.Config{BodyLimit: 2 * mcpserver.MaxRequestBytes})
	registerAutomationRoutes(fixture.app, fixture.store, jobqueue.New(fixture.jobs, nil, jobqueue.Options{}), fixture.billing)
	return fixture
}

func TestMCPDeliveryLinkIsOneFileRevocableAndRechecksAccess(t *testing.T) {
	fixture := newMCPFixture(t)
	root, err := storage.EnsureUserDir(fixture.project.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), []byte("only-approved-file"), 0600); err != nil {
		t.Fatal(err)
	}
	result, output := mcpTool(t, fixture, mcpAliceKey, "get_media_download", map[string]any{
		"projectId": fixture.project.ID, "file": "clip.mp4", "storage": "volume", "userApproved": true,
	})
	if result.IsError {
		t.Fatal(result, output)
	}
	descriptor := output.Data.(map[string]any)["download"].(map[string]any)
	url := descriptor["url"].(string)
	if strings.Contains(url, "Amz") || strings.Contains(url, mcpAliceKey) || output.Data.(map[string]any)["destination"] != nil {
		t.Fatal("unsafe or incorrect link delivery", descriptor)
	}
	check := func(status int) {
		t.Helper()
		request := httptest.NewRequest("GET", url+"?file=another.mp4&session=foreign", nil)
		request.RequestURI = request.URL.RequestURI()
		response, err := fixture.app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != status || status == 200 && string(data) != "only-approved-file" {
			t.Fatal("download scope/access failed", response.StatusCode, string(data), err)
		}
	}
	check(200)
	fixture.revoked.Store(true)
	check(404)
	fixture.revoked.Store(false)
	fixture.unpaid.Store(true)
	check(404)
	fixture.unpaid.Store(false)
	foreignResult, _ := mcpTool(t, fixture, mcpBobKey, "revoke_delivery_link", map[string]any{"projectId": fixture.project.ID, "linkId": descriptor["id"], "userApproved": true})
	if !foreignResult.IsError {
		t.Fatal("foreign account revoked a link")
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "revoke_delivery_link", map[string]any{"projectId": fixture.project.ID, "linkId": descriptor["id"], "userApproved": true})
	if result.IsError || output.StatusCode != 204 {
		t.Fatal("owned link revocation failed", result, output)
	}
	check(404)
}

func TestMCPToolSelectionUsesTheCurrentClientWithoutProviderCallsOrCharges(t *testing.T) {
	fixture := newMCPFixture(t)
	before, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		t.Error("MCP tool selection called a server provider")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer provider.Close()
	t.Setenv("OPENROUTER_API_KEY", "provider-only-key")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL+"/v1")
	t.Setenv("OPENROUTER_JEV_BASE_URL", "")
	result, output := mcpTool(t, fixture, mcpAliceKey, "suggest_tools", map[string]any{"prompt": "Alege toolurile pentru un film documentar", "userApproved": true})
	if result.IsError || calls != 0 || len(fixture.jobs.items) != 0 || output.Data.(map[string]any)["executed"] != false || output.Data.(map[string]any)["selectionBy"] != "current-client-ai" {
		t.Fatal("router executed work or did not return suggestions", result, output)
	}
	after, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil || before.Remaining != after.Remaining || after.Reserved != 0 {
		t.Fatal("client tool selection consumed credits", before, after, err)
	}
	result, _ = mcpTool(t, fixture, mcpAliceKey, "suggest_tools", map[string]any{"prompt": "Render", "userApproved": false})
	if result.IsError || calls != 0 {
		t.Fatal("free catalog incorrectly required spending approval or called a provider")
	}
}

func mcpRPC(t *testing.T, app *fiber.App, key, method string, params any) (*http.Response, []byte) {
	t.Helper()
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/mcp", strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("MCP-Protocol-Version", "2025-11-25")
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := app.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response, data
}

func mcpTool(t *testing.T, fixture *mcpFixture, key, tool string, args any) (mcp.CallToolResult, mcpserver.Output) {
	t.Helper()
	response, data := mcpRPC(t, fixture.app, key, "tools/call", map[string]any{"name": tool, "arguments": args})
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if response.StatusCode != 200 || json.Unmarshal(data, &envelope) != nil || envelope.Error != nil {
		t.Fatalf("%s: %d %s", tool, response.StatusCode, data)
	}
	var result mcp.CallToolResult
	if err := json.Unmarshal(envelope.Result, &result); err != nil {
		t.Fatal(err)
	}
	var raw struct {
		Output mcpserver.Output `json:"structuredContent"`
	}
	if err := json.Unmarshal(envelope.Result, &raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), key) || strings.Contains(string(data), "backend-service-secret") {
		t.Fatal("credentials leaked into an MCP result")
	}
	return result, raw.Output
}

func TestMCPRequiresCurrentAPIKeyForEveryRequest(t *testing.T) {
	fixture := newMCPFixture(t)
	for _, key := range []string{"", "pocketbase-login-token", "mach_invalid"} {
		response, body := mcpRPC(t, fixture.app, key, "tools/list", map[string]any{})
		if response.StatusCode != 401 || response.Header.Get("WWW-Authenticate") == "" || !strings.Contains(string(body), "/api-keys") {
			t.Fatalf("unauthenticated catalog: %d %s", response.StatusCode, body)
		}
	}
	response, _ := mcpRPC(t, fixture.app, mcpAliceKey, "tools/list", map[string]any{})
	if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("MCP-Session-Id") != "" {
		t.Fatal("authenticated stateless catalog failed", response.StatusCode)
	}
	fixture.unpaid.Store(true)
	response, _ = mcpRPC(t, fixture.app, mcpAliceKey, "resources/list", map[string]any{})
	if response.StatusCode != 402 {
		t.Fatal("expired Premium retained MCP access", response.StatusCode)
	}
	fixture.unpaid.Store(false)
	fixture.revoked.Store(true)
	response, _ = mcpRPC(t, fixture.app, mcpAliceKey, "tools/list", map[string]any{})
	if response.StatusCode != 401 {
		t.Fatal("revoked key retained MCP access", response.StatusCode)
	}
	fixture.revoked.Store(false)
	t.Setenv("PB_SERVICE_TOKEN", "")
	response, _ = mcpRPC(t, fixture.app, mcpAliceKey, "tools/list", map[string]any{})
	if response.StatusCode != 503 {
		t.Fatal("PocketBase outage failed open", response.StatusCode)
	}
}

func TestMCPProjectSaveIsOwnedAndVersioned(t *testing.T) {
	fixture := newMCPFixture(t)
	args := map[string]any{"projectId": fixture.project.ID}
	result, output := mcpTool(t, fixture, mcpBobKey, "get_project", args)
	if !result.IsError || output.StatusCode != 404 {
		t.Fatal("foreign project was readable", result, output)
	}
	save := map[string]any{"projectId": fixture.project.ID, "name": "Edited by MCP", "version": 1,
		"state": map[string]any{"schemaVersion": 1, "timeline": map[string]any{"channels": []any{}}, "media": []any{}, "keep": "unrelated"}}
	result, output = mcpTool(t, fixture, mcpBobKey, "save_project", save)
	if !result.IsError || output.StatusCode != 404 {
		t.Fatal("foreign project was writable", result, output)
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "save_project", save)
	if result.IsError || output.StatusCode != 200 || output.Data.(map[string]any)["version"] != float64(2) {
		t.Fatal("owned project save failed", result, output)
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "save_project", save)
	if !result.IsError || output.StatusCode != 409 {
		t.Fatal("stale state silently overwrote project", result, output)
	}
	_, output = mcpTool(t, fixture, mcpAliceKey, "get_project", args)
	if output.Data.(map[string]any)["detail"] != "summary" || output.Data.(map[string]any)["state"] != nil {
		t.Fatal("default project verification returned the entire editor state", output)
	}
	args["fullResult"] = true
	_, output = mcpTool(t, fixture, mcpAliceKey, "get_project", args)
	state := output.Data.(map[string]any)["state"].(map[string]any)
	if state["keep"] != "unrelated" {
		t.Fatal("save dropped unknown editor fields", state)
	}
	request := httptest.NewRequest("POST", "/v1/projects/"+fixture.project.ID, strings.NewReader(`{"name":"REST save","version":2}`))
	request.Header.Set("Authorization", "Bearer "+mcpAliceKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := fixture.app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("versioned project save route is missing", response.StatusCode)
	}
}

func TestMCPSubmitsBilledIdempotentServerRendersAndRespectsProjectScope(t *testing.T) {
	fixture := newMCPFixture(t)
	args := map[string]any{"projectId": fixture.project.ID, "composition": "document: {version: 1}", "idempotencyKey": "render-once", "userApproved": true}
	result, output := mcpTool(t, fixture, mcpAliceKey, "render_video", args)
	if result.IsError || output.StatusCode != 202 || output.StatusURL == "" {
		t.Fatal("render did not queue", result, output)
	}
	jobID := output.Data.(map[string]any)["id"].(string)
	job, err := fixture.jobs.Get(context.Background(), "mcpalice", fixture.project.SessionID, jobID)
	if err != nil || job.Kind != "automation-render" || !job.Input.Billed || job.Input.CreditPolicy != credits.MCPServerRender || job.Input.ContentType != "application/yaml" {
		t.Fatal("MCP render did not persist server billing", job, err)
	}
	_, repeated := mcpTool(t, fixture, mcpAliceKey, "render_video", args)
	if repeated.Data.(map[string]any)["id"] != jobID {
		t.Fatal("submission retry created another job")
	}
	args["composition"] = "document: {version: 2}"
	result, output = mcpTool(t, fixture, mcpAliceKey, "render_video", args)
	if !result.IsError || output.StatusCode != 409 {
		t.Fatal("idempotency mismatch was accepted", result, output)
	}
	foreign, err := fixture.store.Create("mcpalice", "Another project")
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{mcpAliceKey, mcpBobKey} {
		projectID := fixture.project.ID
		if key == mcpAliceKey {
			projectID = foreign.ID
		}
		result, output = mcpTool(t, fixture, key, "get_job", map[string]any{"projectId": projectID, "jobId": jobID})
		if !result.IsError || output.StatusCode != 404 {
			t.Fatal("job escaped account/project scope", result, output)
		}
	}
	fixture.jobs.mu.Lock()
	job.Status, job.StatusCode = "completed", 200
	job.Result = json.RawMessage(`{"filename":"render_mcp.mp4"}`)
	fixture.jobs.items[job.ID] = job
	fixture.jobs.mu.Unlock()
	result, output = mcpTool(t, fixture, mcpAliceKey, "get_video_result", map[string]any{"projectId": fixture.project.ID, "jobId": jobID, "userApproved": true})
	if !result.IsError || output.StatusCode != 404 {
		t.Fatal("missing local output must not fall back to cloud storage", result, output)
	}
	fixture.billing.Pricing = credits.Pricing{}
	args["idempotencyKey"] = "blocked-without-pricing"
	result, output = mcpTool(t, fixture, mcpAliceKey, "render_video", args)
	if !result.IsError || output.StatusCode != 503 {
		t.Fatal("MCP server rendering bypassed pricing", result, output)
	}
}

func TestMCPValidatesOriginAndBodyLimit(t *testing.T) {
	fixture := newMCPFixture(t)
	for _, test := range []struct {
		origin string
		status int
	}{
		{"", 405}, {"https://editor.example", 405}, {"https://evil.example", 403}, {"null", 403},
	} {
		request := httptest.NewRequest("GET", "/mcp", nil)
		request.Header.Set("Authorization", "Bearer "+mcpAliceKey)
		request.Header.Set("Origin", test.origin)
		response, err := fixture.app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != test.status {
			t.Fatal(test.origin, response.StatusCode, test.status)
		}
	}
	request := httptest.NewRequest("POST", "/mcp", strings.NewReader(strings.Repeat(" ", mcpserver.MaxRequestBytes+1)))
	response, err := fixture.app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 413 {
		t.Fatal("oversized MCP body accepted", response.StatusCode)
	}
}

func TestMCPMediaAndDownloadPreferencesStayAccountScoped(t *testing.T) {
	fixture := newMCPFixture(t)
	args := map[string]any{"projectId": fixture.project.ID, "storage": "volume", "userApproved": true}
	result, output := mcpTool(t, fixture, mcpBobKey, "list_media", args)
	if !result.IsError || output.StatusCode != 404 {
		t.Fatal("consent must not override project ownership", result, output)
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "list_media", args)
	if result.IsError || output.StatusCode != 200 || output.Data.(map[string]any)["storage"] != "volume" {
		t.Fatal("approved owned volume listing failed", result, output)
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "set_download_preferences", map[string]any{"directory": "C:\\Videos", "userApproved": true})
	if result.IsError || output.StatusCode != 200 {
		t.Fatal("could not save local output preference", result, output)
	}
	_, output = mcpTool(t, fixture, mcpBobKey, "get_download_preferences", map[string]any{})
	if output.Data.(map[string]any)["directory"] != "" {
		t.Fatal("another account read the preference", output)
	}
	_, output = mcpTool(t, fixture, mcpAliceKey, "get_download_preferences", map[string]any{})
	if output.Data.(map[string]any)["directory"] != "C:\\Videos" {
		t.Fatal("saved preference missing", output)
	}
	for _, suffix := range []string{"/media/catalog?storage=s3", "/media/file?file=clip.mp4", "/media/download-url?file=render_test.mp4"} {
		request := httptest.NewRequest("GET", "/v1/projects/"+fixture.project.ID+suffix, nil)
		request.Header.Set("Authorization", "Bearer "+mcpBobKey)
		response, err := fixture.app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 404 {
			t.Fatal("foreign project endpoint accessible", suffix, response.StatusCode)
		}
	}
}

func TestInternalAPICallerDoesNotForwardArbitraryHeaders(t *testing.T) {
	app := fiber.New()
	contextKey := new(int)
	app.Get("/v1/check", func(c *fiber.Ctx) error {
		if c.Get("X-Session-Id") != "" || c.Get("Cookie") != "" || c.Get("X-Forwarded-For") != "203.0.113.5" || c.UserContext().Value(contextKey) != "preserved" {
			t.Error("unsafe headers or missing request context")
		}
		return c.JSON(fiber.Map{"ok": true})
	})
	call := internalAPICaller(app)
	ctx := context.WithValue(context.Background(), contextKey, "preserved")
	headers := http.Header{"X-Session-Id": {"foreign"}, "Cookie": {"secret"}}
	headers.Set(mcpClientIPHeader, "203.0.113.5")
	response, err := call(ctx, headers, mcpserver.Request{Method: "GET", Path: "/v1/check"})
	if err != nil || response.StatusCode != 200 {
		t.Fatal(response, err)
	}
	for _, path := range []string{"https://evil.example/v1/check", "/v1/../api-keys", "/v1/%2e%2e/api-keys"} {
		if _, err := call(ctx, nil, mcpserver.Request{Method: "GET", Path: path}); err == nil {
			t.Fatal("bridge accepted an unsafe path", path)
		}
	}
}

type mcpTokenTransport struct{ key string }

func (t mcpTokenTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.Header.Set("Authorization", "Bearer "+t.key)
	return http.DefaultTransport.RoundTrip(request)
}

func TestMCPSDKClientsRemainIsolatedThroughFiber(t *testing.T) {
	fixture := newMCPFixture(t)
	server := httptest.NewServer(adaptor.FiberApp(fixture.app))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	sessions := make(map[string]*mcp.ClientSession)
	for _, key := range []string{mcpAliceKey, mcpBobKey} {
		client := mcp.NewClient(&mcp.Implementation{Name: "integration-test", Version: "1"}, nil)
		session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
			Endpoint: server.URL + "/mcp", DisableStandaloneSSE: true,
			HTTPClient: &http.Client{Transport: mcpTokenTransport{key: key}},
		}, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer session.Close()
		sessions[key] = session
	}
	var wait sync.WaitGroup
	for _, key := range []string{mcpAliceKey, mcpBobKey} {
		wait.Add(1)
		go func() {
			defer wait.Done()
			result, err := sessions[key].CallTool(ctx, &mcp.CallToolParams{Name: "get_project", Arguments: map[string]any{"projectId": fixture.project.ID}})
			if err != nil || result.IsError != (key == mcpBobKey) {
				t.Errorf("SDK client crossed account boundary: result=%+v error=%v", result, err)
			}
		}()
	}
	wait.Wait()
	fixture.revoked.Store(true)
	result, err := sessions[mcpAliceKey].CallTool(ctx, &mcp.CallToolParams{Name: "list_projects", Arguments: map[string]any{}})
	if err == nil && !result.IsError {
		t.Fatal("SDK session bypassed key revocation")
	}
}

func TestMCPUsesTheSameAPIOperationRateLimit(t *testing.T) {
	fixture := newMCPFixture(t)
	for range 120 {
		request := httptest.NewRequest("GET", "/v1/projects/"+fixture.project.ID, nil)
		request.Header.Set("Authorization", "Bearer "+mcpAliceKey)
		response, err := fixture.app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatal("failed to fill API rate window", response.StatusCode)
		}
	}
	result, output := mcpTool(t, fixture, mcpAliceKey, "get_project", map[string]any{"projectId": fixture.project.ID})
	if !result.IsError || output.StatusCode != 429 {
		t.Fatal("MCP bypassed the shared API rate limit", result, output)
	}
}

func TestMCPRecipeValidationAndCompilationUseTheRealCompiler(t *testing.T) {
	fixture := newMCPFixture(t)
	composition := `{"document":{"version":1,"mode":"assemble","inputs":{"shots":{"kind":"image","multiple":true}},"sequence":{"use":"shots","each":{"take":{"from":"0s","duration":"5s"}}}},"bindings":{"shots":["a"]},"assets":[{"id":"a","file":"a.png","kind":"image","version":"v1"}]}`
	for _, tool := range []string{"validate_recipe", "compile_recipe"} {
		result, output := mcpTool(t, fixture, mcpAliceKey, tool, map[string]any{"projectId": fixture.project.ID, "composition": composition})
		if result.IsError || output.StatusCode != 200 {
			t.Fatal("valid composition was rejected", result, output)
		}
		result, output = mcpTool(t, fixture, mcpAliceKey, tool, map[string]any{"projectId": fixture.project.ID, "composition": "document: [invalid"})
		if !result.IsError || output.StatusCode != 400 || len(output.Data.(map[string]any)["diagnostics"].([]any)) == 0 {
			t.Fatal("compiler diagnostics were lost", result, output)
		}
	}
}
