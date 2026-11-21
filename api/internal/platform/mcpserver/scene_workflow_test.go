package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/compositions"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestWorkflowPolicyExplainsAnimatedScenesWithoutInstalledSkills(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("scene discovery must not call providers or access customer data")
		return Response{}, nil
	})
	policy := workflowPolicy(t, handler)
	for _, content := range []string{"beat sheet", "Svelte", "scene.generate", "independently moving objects", "scene-image-insert", "metadata alone is not visual inspection", "no-generation"} {
		if !strings.Contains(policy, content) {
			t.Fatalf("workflow policy lacks scene-planning guidance: %s", content)
		}
	}
}

func TestSceneGuideExplainsPlanningAndRealImageAttachments(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("scene guidance must not call providers or access customer data")
		return Response{}, nil
	})
	result, output := callTool(t, handler, "get_editing_reference", map[string]any{"topic": "scenes"})
	if result.IsError || output.StatusCode != http.StatusOK {
		t.Fatal("scene guide is unavailable", result, output)
	}
	guide := output.Data.(map[string]any)["guide"].(string)
	for _, content := range []string{
		"beat sheet", "timeline start/duration", "scene-local", "independently moving objects", "Svelte",
		"Metadata alone is not visual inspection", "footage-only/no-generation", "scene-image-insert",
		"image_1", "separate image and scene AI requests", "actual project filename", "explicit authorization",
		"without machinal billing", "may charge the user's OpenRouter account",
		"scene-three-explainer", "central hold", "visualMode: 3d", "No AI-production label", "no detectable foreground",
	} {
		if !strings.Contains(guide, content) {
			t.Fatalf("scene guide lacks required instruction: %s", content)
		}
	}
	_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": "machinal://skills/scenes"})
	var resource mcp.ReadResourceResult
	if err := json.Unmarshal(envelope["result"], &resource); err != nil {
		t.Fatal(err)
	}
	if len(resource.Contents) != 1 || resource.Contents[0].Text != guide {
		t.Fatal("scene skill resource and live scene topic diverged")
	}
}

func TestLocalToolsAdvertiseClientScenesAndProviderConsent(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("tool discovery must not call the API")
		return Response{}, nil
	})
	_, envelope := rpc(t, handler, "tools/list", map[string]any{})
	var catalog mcp.ListToolsResult
	if err := json.Unmarshal(envelope["result"], &catalog); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"generate_assets", "render_video"} {
		found := false
		for _, tool := range catalog.Tools {
			if tool.Name != name {
				continue
			}
			found = true
			for _, content := range []string{"Svelte", "OpenRouter", "consent", "timing"} {
				if !strings.Contains(tool.Description, content) {
					t.Errorf("%s description is missing %s", name, content)
				}
			}
		}
		if !found {
			t.Fatalf("missing tool: %s", name)
		}
	}
}

func sceneInsertExample(t *testing.T) []byte {
	t.Helper()
	source, err := bundledGuides.ReadFile("reference/examples/scene-image-insert.yaml")
	if err != nil {
		t.Fatal(err)
	}
	return source
}

func TestMCPForwardsAnimatedSceneRecipesWithoutChangingAttachments(t *testing.T) {
	source := sceneInsertExample(t)
	for _, operation := range []struct{ tool, suffix string }{
		{"generate_assets", "/compositions/compile-and-generate"},
		{"render_video", "/renders"},
	} {
		t.Run(operation.tool, func(t *testing.T) {
			calls := 0
			handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
				calls++
				if request.Method != http.MethodPost || request.Path != "/v1/projects/owned"+operation.suffix ||
					string(request.Body) != string(source) || request.ContentType != "application/yaml" || request.IdempotencyKey != "scene-insert" {
					t.Fatalf("scene recipe or operation was changed: %+v", request)
				}
				return Response{StatusCode: http.StatusAccepted, Body: []byte(`{"status":"queued"}`)}, nil
			})
			args := map[string]any{"projectId": "owned", "composition": string(source), "idempotencyKey": "scene-insert", "userApproved": false}
			result, _ := callTool(t, handler, operation.tool, args)
			if !result.IsError || calls != 0 {
				t.Fatal("scene recipe reached the API without approval")
			}
			args["userApproved"] = true
			result, output := callTool(t, handler, operation.tool, args)
			if result.IsError || output.StatusCode != http.StatusAccepted || calls != 1 {
				t.Fatal("approved scene recipe was not queued", result, output)
			}
		})
	}
}

func TestSceneInsertExampleMaterializesWithoutLosingFootageOrTiming(t *testing.T) {
	input, _, err := compositions.ParseProject(sceneInsertExample(t))
	if err != nil {
		t.Fatal(err)
	}
	pending := compiler.New().Compile(input)
	if compositions.HasErrors(pending) || len(pending.Requirements) != 1 || pending.Requirements[0].Kind != "scene.generate" || pending.Composition != nil {
		t.Fatalf("expected one unresolved scene, not a still-image substitution: %+v", pending)
	}
	job := &input.Document.Before[0]
	if job.Type != "scene.generate" || len(job.Images) != 1 || job.Images[0].File != "supplied-product.png" {
		t.Fatalf("scene or real image attachment was lost: %+v", job)
	}
	job.ResultAssetID = "resolved-scene"
	input.Assets = append(input.Assets, document.Asset{ID: "resolved-scene", File: "generated.scene.json", Version: "synthetic", Kind: "video", Duration: 6 * document.Second, Width: 1920, Height: 1080})
	resolved := compiler.New().Compile(input)
	if resolved.Composition == nil || resolved.Composition.Duration != 16*document.Second || len(resolved.Requirements) != 0 {
		t.Fatalf("materialized scene did not compile into the complete edit: %+v", resolved)
	}
	tracks := resolved.Composition.Tracks
	if len(tracks) != 2 || len(tracks[0].Clips) != 2 || len(tracks[1].Clips) != 1 {
		t.Fatalf("original footage or inserted scene was lost: %+v", tracks)
	}
	scene := tracks[1].Clips[0]
	if scene.Start != 4*document.Second || scene.Duration() != 6*document.Second || scene.AssetID != "resolved-scene" || tracks[0].Clips[1].Start != 10*document.Second {
		t.Fatalf("scene insertion or return-to-footage timing changed: %+v", tracks)
	}
}
