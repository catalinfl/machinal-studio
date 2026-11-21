package routes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/credits"
)

func TestMCPPreviewUsesOwnedIdempotentBilledRenderJobsAndRejectsPendingActions(t *testing.T) {
	fixture := newMCPFixture(t)
	yaml := "document:\n  version: 2\n  mode: assemble\n  output: {resolution: 480p, fps: 30, format: mp4}\n  tracks:\n    - id: visual\n      type: video\n      clips:\n        - {id: shot, assetId: source, start: 0s, inPoint: 0s, outPoint: 4s, playbackRate: 1, opacity: 1}\nassets:\n  - {id: source, file: shot.mp4, kind: video, duration: 4s, width: 320, height: 180, version: 'sha256:" + strings.Repeat("a", 64) + "'}\n"
	digest := sha256.Sum256([]byte(yaml))
	args := map[string]any{"projectId": fixture.project.ID, "composition": yaml, "expectedCompositionVersion": "sha256:" + hex.EncodeToString(digest[:]), "start": 1, "duration": 1, "idempotencyKey": "preview-once", "userApproved": true}
	result, output := mcpTool(t, fixture, mcpBobKey, "render_preview", args)
	if !result.IsError || output.StatusCode != 404 || len(fixture.jobs.items) != 0 {
		t.Fatal("foreign preview queued", result, output)
	}
	fixture.billing.Pricing = credits.Pricing{}
	result, output = mcpTool(t, fixture, mcpAliceKey, "render_preview", args)
	if !result.IsError || output.StatusCode != 503 || len(fixture.jobs.items) != 0 {
		t.Fatal("preview bypassed configured billing", result, output)
	}
	fixture.billing.Pricing = credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}
	result, output = mcpTool(t, fixture, mcpAliceKey, "render_preview", args)
	if result.IsError || output.StatusCode != 202 {
		t.Fatal("valid preview rejected", result, output)
	}
	id := output.Data.(map[string]any)["id"].(string)
	job, err := fixture.jobs.Get(context.Background(), "mcpalice", fixture.project.SessionID, id)
	if err != nil || job.Kind != "automation-render" || !job.Input.Billed || job.Input.CreditPolicy != credits.MCPServerRender || job.Input.Query != "previewDuration=1&previewStart=1" {
		t.Fatal("preview policy/range lost", job, err)
	}
	_, retry := mcpTool(t, fixture, mcpAliceKey, "render_preview", args)
	if retry.Data.(map[string]any)["id"] != id {
		t.Fatal("preview retry duplicated work")
	}
	args["start"] = 2
	result, output = mcpTool(t, fixture, mcpAliceKey, "render_preview", args)
	if !result.IsError || output.StatusCode != 409 {
		t.Fatal("changed range reused an idempotency key", result, output)
	}
	pending := "document: {version: 2, before: [{id: image, type: image.generate, prompt: Pending}]}"
	pendingDigest := sha256.Sum256([]byte(pending))
	args["composition"], args["expectedCompositionVersion"], args["idempotencyKey"] = pending, "sha256:"+hex.EncodeToString(pendingDigest[:]), "pending-preview"
	result, output = mcpTool(t, fixture, mcpAliceKey, "render_preview", args)
	if !result.IsError || output.StatusCode != 422 || len(fixture.jobs.items) != 1 {
		t.Fatal("preview scheduled new generation", result, output)
	}
}

func TestMCPParameterEditsKeepOwnedFreeCompilationPolicy(t *testing.T) {
	fixture := newMCPFixture(t)
	fixture.billing.Pricing = credits.Pricing{}
	args := map[string]any{"projectId": fixture.project.ID, "file": "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json", "sourceVersion": "sha256:" + strings.Repeat("a", 64), "patch": map[string]any{"receiver": map[string]any{"x": 100}}, "idempotencyKey": "patch-once", "userApproved": true}
	result, output := mcpTool(t, fixture, mcpBobKey, "edit_scene_parameters", args)
	if !result.IsError || output.StatusCode != 404 || len(fixture.jobs.items) != 0 {
		t.Fatal("foreign parameter edit queued", result, output)
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "edit_scene_parameters", args)
	if result.IsError || output.StatusCode != 202 {
		t.Fatal("parameter edit needed paid pricing", result, output)
	}
	job, err := fixture.jobs.Get(context.Background(), "mcpalice", fixture.project.SessionID, output.Data.(map[string]any)["id"].(string))
	if err != nil || job.Kind != "scene-compile" || job.Input.Billed || job.Input.CreditPolicy != credits.MCPFree {
		t.Fatal("parameter edit escaped free compiler path", job, err)
	}
}
