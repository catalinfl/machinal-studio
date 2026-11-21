package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const testJobID = "0123456789abcdef0123456789abcdef"

func rpc(t *testing.T, handler http.Handler, method string, params any) (int, map[string]json.RawMessage) {
	t.Helper()
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://localhost/mcp", strings.NewReader(string(body)))
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	request = request.WithContext(ctx)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("Authorization", "Bearer test-secret")
	request.Header.Set("MCP-Protocol-Version", "2025-11-25")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var envelope map[string]json.RawMessage
	if response.Code == http.StatusOK && json.Unmarshal(response.Body.Bytes(), &envelope) != nil {
		t.Fatalf("invalid JSON-RPC response: %s", response.Body.String())
	}
	return response.Code, envelope
}

func workflowPolicy(t *testing.T, handler http.Handler) string {
	t.Helper()
	status, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": "machinal://reference/workflow"})
	if status != http.StatusOK || envelope["error"] != nil {
		t.Fatalf("workflow policy resource: status %d, %s", status, envelope["error"])
	}
	var resource mcp.ReadResourceResult
	if err := json.Unmarshal(envelope["result"], &resource); err != nil {
		t.Fatal(err)
	}
	if len(resource.Contents) != 1 {
		t.Fatalf("workflow policy resource has %d contents", len(resource.Contents))
	}
	if !strings.Contains(resource.Contents[0].Text, "get_library_reference") {
		t.Fatal("API must direct authoring to the installed MCP package")
	}
	return clientPolicyFixture("workflow.md")
}

func callTool(t *testing.T, handler http.Handler, name string, arguments any) (mcp.CallToolResult, Output) {
	t.Helper()
	status, envelope := rpc(t, handler, "tools/call", map[string]any{"name": name, "arguments": arguments})
	if status != 200 || envelope["error"] != nil {
		t.Fatalf("tool %s: status %d, %s", name, status, envelope["error"])
	}
	var result mcp.CallToolResult
	if err := json.Unmarshal(envelope["result"], &result); err != nil {
		t.Fatal(err)
	}
	var output Output
	if result.StructuredContent != nil {
		data, err := json.Marshal(result.StructuredContent)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(data, &output); err != nil {
			t.Fatal(err)
		}
	}
	return result, output
}

func TestCatalogAndInstructions(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("catalog should not invoke the API")
		return Response{}, nil
	})
	status, envelope := rpc(t, handler, "initialize", map[string]any{
		"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "test", "version": "1"},
	})
	var initialized mcp.InitializeResult
	if err := json.Unmarshal(envelope["result"], &initialized); err != nil {
		t.Fatal(err)
	}
	if status != 200 || initialized.ServerInfo.Name != "machinal" || !strings.Contains(initialized.Instructions, "get_library_reference") {
		t.Fatalf("initialize: %d %+v", status, initialized)
	}
	if len(initialized.Instructions) > 7000 || len(initialized.Instructions)*3 >= len(instructions) {
		t.Fatal("handshake eagerly loaded detailed production policy", len(initialized.Instructions), len(instructions))
	}
	_, detailed := rpc(t, handler, "resources/read", map[string]any{"uri": "machinal://reference/workflow"})
	if !strings.Contains(string(detailed["result"]), "get_library_reference") {
		t.Fatal("API no longer directs the client to its authoring policy")
	}
	_, envelope = rpc(t, handler, "tools/list", map[string]any{})
	var catalog mcp.ListToolsResult
	if err := json.Unmarshal(envelope["result"], &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Tools) != 43 {
		t.Fatalf("tool count = %d", len(catalog.Tools))
	}
	for _, tool := range catalog.Tools {
		if tool.InputSchema == nil || tool.OutputSchema == nil || tool.Annotations == nil {
			t.Fatalf("missing schema/annotations on %s", tool.Name)
		}
		if strings.Contains(tool.Name, "login") || strings.Contains(tool.Name, "key") {
			t.Fatalf("credential tool exposed: %s", tool.Name)
		}
		if tool.Name == "get_credits" && (!tool.Annotations.ReadOnlyHint || !tool.Annotations.IdempotentHint || *tool.Annotations.DestructiveHint) {
			t.Fatal("credit lookup must be advertised as safe read-only discovery")
		}
	}
	_, envelope = rpc(t, handler, "resources/read", map[string]any{"uri": "machinal://recipes/guide"})
	if !strings.Contains(string(envelope["result"]), "get_library_reference") {
		t.Fatal("client recipe guide pointer is missing")
	}
	for _, guide := range []struct{ uri, content string }{
		{"machinal://skills/editing", "get_library_reference"},
		{"machinal://skills/credits", "get_library_reference"},
	} {
		_, envelope = rpc(t, handler, "resources/read", map[string]any{"uri": guide.uri})
		if !strings.Contains(string(envelope["result"]), guide.content) {
			t.Fatalf("missing bundled guide %s", guide.uri)
		}
	}
}

func TestToolsMapOnlyToVersionedAPI(t *testing.T) {
	var received Request
	handler := NewHandler(func(_ context.Context, headers http.Header, request Request) (Response, error) {
		if headers.Get("Authorization") != "Bearer test-secret" {
			t.Fatal("authentication missing from API call")
		}
		received = request
		return Response{StatusCode: 200, Body: []byte(`{"ok":true}`)}, nil
	})
	for _, test := range []struct {
		name, method, path string
		args               map[string]any
	}{
		{"list_projects", "GET", "/v1/projects", map[string]any{}},
		{"create_project", "POST", "/v1/projects", map[string]any{"name": "Film"}},
		{"get_project", "GET", "/v1/projects/owned", map[string]any{"projectId": "owned"}},
		{"save_project", "POST", "/v1/projects/owned", map[string]any{"projectId": "owned", "name": "Film", "version": 1, "state": map[string]any{"schemaVersion": 1, "timeline": map[string]any{"channels": []any{}}, "media": []any{}}}},
		{"get_recipe_schema", "GET", "/v1/compositions/schema", map[string]any{}},
		{"get_capabilities", "GET", "/v1/compositions/capabilities?summary=true", map[string]any{}},
		{"get_credits", "GET", "/v1/billing/credits", map[string]any{}},
		{"list_media", "GET", "/v1/projects/owned/media/catalog?limit=25&offset=0&storage=volume", map[string]any{"projectId": "owned", "userApproved": true}},
		{"get_asset_metadata", "POST", "/v1/projects/owned/compositions/assets", map[string]any{"projectId": "owned", "userApproved": true, "files": []any{map[string]any{"id": "clip", "file": "clip.mp4"}}}},
		{"validate_recipe", "POST", "/v1/projects/owned/compositions/validate", map[string]any{"projectId": "owned", "composition": "document: {}"}},
		{"compile_recipe", "POST", "/v1/projects/owned/compositions/compile?draft=true", map[string]any{"projectId": "owned", "composition": "document: {}", "draft": true}},
		{"render_video", "POST", "/v1/projects/owned/renders", map[string]any{"projectId": "owned", "userApproved": true, "composition": "document: {}", "idempotencyKey": "stable-key"}},
		{"generate_assets", "POST", "/v1/projects/owned/compositions/compile-and-generate", map[string]any{"projectId": "owned", "userApproved": true, "composition": "document: {}", "idempotencyKey": "stable-key"}},
		{"get_download_preferences", "GET", "/v1/preferences/downloads", map[string]any{}},
		{"set_download_preferences", "POST", "/v1/preferences/downloads", map[string]any{"directory": "C:\\Videos", "userApproved": true}},
		{"list_jobs", "GET", "/v1/projects/owned/jobs?view=summary", map[string]any{"projectId": "owned"}},
		{"get_job", "GET", "/v1/projects/owned/jobs/" + testJobID + "?view=summary", map[string]any{"projectId": "owned", "jobId": testJobID}},
		{"wait_for_job", "GET", "/v1/projects/owned/jobs/" + testJobID + "?until=terminal&view=summary&wait=120", map[string]any{"projectId": "owned", "jobId": testJobID}},
		{"revoke_delivery_link", "DELETE", "/v1/projects/owned/media/delivery-links/" + strings.Repeat("a", 64), map[string]any{"projectId": "owned", "linkId": strings.Repeat("a", 64), "userApproved": true}},
		{"get_job_result", "GET", "/v1/projects/owned/jobs/" + testJobID + "?view=result", map[string]any{"projectId": "owned", "jobId": testJobID}},
		{"cancel_job", "DELETE", "/v1/projects/owned/jobs/" + testJobID, map[string]any{"projectId": "owned", "jobId": testJobID}},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, _ := callTool(t, handler, test.name, test.args)
			if result.IsError || received.Method != test.method || received.Path != test.path {
				t.Fatalf("result=%+v request=%+v", result, received)
			}
			if test.name == "render_video" || test.name == "generate_assets" {
				if received.IdempotencyKey != "stable-key" || string(received.Body) != "document: {}" || received.ContentType != "application/yaml" {
					t.Fatalf("changed paid operation: %+v", received)
				}
			}
		})
	}
}

func TestInvalidArgumentsNeverReachAPI(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("invalid arguments reached API")
		return Response{}, nil
	})
	for _, test := range []struct {
		tool string
		args map[string]any
	}{
		{"get_project", map[string]any{"projectId": "../other"}},
		{"get_project", map[string]any{"projectId": "owned?session=other"}},
		{"get_project", map[string]any{"projectId": "https://evil.example"}},
		{"get_project", map[string]any{"projectId": "owned", "apiKey": "never-accept-secrets"}},
		{"get_credits", map[string]any{"owner": "another-account"}},
		{"get_credits", map[string]any{"apiKey": "never-accept-secrets"}},
		{"get_job", map[string]any{"projectId": "owned", "jobId": "../../keys"}},
		{"wait_for_job", map[string]any{"projectId": "owned", "jobId": testJobID, "timeoutSeconds": 121}},
		{"wait_for_job", map[string]any{"projectId": "owned", "jobId": testJobID, "timeoutSeconds": -1}},
		{"suggest_tools", map[string]any{"prompt": "", "userApproved": true}},
		{"get_video_result", map[string]any{"projectId": "owned", "jobId": testJobID, "delivery": "server", "userApproved": true}},
		{"render_video", map[string]any{"projectId": "owned", "composition": "document: {}"}},
		{"render_video", map[string]any{"projectId": "owned", "composition": "document: {}", "idempotencyKey": ""}},
		{"render_video", map[string]any{"projectId": "owned", "composition": "document: {}", "idempotencyKey": "bad\r\nheader"}},
		{"validate_recipe", map[string]any{"projectId": "owned", "composition": ""}},
		{"validate_recipe", map[string]any{"projectId": "owned", "composition": strings.Repeat("a", maxCompositionBytes+1)}},
	} {
		result, _ := callTool(t, handler, test.tool, test.args)
		if !result.IsError {
			t.Fatalf("accepted %s: %+v", test.tool, test.args)
		}
	}
}

func TestAPIResponsesAndLimits(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
		failure    error
		isError    bool
	}{
		{"queued", `{"id":"` + testJobID + `","status":"queued"}`, 202, nil, false},
		{"diagnostics", `{"diagnostics":[{"code":"missing_asset","message":"Upload source"}]}`, 422, nil, true},
		{"forbidden", "Not Found", 404, nil, true},
		{"quota", "The job queue is full. Retry later.", 429, nil, true},
		{"pricing", "API credit pricing is not configured.", 503, nil, true},
		{"cancelled", "", 204, nil, false},
		{"oversized", strings.Repeat("a", MaxResultBytes+1), 200, nil, true},
		{"bridge limit", "", 0, ErrResultTooLarge, true},
		{"transport failure", "", 0, errors.New("internal database secret"), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
				return Response{StatusCode: test.status, Body: []byte(test.body), Header: http.Header{"Location": {"/v1/projects/owned/jobs/" + testJobID}, "Retry-After": {"3"}}}, test.failure
			})
			result, output := callTool(t, handler, "list_jobs", map[string]any{"projectId": "owned"})
			if result.IsError != test.isError {
				t.Fatalf("isError=%v, want %v", result.IsError, test.isError)
			}
			if test.failure == nil && len(test.body) <= MaxResultBytes && (output.StatusCode != test.status || output.RetryAfter != "3" || output.StatusURL == "") {
				t.Fatalf("lost API response metadata: %+v", output)
			}
			data, _ := json.Marshal(result)
			if strings.Contains(string(data), "internal database secret") || strings.Contains(string(data), "test-secret") {
				t.Fatal("secret leaked into a tool result")
			}
		})
	}
}

func TestVideoAndUploadDescriptors(t *testing.T) {
	job := `{"status":"completed","kind":"automation-render","filename":"render_a & b.mp4","result":{"filename":"render_a & b.mp4"}}`
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		if strings.HasSuffix(request.Path, "/media/delivery-links") {
			return Response{StatusCode: 201, Body: []byte(`{"id":"delivery-id","url":"https://api.example/deliveries/opaque-token","public":false,"bearerUrl":true}`)}, nil
		}
		if request.Path == "/v1/preferences/downloads" {
			return Response{StatusCode: 200, Body: []byte(`{"directory":"C:\\Videos"}`)}, nil
		}
		return Response{StatusCode: 200, Body: []byte(job)}, nil
	})
	result, output := callTool(t, handler, "get_video_result", map[string]any{"projectId": "owned", "jobId": testJobID, "delivery": "local", "userApproved": true})
	if result.IsError {
		t.Fatal(result)
	}
	data := output.Data.(map[string]any)
	download := data["download"].(map[string]any)
	if download["url"] != "https://api.example/deliveries/opaque-token" || download["public"] != false || data["destination"].(map[string]any)["directory"] != "C:\\Videos" {
		t.Fatal(download)
	}
	for _, status := range []string{"queued", "running", "failed", "cancelled"} {
		job = `{"status":"` + status + `","filename":"partial.mp4"}`
		_, output = callTool(t, handler, "get_video_result", map[string]any{"projectId": "owned", "jobId": testJobID, "userApproved": true})
		if output.Data.(map[string]any)["download"] != nil {
			t.Fatalf("%s job advertised a finished video", status)
		}
	}
	job = `{"status":"completed","kind":"automation-render","filename":"../private.mp4"}`
	result, _ = callTool(t, handler, "get_video_result", map[string]any{"projectId": "owned", "jobId": testJobID, "userApproved": true})
	if !result.IsError {
		t.Fatal("accepted unsafe filename")
	}
	job = `{"status":"completed","kind":"ai-image","filename":"ai_image.png"}`
	result, _ = callTool(t, handler, "get_video_result", map[string]any{"projectId": "owned", "jobId": testJobID, "userApproved": true})
	if !result.IsError {
		t.Fatal("non-render job advertised a video")
	}
	result, output = callTool(t, handler, "get_upload_target", map[string]any{"projectId": "owned"})
	if result.IsError || output.Data.(map[string]any)["path"] != "/v1/projects/owned/upload" {
		t.Fatal(result, output)
	}
}

type tokenTransport struct{ base http.RoundTripper }

func (t tokenTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.Header.Set("Authorization", "Bearer sdk-test-key")
	return t.base.RoundTrip(request)
}

func TestOfficialSDKClientOverHTTP(t *testing.T) {
	var mu sync.Mutex
	var tokens []string
	server := httptest.NewServer(NewHandler(func(_ context.Context, headers http.Header, _ Request) (Response, error) {
		mu.Lock()
		tokens = append(tokens, headers.Get("Authorization"))
		mu.Unlock()
		return Response{StatusCode: 200, Body: []byte(`[]`)}, nil
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", DisableStandaloneSSE: true,
		HTTPClient: &http.Client{Transport: tokenTransport{http.DefaultTransport}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	tools, err := session.ListTools(ctx, nil)
	if err != nil || len(tools.Tools) != 43 {
		t.Fatalf("SDK list: %+v %v", tools, err)
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "list_projects", Arguments: map[string]any{}})
	if err != nil || result.IsError {
		t.Fatalf("SDK call: %+v %v", result, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(tokens) != 1 || tokens[0] != "Bearer sdk-test-key" {
		t.Fatalf("request credential was not isolated: %v", tokens)
	}
}

func TestHTTPTransportLimitsAndMethods(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) { return Response{}, nil })
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, "http://localhost/mcp", nil))
		if response.Code != 405 || response.Header().Get("Allow") != "POST" {
			t.Fatal("stateless transport did not reject", method, response.Code)
		}
	}
	request := httptest.NewRequest("POST", "http://localhost/mcp", io.LimitReader(strings.NewReader(strings.Repeat(" ", MaxRequestBytes+1)), MaxRequestBytes+1))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != 413 {
		t.Fatalf("unbounded body: %d %s", response.Code, response.Body.String())
	}
}
