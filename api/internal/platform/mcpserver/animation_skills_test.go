package mcpserver

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"slices"
	"strings"
	"testing"
)

func TestAnimationSkillsAreLazySearchableAndAvailableAsResources(t *testing.T) {
	entries := referenceFixture(t)
	page, err := editingReference(referenceInput{Topic: "animation-skills", Limit: 2}, entries)
	if err != nil || page.Total != 5 || len(page.Entries) != 2 || page.NextOffset == nil {
		t.Fatal(page, err)
	}
	for _, entry := range entries["animationSkills"] {
		if strings.Contains(string(entry), `"source"`) {
			t.Fatal("discovery eagerly loaded skill source")
		}
	}
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("reference/planning must not call API")
		return Response{}, nil
	})
	for _, entry := range entries["animationSkills"] {
		var skill animationSkill
		if err := json.Unmarshal(entry, &skill); err != nil {
			t.Fatal(err)
		}
		result, output := callTool(t, handler, "get_editing_reference", map[string]any{"topic": "animation-skills", "id": skill.ID})
		if result.IsError || output.StatusCode != 200 {
			t.Fatal(result, output)
		}
		source, err := animationSkillSource(skill.ID)
		if err != nil || !strings.Contains(source, "---\nname: "+skill.ID) {
			t.Fatal(skill.ID, err)
		}
		got := output.Data.(map[string]any)["entries"].([]any)[0].(map[string]any)["source"]
		if got != source {
			t.Fatal("source differs from installed skill")
		}
		_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": skill.URI})
		if envelope["error"] != nil || !strings.Contains(string(envelope["result"]), skill.ID) {
			t.Fatal("missing skill resource")
		}
		for _, template := range skill.Templates {
			if _, err := sceneTemplateSource(template); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, id := range []string{"../secret", "machinal-motion.md", "unknown"} {
		if _, err := animationSkillSource(id); err == nil {
			t.Fatal("accepted invalid ID")
		}
	}
}

func TestSceneReviewPlanHasDistinctValidSamplesAndHonestEvidence(t *testing.T) {
	for _, input := range []sceneReviewPlanInput{{Duration: 1, FPS: 1}, {Duration: 1, FPS: 29.97}, {Duration: 60, FPS: 60}, {Duration: 8, FPS: 30, Phases: &sceneReviewAnchors{0, 2, 6, 7.5}}, {Duration: 2, FPS: 30, Phases: &sceneReviewAnchors{1, 1, 1, 1}}} {
		plan, err := planSceneReview(input)
		if err != nil || len(plan.Frames) < 1 || len(plan.Frames) > 6 || !slices.IsSorted(plan.Frames) {
			t.Fatal(plan, err)
		}
		if plan.Status != "unverified" || plan.VisualInspection || plan.MotionVerified || plan.AudioVerified || plan.Provisional != (input.Phases == nil) {
			t.Fatal("planning claimed evidence", plan)
		}
		for index, frame := range plan.Frames {
			if frame < 0 || frame >= int(math.Round(input.Duration*input.FPS)) || index > 0 && plan.Frames[index-1] == frame {
				t.Fatal("invalid sample", frame)
			}
		}
	}
	for _, input := range []sceneReviewPlanInput{{Duration: 0, FPS: 30}, {Duration: 8, FPS: 0}, {Duration: math.NaN(), FPS: 30}, {Duration: 8, FPS: math.Inf(1)}, {Duration: 8, FPS: 30, Phases: &sceneReviewAnchors{0, 6, 2, 7}}, {Duration: 8, FPS: 30, Phases: &sceneReviewAnchors{0, 1, 2, 9}}} {
		if _, err := planSceneReview(input); err == nil {
			t.Fatal("accepted invalid review plan", input)
		}
	}
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("planning must not access media")
		return Response{}, nil
	})
	result, output := callTool(t, handler, "plan_scene_review", map[string]any{"duration": 8, "fps": 30})
	if result.IsError || output.StatusCode != 200 {
		t.Fatal(result, output)
	}
}

func TestSuccessfulCompilationReturnsProvisionalReviewPlanWithoutExtraInspection(t *testing.T) {
	calls := 0
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		calls++
		if request.Path != "/v1/projects/owned/scenes/compile" || strings.Contains(string(request.Body), "reviewPlan") {
			t.Fatal("review plan changed source request", request)
		}
		return Response{StatusCode: 200, Body: []byte(`{"asset":{"id":"scene","file":"compiled.scene.json"}}`)}, nil
	})
	result, output := callTool(t, handler, "compile_scene", map[string]any{"projectId": "owned", "component": "<p>Source</p>", "duration": 8, "width": 1280, "height": 720, "fps": 30, "idempotencyKey": "review-plan-fixture", "userApproved": true})
	if result.IsError || output.StatusCode != 200 || calls != 1 {
		t.Fatal(result, output, calls)
	}
	plan := output.Data.(map[string]any)["reviewPlan"].(map[string]any)
	if plan["status"] != "unverified" || plan["provisional"] != true || plan["visualInspection"] != false {
		t.Fatal("compile claimed visual evidence", plan)
	}
}
