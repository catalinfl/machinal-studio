package mcpserver

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/internal/core/editor/compositions"

	"gopkg.in/yaml.v3"
)

func TestSceneImageDefaultsReachInitializationAndReferences(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("image guidance must not access customer data or call providers")
		return Response{}, nil
	})
	guides := map[string]string{"workflow-policy": workflowPolicy(t, handler), "recipe-guide": recipeGuide}
	for _, topic := range []string{"jobs", "scenes", "scene-authoring"} {
		result, output := callTool(t, handler, "get_editing_reference", map[string]any{"topic": topic})
		if result.IsError || output.StatusCode != http.StatusOK {
			t.Fatalf("image guidance is unavailable: %s", topic)
		}
		guides[topic] = output.Data.(map[string]any)["guide"].(string)
	}
	for name, guide := range guides {
		t.Run(name, func(t *testing.T) {
			for _, instruction := range []string{
				"default", "SVG/CSS", "image.generate", "without waiting",
				"background: transparent", "openai/gpt-image-2.5-sunburst", "openai/gpt-image-2.5-flare",
				"background: opaque", "compile_scene.transparent", "PNG/WebP alpha",
				"no-generation", "procedural-only", "generation/spending scope", "automatic",
			} {
				if !strings.Contains(guide, instruction) {
					t.Errorf("missing image-asset instruction %q", instruction)
				}
			}
		})
	}
}

func TestSceneImageGuideUsesSupportedTransparentJobFields(t *testing.T) {
	reference, err := editingReference(referenceInput{Topic: "scenes"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, code, found := strings.Cut(reference.Guide, "```yaml\n")
	if !found {
		t.Fatal("missing transparent image job example")
	}
	code, _, found = strings.Cut(code, "\n```")
	if !found {
		t.Fatal("unterminated transparent image job example")
	}
	var fragment struct {
		Before []map[string]any `yaml:"before"`
	}
	if err := yaml.Unmarshal([]byte(code), &fragment); err != nil {
		t.Fatal(err)
	}
	if len(fragment.Before) != 1 {
		t.Fatalf("expected one image job: %+v", fragment)
	}
	job := fragment.Before[0]
	if job["type"] != "image.generate" || job["background"] != "transparent" || job["model"] != "openai/gpt-image-2.5-sunburst" {
		t.Fatalf("example lost transparent image settings: %+v", job)
	}
	if _, exists := job["transparent"]; exists {
		t.Fatal("image example invented a scene-canvas field")
	}
}

func TestMCPForwardsTransparentImageRecipeOnlyAfterApproval(t *testing.T) {
	const source = `document:
  version: 1
  mode: assemble
  before:
    - id: foreground
      type: image.generate
      model: openai/gpt-image-2.5-sunburst
      background: transparent
      prompt: A complete oak sapling, isolated with real alpha and clean edges.
  placements:
    - job: foreground
      track: {type: video, role: foreground}
      start: 0s
      duration: 4s
`
	input, _, err := compositions.ParseProject([]byte(source))
	if err != nil {
		t.Fatal(err)
	}
	compiled := compiler.New().Compile(input)
	if compositions.HasErrors(compiled) || len(compiled.Requirements) != 1 || compiled.Requirements[0].Kind != "image.generate" {
		t.Fatalf("transparent image recipe did not pass pending preflight: %+v", compiled)
	}
	calls := 0
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		calls++
		if request.Path != "/v1/projects/owned/compositions/compile-and-generate" || string(request.Body) != source || request.IdempotencyKey != "transparent-foreground" {
			t.Fatalf("transparent image recipe was changed: %+v", request)
		}
		return Response{StatusCode: http.StatusAccepted, Body: []byte(`{"status":"queued"}`)}, nil
	})
	args := map[string]any{"projectId": "owned", "composition": source, "idempotencyKey": "transparent-foreground", "userApproved": false}
	result, _ := callTool(t, handler, "generate_assets", args)
	if !result.IsError || calls != 0 {
		t.Fatal("default image policy bypassed approval")
	}
	args["userApproved"] = true
	result, output := callTool(t, handler, "generate_assets", args)
	if result.IsError || output.StatusCode != http.StatusAccepted || calls != 1 {
		t.Fatal("approved transparent image recipe was not forwarded", result, output)
	}
}
