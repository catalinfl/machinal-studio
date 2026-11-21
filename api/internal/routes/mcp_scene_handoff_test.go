package routes

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/storage"
)

func TestMCPHandoffIsOwnedIdempotentAndUsesFreeCompilePolicy(t *testing.T) {
	fixture := newMCPFixture(t)
	fixture.billing.Pricing = credits.Pricing{}
	version := "sha256:" + strings.Repeat("a", 64)
	args := map[string]any{"projectId": fixture.project.ID, "file": "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json", "sourceVersion": version,
		"handoff":        map[string]any{"sourceFile": "ai_scene_abcdef0123456789abcdef0123456789_01.scene.json", "sourceVersion": version, "frame": 59, "objects": map[string]string{"receiver": "signal"}},
		"idempotencyKey": "handoff-once", "userApproved": true}
	result, output := mcpTool(t, fixture, mcpBobKey, "handoff_scene", args)
	if !result.IsError || output.StatusCode != 404 || len(fixture.jobs.items) != 0 {
		t.Fatal("foreign handoff queued", result, output)
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "handoff_scene", args)
	if result.IsError || output.StatusCode != 202 {
		t.Fatal("handoff required paid pricing", result, output)
	}
	id := output.Data.(map[string]any)["id"].(string)
	job, err := fixture.jobs.Get(context.Background(), "mcpalice", fixture.project.SessionID, id)
	if err != nil || job.Kind != "scene-compile" || job.Input.Billed || job.Input.CreditPolicy != credits.MCPFree {
		t.Fatal("handoff escaped free compile path", job, err)
	}
	var input scenes.CompileRequest
	payload, err := os.ReadFile(filepath.Join(storage.DataDir, ".job-inputs", job.Input.Payload))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &input); err != nil || input.Handoff == nil || input.Handoff.Frame != 59 {
		t.Fatal("queued handoff lost exact source frame", input, err)
	}
	_, retry := mcpTool(t, fixture, mcpAliceKey, "handoff_scene", args)
	if retry.Data.(map[string]any)["id"] != id || len(fixture.jobs.items) != 1 {
		t.Fatal("uncertain retry duplicated handoff", retry)
	}
	args["handoff"].(map[string]any)["frame"] = 58
	result, output = mcpTool(t, fixture, mcpAliceKey, "handoff_scene", args)
	if !result.IsError || output.StatusCode != 409 {
		t.Fatal("changed frame reused idempotency key", result, output)
	}
}
