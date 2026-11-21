package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/core/editor/compositions"
	"ffmpeg-go-server/internal/platform/jobqueue"
)

func TestJobResultAutoSavesRecipeRefAndSupportsCaptionBaselineRefAndJobID(t *testing.T) {
	data, err := os.ReadFile("testdata/caption-preservation.edit.yaml")
	if err != nil {
		t.Fatal(err)
	}
	parsed, _, err := compositions.ParseProject(data)
	if err != nil {
		t.Fatal(err)
	}
	jobView, err := json.Marshal(jobqueue.Job{
		ID:         testJobID,
		Status:     "completed",
		StatusCode: 200,
		Result: mustJSONRaw(t, map[string]any{
			"document":    parsed.Document,
			"bindings":    parsed.Bindings,
			"composition": map[string]any{"assets": parsed.Assets},
		}),
	}.View())
	if err != nil {
		t.Fatal(err)
	}

	validateCalls := 0
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		if request.Method == http.MethodGet && strings.Contains(request.Path, "/jobs/"+testJobID) {
			return Response{StatusCode: 200, Body: jobView}, nil
		}
		validateCalls++
		return Response{StatusCode: 200, Body: []byte(`{"diagnostics":[],"requirements":[]}`)}, nil
	})

	res, out := callTool(t, handler, "get_job_result", map[string]any{"projectId": "owned", "jobId": testJobID})
	if res.IsError {
		t.Fatalf("get_job_result failed: %+v", res)
	}
	fields := out.Data.(map[string]any)
	baselineRef, _ := fields["recipeRef"].(string)
	baselineYAML, _ := fields["recipeYaml"].(string)
	if baselineRef == "" || baselineRef != compositionVersion(baselineYAML) {
		t.Fatalf("get_job_result did not auto-save recipeRef: %+v", fields)
	}

	edited := strings.ReplaceAll(baselineYAML, "artă", "artă!")
	edits := []captionTextEdit{{From: "artă", To: "artă!"}}

	// Validate using captionBaselineRef (no inline captionBaseline YAML needed!).
	res, out = callTool(t, handler, "validate_recipe", map[string]any{
		"projectId":              "owned",
		"composition":            edited,
		"captionBaselineRef":     baselineRef,
		"expectedCaptionVersion": recipeCaptionVersion(baselineYAML),
		"captionTextEdits":       edits,
		"captionEditsApproved":   true,
	})
	if res.IsError || out.Data.(map[string]any)["captionReview"].(map[string]any)["status"] != "preserved" {
		t.Fatalf("captionBaselineRef failed: %+v %+v", res, out)
	}

	// Validate using captionBaselineJobId (resolved directly on server!).
	res, out = callTool(t, handler, "validate_recipe", map[string]any{
		"projectId":              "owned",
		"composition":            edited,
		"captionBaselineJobId":   testJobID,
		"expectedCaptionVersion": recipeCaptionVersion(baselineYAML),
		"captionTextEdits":       edits,
		"captionEditsApproved":   true,
	})
	if res.IsError || out.Data.(map[string]any)["captionReview"].(map[string]any)["status"] != "preserved" {
		t.Fatalf("captionBaselineJobId failed: %+v %+v", res, out)
	}
	if validateCalls != 2 {
		t.Fatalf("validateCalls = %d, want 2", validateCalls)
	}

	// Conflicting baseline sources and cross-project ref must fail before reaching API.
	for _, bad := range []map[string]any{
		{"projectId": "owned", "composition": edited, "captionBaseline": baselineYAML, "captionBaselineRef": baselineRef},
		{"projectId": "owned", "composition": edited, "captionBaselineJobId": testJobID, "captionBaselineRef": baselineRef},
		{"projectId": "other", "composition": edited, "captionBaselineRef": baselineRef},
	} {
		res, _ = callTool(t, handler, "validate_recipe", bad)
		if !res.IsError {
			t.Fatalf("accepted invalid baseline arguments: %+v", bad)
		}
	}
	if validateCalls != 2 {
		t.Fatalf("invalid baseline arguments reached API: validateCalls=%d", validateCalls)
	}
}

func TestPatchRecipeMutatesServerSideAndChainsIntoCompileAndRender(t *testing.T) {
	data, err := os.ReadFile("testdata/caption-preservation.edit.yaml")
	if err != nil {
		t.Fatal(err)
	}
	baseYAML := string(data)
	var lastSubmittedYAML string
	var lastPath string
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		lastPath = request.Path
		if request.ContentType == "application/yaml" {
			lastSubmittedYAML = string(request.Body)
		}
		if strings.HasSuffix(request.Path, "/renders") {
			return Response{StatusCode: 202, Body: []byte(`{"id":"` + testJobID + `","status":"queued"}`)}, nil
		}
		return Response{StatusCode: 200, Body: []byte(`{"diagnostics":[],"requirements":[]}`)}, nil
	})

	// Seed a base recipeRef via validate_recipe.
	res, out := callTool(t, handler, "validate_recipe", map[string]any{
		"projectId":   "owned",
		"composition": baseYAML,
	})
	if res.IsError {
		t.Fatalf("initial validate failed: %+v", res)
	}
	baseRef := out.Data.(map[string]any)["recipeRef"].(string)
	baseCaptionVer := out.Data.(map[string]any)["captionVersion"].(string)

	// Patch: add a new scene asset, add a video track, add an effect & transition, and update output fps — without resending full YAML.
	res, out = callTool(t, handler, "patch_recipe", map[string]any{
		"projectId":              "owned",
		"baseRecipeRef":          baseRef,
		"expectedCaptionVersion": baseCaptionVer,
		"operations": []map[string]any{
			{
				"op": "upsertAssets",
				"assets": []map[string]any{
					{"id": "scene-v1", "file": "scene_v1.scene.json", "version": "sha256:" + strings.Repeat("1", 64), "kind": "video", "duration": 6, "width": 1080, "height": 1920},
					{"id": "scene-v2", "file": "scene_v2.scene.json", "version": "sha256:" + strings.Repeat("2", 64), "kind": "video", "duration": 6, "width": 1080, "height": 1920},
				},
			},
			{
				"op": "upsertTracks",
				"tracks": []map[string]any{
					{
						"id": "visuals", "name": "Visuals", "type": "video",
						"clips": []map[string]any{
							{"id": "beat1", "assetId": "scene-v1", "start": 0, "inPoint": 0, "outPoint": 3.4, "playbackRate": 1, "opacity": 1},
							{"id": "beat2", "assetId": "scene-v1", "start": 3, "inPoint": 0, "outPoint": 3, "playbackRate": 1, "opacity": 1},
						},
					},
				},
			},
			{
				"op": "setTransitions",
				"transitions": []map[string]any{
					{"id": "dissolve-1", "trackId": "visuals", "leftClipId": "beat1", "rightClipId": "beat2", "preset": "cross-dissolve", "duration": 0.4},
				},
			},
			{
				"op": "setEffects",
				"effects": []map[string]any{
					{"id": "bloom-1", "trackId": "visuals", "ownerClipId": "beat2", "preset": "glow-bloom", "start": 3, "duration": 2},
				},
			},
			{
				"op":     "setOutput",
				"output": map[string]any{"fps": 24},
			},
		},
	})
	if res.IsError {
		t.Fatalf("patch_recipe failed: %s (%+v)", toolErrorText(res), out)
	}
	patchData := out.Data.(map[string]any)
	if _, echoed := patchData["recipeYaml"]; echoed {
		t.Fatal("patch_recipe echoed full recipeYaml by default")
	}
	patchedRef := patchData["recipeRef"].(string)
	if patchedRef == "" || patchedRef == baseRef {
		t.Fatalf("expected new recipeRef, got %q", patchedRef)
	}
	if patchData["captionVersion"] != baseCaptionVer {
		t.Fatalf("non-caption patch altered captionVersion: %v != %v", patchData["captionVersion"], baseCaptionVer)
	}

	// Second tiny patch (Turn 25 scenario!): swap beat2's assetId from scene-v1 -> scene-v2 and apply an approved caption word edit.
	res, out = callTool(t, handler, "patch_recipe", map[string]any{
		"projectId":            "owned",
		"baseRecipeRef":        patchedRef,
		"captionEditsApproved": true,
		"operations": []map[string]any{
			{"op": "replaceClipAsset", "clipId": "beat2", "assetId": "scene-v2", "outPoint": 3.5},
			{"op": "applyCaptionTextEdits", "captionTextEdits": []captionTextEdit{{From: "artă", To: "artă!"}}},
		},
	})
	if res.IsError {
		t.Fatalf("second patch_recipe failed: %s (%+v)", toolErrorText(res), out)
	}
	finalData := out.Data.(map[string]any)
	finalRef := finalData["recipeRef"].(string)
	if finalData["captionReview"].(map[string]any)["status"] != "preserved" {
		t.Fatalf("caption review not preserved: %+v", finalData["captionReview"])
	}

	// Chain the patched recipeRef directly into render_video with zero inline YAML!
	res, _ = callTool(t, handler, "render_video", map[string]any{
		"projectId":                  "owned",
		"recipeRef":                  finalRef,
		"expectedCompositionVersion": finalRef,
		"expectedCaptionVersion":     finalData["captionVersion"],
		"userApproved":               true,
		"idempotencyKey":             "patched-render-1",
	})
	if res.IsError || !strings.HasSuffix(lastPath, "/renders") {
		t.Fatalf("render_video with patched recipeRef failed: %+v %s", res, lastPath)
	}
	rendered, _, err := compositions.ParseProject([]byte(lastSubmittedYAML))
	if err != nil {
		t.Fatalf("rendered patched YAML failed to parse: %v\n%s", err, lastSubmittedYAML)
	}
	if rendered.Document.Output.FPS != 24 || len(rendered.Document.Transitions) != 1 || len(rendered.Document.Effects) != 1 {
		t.Fatalf("patched fields missing in rendered YAML: %+v", rendered.Document)
	}
	foundClip := false
	for _, track := range rendered.Document.Tracks {
		for _, clip := range track.Clips {
			if clip.ID == "beat2" {
				foundClip = true
				if clip.AssetID != "scene-v2" || clip.OutPoint.Seconds() != 3.5 {
					t.Fatalf("replaceClipAsset did not apply: %+v", clip)
				}
			}
		}
	}
	if !foundClip {
		t.Fatal("beat2 clip missing after patch")
	}

	// Unapproved applyCaptionTextEdits must be rejected before mutating.
	res, _ = callTool(t, handler, "patch_recipe", map[string]any{
		"projectId":     "owned",
		"baseRecipeRef": patchedRef,
		"operations": []map[string]any{
			{"op": "applyCaptionTextEdits", "captionTextEdits": []captionTextEdit{{From: "artă", To: "artă!"}}},
		},
	})
	if !res.IsError {
		t.Fatal("unapproved caption edit in patch_recipe was accepted")
	}
}

func mustJSONRaw(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func toolErrorText(res any) string {
	b, _ := json.Marshal(res)
	return string(b)
}
