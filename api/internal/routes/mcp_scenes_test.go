package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/jobqueue"
)

func mcpSceneArguments(projectID string) map[string]any {
	return map[string]any{"projectId": projectID, "idempotencyKey": "client-scene-once", "userApproved": true,
		"component": "<p>Current client scene</p>", "duration": 2, "width": 320, "height": 180, "fps": 30}
}

func TestMCPCompilesClientSceneForFreeButMetersServerRender(t *testing.T) {
	fixture := newMCPFixture(t)
	fixture.billing.Pricing = credits.Pricing{}
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENROUTER_SCENE_MODEL", "")
	t.Setenv("OPENROUTER_MODEL", "")
	compilerCalls := 0
	compiler := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		compilerCalls++
		if r.URL.Path != "/compile" || r.Header.Get("Authorization") != "Bearer worker-only-secret" {
			t.Error("unexpected compiler request or leaked caller credential", r.URL.Path)
		}
		fmt.Fprint(w, `{"javascript":"compiled-client-bundle"}`)
	}))
	defer compiler.Close()
	t.Setenv("SCENE_SERVICE_URL", compiler.URL)
	t.Setenv("SCENE_SERVICE_TOKEN", "worker-only-secret")
	before, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil {
		t.Fatal(err)
	}
	args := mcpSceneArguments(fixture.project.ID)
	result, output := mcpTool(t, fixture, mcpAliceKey, "compile_scene", args)
	if result.IsError || output.StatusCode != 202 {
		t.Fatal("client source did not queue without pricing/AI", result, output)
	}
	id := output.Data.(map[string]any)["id"].(string)
	job, err := fixture.jobs.Get(context.Background(), "mcpalice", fixture.project.SessionID, id)
	if err != nil || job.Kind != "scene-compile" || job.Input.Billed || job.Input.CreditPolicy != credits.MCPFree {
		t.Fatal("compilation had incorrect billing policy", job, err)
	}
	_, retry := mcpTool(t, fixture, mcpAliceKey, "compile_scene", args)
	if retry.Data.(map[string]any)["id"] != id {
		t.Fatal("unchanged retry duplicated compilation")
	}
	ctx, finish, err := fixture.billing.PrepareJob(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	compiled := jobqueue.FiberTask(scenes.NewRunner().CompileSource)(ctx, job)
	finish()
	if compiled.StatusCode != 200 || compilerCalls != 1 {
		t.Fatalf("client compilation failed: %d %s calls=%d", compiled.StatusCode, compiled.Body, compilerCalls)
	}
	var fields struct {
		File  string          `json:"file"`
		Asset json.RawMessage `json:"asset"`
	}
	if err := json.Unmarshal(compiled.Body, &fields); err != nil || fields.File == "" {
		t.Fatal("missing pinned asset", err)
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "get_scene_source", map[string]any{"projectId": fixture.project.ID, "file": fields.File, "userApproved": true})
	if result.IsError || output.Data.(map[string]any)["component"] != args["component"] || output.Data.(map[string]any)["javascript"] != nil || output.Data.(map[string]any)["images"] != nil {
		t.Fatal("editable source missing or embedded/bundled data leaked", result, output)
	}
	for _, tool := range []string{"get_scene_source", "compile_scene"} {
		foreign := mcpSceneArguments(fixture.project.ID)
		foreign["file"] = fields.File
		if tool == "compile_scene" {
			delete(foreign, "file")
		} else {
			foreign = map[string]any{"projectId": fixture.project.ID, "file": fields.File, "userApproved": true}
		}
		result, output = mcpTool(t, fixture, mcpBobKey, tool, foreign)
		if !result.IsError || output.StatusCode != 404 {
			t.Fatal("scene escaped ownership scope", tool, result, output)
		}
	}
	yaml := fmt.Sprintf("document:\n  version: 2\n  mode: assemble\n  tracks:\n    - id: v\n      type: video\n      clips:\n        - {id: c, assetId: %s, start: 0s, inPoint: 0s, outPoint: 2s, playbackRate: 1, volume: 0}\nassets:\n  - %s\n", idForSceneAsset(t, fields.Asset), fields.Asset)
	result, output = mcpTool(t, fixture, mcpAliceKey, "validate_recipe", map[string]any{"projectId": fixture.project.ID, "composition": yaml})
	if result.IsError || output.StatusCode != 200 {
		t.Fatal("compiled asset did not validate as a recipe source", result, output)
	}
	result, output = mcpTool(t, fixture, mcpAliceKey, "render_video", map[string]any{"projectId": fixture.project.ID, "composition": yaml, "idempotencyKey": "render-client-scene", "userApproved": true})
	if !result.IsError || output.StatusCode != 503 {
		t.Fatal("server rendering was free when render rates were missing", result, output)
	}
	fixture.billing.Pricing = credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}
	result, output = mcpTool(t, fixture, mcpAliceKey, "render_video", map[string]any{"projectId": fixture.project.ID, "composition": yaml, "idempotencyKey": "render-client-scene", "userApproved": true})
	if result.IsError || output.StatusCode != 202 {
		t.Fatal("compiled scene could not enter billed server render workflow", result, output)
	}
	renderJob, err := fixture.jobs.Get(context.Background(), "mcpalice", fixture.project.SessionID, output.Data.(map[string]any)["id"].(string))
	if err != nil || !renderJob.Input.Billed || renderJob.Input.CreditPolicy != credits.MCPServerRender {
		t.Fatal("scene/video server rendering was not metered", renderJob, err)
	}
	after, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil || after.Remaining != before.Remaining {
		t.Fatal("client scene authoring consumed credits", before, after, err)
	}
}

func idForSceneAsset(t *testing.T, encoded json.RawMessage) string {
	t.Helper()
	var asset struct{ ID string }
	if err := json.Unmarshal(encoded, &asset); err != nil || asset.ID == "" {
		t.Fatal("invalid compiled asset", err)
	}
	return asset.ID
}

func TestMCPRejectsPendingServerSceneJobsBeforeQueueing(t *testing.T) {
	fixture := newMCPFixture(t)
	for _, kind := range []string{"scene.generate", "scene.edit"} {
		for _, tool := range []string{"generate_assets", "render_video"} {
			recipe := fmt.Sprintf("document:\n  version: 2\n  before:\n    - {id: image, type: image.generate, prompt: Artwork}\n    - {id: scene, type: %s, prompt: Motion}\n", kind)
			result, output := mcpTool(t, fixture, mcpAliceKey, tool, map[string]any{"projectId": fixture.project.ID, "composition": recipe, "idempotencyKey": tool + kind, "userApproved": true})
			if !result.IsError || output.StatusCode != 422 || !strings.Contains(fmt.Sprint(output.Data), "compile_scene") || len(fixture.jobs.items) != 0 {
				t.Fatal("server scene was accepted or image work queued first", kind, tool, result, output)
			}
		}
	}
}

func TestMCPPaidMediaStillRequiresPricingAndPersistsMeteredPolicy(t *testing.T) {
	fixture := newMCPFixture(t)
	fixture.billing.Pricing = credits.Pricing{}
	args := map[string]any{"projectId": fixture.project.ID, "composition": "document: {version: 2, before: [{id: art, type: image.generate, prompt: Artwork}]}", "idempotencyKey": "paid-image", "userApproved": true}
	result, output := mcpTool(t, fixture, mcpAliceKey, "generate_assets", args)
	if !result.IsError || output.StatusCode != 503 || len(fixture.jobs.items) != 0 {
		t.Fatal("paid media bypassed pricing", result, output)
	}
	fixture.billing.Pricing = credits.Pricing{USDPerCredit: "0.01"}
	result, output = mcpTool(t, fixture, mcpAliceKey, "generate_assets", args)
	if result.IsError || output.StatusCode != 202 {
		t.Fatal("MCP media incorrectly required rendering pricing", result, output)
	}
	job, err := fixture.jobs.Get(context.Background(), "mcpalice", fixture.project.SessionID, output.Data.(map[string]any)["id"].(string))
	if err != nil || !job.Input.Billed || job.Input.CreditPolicy != credits.MCPMediaOnly {
		t.Fatal("paid media was not metered", job, err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/projects/"+fixture.project.ID+"/renders", strings.NewReader("document: {version: 2}"))
	request.Header.Set("Authorization", "Bearer "+mcpAliceKey)
	request.Header.Set("Content-Type", "application/yaml")
	request.Header.Set("X-Direction-MCP-Origin", "forged")
	response, err := fixture.app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 503 {
		t.Fatal("direct REST forged MCP free-render policy", response.StatusCode)
	}
}
