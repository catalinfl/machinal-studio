package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/platform/storage"
)

func TestMCPSceneInspectionIsOwnedVersionedBoundedAndUnbilled(t *testing.T) {
	fixture := newMCPFixture(t)
	file := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	root := filepath.Join(storage.DataDir, fixture.project.SessionID)
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	source := scenes.LiveSource{Version: 1, Component: "<p>Signal</p>", JavaScript: "stored-bundle", Config: scenes.Config{Width: 320, Height: 180, FPS: 30, Frames: 60}}
	data, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, file), data, 0600); err != nil {
		t.Fatal(err)
	}
	asset, err := scenes.SourceAsset(root, file, "signal")
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/inspect" || r.Header.Get("Authorization") != "Bearer private-inspector" {
			t.Error("wrong operation or leaked caller credential", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]any{"frames": []map[string]any{{"frame": 15, "time": 0.5, "mimeType": "image/jpeg", "data": "/9j/2Q=="}}, "motionVerified": false, "audioVerified": false})
	}))
	defer service.Close()
	t.Setenv("SCENE_SERVICE_URL", service.URL)
	t.Setenv("SCENE_SERVICE_TOKEN", "private-inspector")
	before, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"projectId": fixture.project.ID, "file": file, "sourceVersion": asset.Version, "frames": []int{15}, "userApproved": true}
	result, output := mcpTool(t, fixture, mcpBobKey, "inspect_scene", args)
	if !result.IsError || output.StatusCode != 404 || calls.Load() != 0 {
		t.Fatal("foreign scene inspection escaped project scope", output)
	}
	args["sourceVersion"] = "sha256:" + strings.Repeat("a", 64)
	result, output = mcpTool(t, fixture, mcpAliceKey, "inspect_scene", args)
	if !result.IsError || output.StatusCode != 409 || calls.Load() != 0 {
		t.Fatal("stale source inspected", output)
	}
	args["sourceVersion"], args["frames"] = asset.Version, []int{60}
	result, output = mcpTool(t, fixture, mcpAliceKey, "inspect_scene", args)
	if !result.IsError || output.StatusCode != 400 || calls.Load() != 0 {
		t.Fatal("out-of-duration frame inspected", output)
	}
	args["frames"] = []int{15}
	result, output = mcpTool(t, fixture, mcpAliceKey, "inspect_scene", args)
	if result.IsError || output.StatusCode != 200 || calls.Load() != 1 || len(result.Content) != 2 {
		t.Fatal("valid evidence missing", result, output)
	}
	if output.Data.(map[string]any)["sourceVersion"] != asset.Version {
		t.Fatal("evidence lost revision")
	}
	after, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil || after.Remaining != before.Remaining || len(fixture.jobs.items) != 0 {
		t.Fatal("diagnostics charged or queued production work", before, after, err)
	}
}
