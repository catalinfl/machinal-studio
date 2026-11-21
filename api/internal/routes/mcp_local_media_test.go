package routes

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func localMediaFixture(t *testing.T) (*mcpFixture, string, []byte) {
	t.Helper()
	directory := t.TempDir()
	var payload bytes.Buffer
	if err := png.Encode(&payload, image.NewNRGBA(image.Rect(0, 0, 32, 16))); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.png", "b.png"} {
		if err := os.WriteFile(filepath.Join(directory, name), payload.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
	}
	config, err := json.Marshal([]map[string]string{{"id": "fans", "owner": "mcpalice", "path": directory}})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOCAL_MEDIA_ROOTS_JSON", string(config))
	return newMCPFixture(t), directory, payload.Bytes()
}

func TestMCPLocalMediaListsInspectsAndImportsWithoutUploadingOrSpending(t *testing.T) {
	fixture, directory, payload := localMediaFixture(t)
	var cloudRequests atomic.Int32
	cloudServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cloudRequests.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(cloudServer.Close)
	cloud := objectstore.Shared()
	previousConfig := cloud.Config
	cloud.Config = objectstore.Config{Endpoint: cloudServer.URL, Region: "auto", Bucket: "bucket", AccessKey: "test", SecretKey: "secret"}
	t.Cleanup(func() { cloud.Config = previousConfig })
	before, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"projectId": fixture.project.ID, "userApproved": true}
	result, output := mcpTool(t, fixture, mcpAliceKey, "list_local_media", args)
	if result.IsError || output.StatusCode != 200 || !strings.Contains(string(mustJSON(t, output.Data)), "fans") || strings.Contains(string(mustJSON(t, output.Data)), directory) {
		t.Fatal("owner-scoped discovery", result, output)
	}
	args["rootId"], args["limit"] = "fans", 1
	result, output = mcpTool(t, fixture, mcpAliceKey, "list_local_media", args)
	page := output.Data.(map[string]any)
	if result.IsError || page["nextOffset"] != float64(1) || page["total"] != float64(2) {
		t.Fatal("pagination", result, output)
	}
	args = map[string]any{"projectId": fixture.project.ID, "rootId": "fans", "userApproved": true, "files": []any{map[string]any{"file": "a.png"}}}
	result, output = mcpTool(t, fixture, mcpAliceKey, "inspect_local_media", args)
	if result.IsError || output.StatusCode != 200 || len(result.Content) != 2 {
		t.Fatal("actual image inspection unavailable", result, output)
	}
	if image, ok := result.Content[1].(*mcp.ImageContent); !ok || len(image.Data) == 0 || image.MIMEType != "image/jpeg" {
		t.Fatal("inspection did not return MCP image bytes", result.Content)
	}
	images := output.Data.(map[string]any)["images"].([]any)
	evidence := images[0].(map[string]any)
	if evidence["data"] != nil {
		t.Fatal("image bytes duplicated in structured response")
	}
	args["files"] = []any{map[string]any{"file": "a.png", "sourceVersion": evidence["sourceVersion"]}}
	result, output = mcpTool(t, fixture, mcpAliceKey, "import_local_media", args)
	if result.IsError || output.StatusCode != 200 || output.Data.(map[string]any)["transfer"] != "local-copy" || output.Data.(map[string]any)["uploadsToS3"] != false {
		t.Fatal("local import failed", result, output)
	}
	file := output.Data.(map[string]any)["files"].([]any)[0].(map[string]any)["file"].(string)
	root, err := storage.UserDir(fixture.project.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(filepath.Join(root, file))
	if err != nil || !bytes.Equal(stored, payload) {
		t.Fatal("source bytes were not copied intact", err)
	}
	original, err := os.ReadFile(filepath.Join(directory, "a.png"))
	if err != nil || !bytes.Equal(original, payload) {
		t.Fatal("original modified", err)
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "import_local_media", args)
	if result.IsError || output.Data.(map[string]any)["files"].([]any)[0].(map[string]any)["reused"] != true {
		t.Fatal("retry did not reuse working copy", result, output)
	}
	t.Run("working copies are ordinary pinned recipe assets", func(t *testing.T) {
		if _, err := exec.LookPath("ffprobe"); err != nil {
			t.Skip("ffprobe is unavailable; no local codec installation is attempted")
		}
		result, output := mcpTool(t, fixture, mcpAliceKey, "get_asset_metadata", map[string]any{"projectId": fixture.project.ID, "userApproved": true, "files": []any{map[string]any{"id": "photo", "file": file}}})
		if result.IsError || output.StatusCode != 200 {
			t.Fatal("import cannot enter the existing recipe pipeline", result, output)
		}
		asset := output.Data.([]any)[0].(map[string]any)
		if asset["kind"] != "image" || asset["version"] != evidence["sourceVersion"] || asset["width"] != float64(32) || asset["height"] != float64(16) {
			t.Fatal("working copy metadata differs from source", asset)
		}
	})
	after, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil || before.Remaining != after.Remaining || len(fixture.jobs.items) != 0 {
		t.Fatal("inspection/import submitted paid work", before, after, err)
	}
	if cloudRequests.Load() != 0 {
		t.Fatal("local media workflow accessed S3")
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestMCPLocalMediaRequiresApprovalAndOwnedProjectAndRoot(t *testing.T) {
	fixture, _, _ := localMediaFixture(t)
	foreign, err := fixture.store.Create("mcpbob", "Foreign project")
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"list_local_media", "inspect_local_media", "import_local_media"} {
		for _, item := range []struct {
			key, project string
			approved     bool
		}{
			{mcpAliceKey, fixture.project.ID, false},
			{mcpBobKey, fixture.project.ID, true},
			{mcpBobKey, foreign.ID, true},
		} {
			args := map[string]any{"projectId": item.project, "rootId": "fans", "userApproved": item.approved}
			if tool != "list_local_media" {
				args["files"] = []any{map[string]any{"file": "a.png"}}
			}
			result, output := mcpTool(t, fixture, item.key, tool, args)
			if !result.IsError {
				t.Fatalf("unauthorized %s succeeded: %+v", tool, output)
			}
		}
	}
}

func TestMCPLocalImportsExposePartialRecoveryAndRejectTraversal(t *testing.T) {
	fixture, _, _ := localMediaFixture(t)
	args := map[string]any{"projectId": fixture.project.ID, "rootId": "fans", "userApproved": true,
		"files": []any{map[string]any{"file": "a.png"}, map[string]any{"file": "missing.png"}}}
	result, output := mcpTool(t, fixture, mcpAliceKey, "import_local_media", args)
	data := output.Data.(map[string]any)
	if !result.IsError || output.StatusCode != 404 || data["partial"] != true || len(data["files"].([]any)) != 1 {
		t.Fatal("successful partial import lost", result, output)
	}
	for _, file := range []string{"../a.png", "/a.png", `D:\fans\a.png`, "https://example.com/a.png"} {
		args["files"] = []any{map[string]any{"file": file}}
		result, output = mcpTool(t, fixture, mcpAliceKey, "import_local_media", args)
		if !result.IsError || output.StatusCode != 400 {
			t.Fatal("untrusted source path accepted", file, result, output)
		}
	}
}

func TestMCPLocalMediaDisabledByDefault(t *testing.T) {
	t.Setenv("LOCAL_MEDIA_ROOTS_JSON", "")
	fixture := newMCPFixture(t)
	result, output := mcpTool(t, fixture, mcpAliceKey, "list_local_media", map[string]any{"projectId": fixture.project.ID, "userApproved": true})
	if !result.IsError || output.StatusCode != 503 || !strings.Contains(string(mustJSON(t, output.Data)), "disabled") {
		t.Fatal("unconfigured filesystem access did not fail closed", result, output)
	}
}
