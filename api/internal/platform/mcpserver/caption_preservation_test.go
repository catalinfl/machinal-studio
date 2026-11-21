package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/compositions"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestAIEntryPointsPreserveExistingCaptionConfiguration(t *testing.T) {
	guides := map[string]string{"initialization": instructions, "recipe guide": recipeGuide}
	for _, topic := range []string{"overview", "yaml", "audio", "text", "scene-authoring", "production"} {
		reference, err := editingReference(referenceInput{Topic: topic}, nil)
		if err != nil {
			t.Fatal(err)
		}
		guides[topic] = reference.Guide
	}
	for name, guide := range guides {
		t.Run(name, func(t *testing.T) {
			for _, guidance := range []string{
				"read-only unless the user explicitly requests a caption change",
				"line breaks", "resultTextIds", "timings", "animation/highlighting/effects",
			} {
				if !strings.Contains(guide, guidance) {
					t.Errorf("missing caption preservation guidance %q", guidance)
				}
			}
		})
	}
	for _, guidance := range []string{"trim/collapse whitespace", "compare the complete caption entries", "Validation/compilation alone does not prove preservation", "not a new YAML lock flag"} {
		if !strings.Contains(instructions, guidance) {
			t.Errorf("initialization lacks %q", guidance)
		}
	}
	for _, guide := range []string{instructions, guides["text"]} {
		for _, guidance := range []string{"NEW caption generation", "retroactively"} {
			if !strings.Contains(guide, guidance) {
				t.Errorf("caption default scope lacks %q", guidance)
			}
		}
	}
}

func TestRecipeToolDescriptionsPreserveExistingCaptions(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("tool discovery must not call the API")
		return Response{}, nil
	})
	_, envelope := rpc(t, handler, "tools/list", map[string]any{})
	var catalog mcp.ListToolsResult
	if err := json.Unmarshal(envelope["result"], &catalog); err != nil {
		t.Fatal(err)
	}
	required := map[string]bool{"validate_recipe": false, "compile_recipe": false, "render_video": false, "generate_assets": false}
	for _, tool := range catalog.Tools {
		if _, ok := required[tool.Name]; ok {
			required[tool.Name] = true
			if !strings.Contains(tool.Description, "Preserve existing captions verbatim") {
				t.Errorf("%s lacks the caption preservation hint", tool.Name)
			}
		}
		if tool.Name == "get_workflow_preferences" && !strings.Contains(tool.Description, "new caption generation only") {
			t.Error("workflow preferences can override existing captions")
		}
	}
	for name, found := range required {
		if !found {
			t.Errorf("missing recipe tool %s", name)
		}
	}
}

func TestRecipeToolsPreserveCaptionPayloadAndResolvedContinuation(t *testing.T) {
	source, err := os.ReadFile("testdata/caption-preservation.edit.yaml")
	if err != nil {
		t.Fatal(err)
	}
	baseline, _, err := compositions.ParseProject(source)
	if err != nil {
		t.Fatal(err)
	}
	resolved := compiler.New().Compile(baseline)
	if compositions.HasErrors(resolved) || resolved.Composition == nil || len(resolved.Requirements) != 0 {
		t.Fatalf("invalid caption fixture: %+v", resolved)
	}
	assertCaptionEntriesUnchanged(t, baseline.Document, *resolved.Document)
	jobBody, err := json.Marshal(map[string]any{"status": "completed", "result": resolved})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"validate_recipe", "compile_recipe", "render_video", "generate_assets"} {
		for _, continuation := range []bool{false, true} {
			mode := "composition"
			if continuation {
				mode = "sourceJobId"
			}
			t.Run(name+"/"+mode, func(t *testing.T) {
				submissions := 0
				handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
					if request.Method == http.MethodGet {
						if !continuation || request.Path != "/v1/projects/owned/jobs/"+testJobID+"?view=result" {
							t.Fatalf("unexpected source lookup: %+v", request)
						}
						return Response{StatusCode: http.StatusOK, Body: jobBody}, nil
					}
					submissions++
					if !continuation && string(request.Body) != string(source) {
						t.Fatal("MCP rewrote the submitted YAML")
					}
					input, _, err := compositions.ParseProject(request.Body)
					if err != nil {
						t.Fatal(err)
					}
					assertCaptionEntriesUnchanged(t, baseline.Document, input.Document)
					compiled := compiler.New().Compile(input)
					if compositions.HasErrors(compiled) || compiled.Composition == nil || len(compiled.Requirements) != 0 {
						t.Fatalf("continuation requires regeneration or is invalid: %+v", compiled)
					}
					assertCaptionEntriesUnchanged(t, baseline.Document, *compiled.Document)
					return Response{StatusCode: http.StatusOK, Body: []byte(`{"ok":true}`)}, nil
				})
				args := map[string]any{"projectId": "owned", "userApproved": true, "idempotencyKey": "caption-preservation-test"}
				if name == "validate_recipe" || name == "compile_recipe" {
					delete(args, "userApproved")
					delete(args, "idempotencyKey")
				}
				if continuation {
					args["sourceJobId"] = testJobID
				} else {
					args["composition"] = string(source)
				}
				result, _ := callTool(t, handler, name, args)
				if result.IsError || submissions != 1 {
					t.Fatalf("unexpected result or submission count: %+v, %d", result, submissions)
				}
			})
		}
	}
}

func assertCaptionEntriesUnchanged(t *testing.T, want, got document.Document) {
	t.Helper()
	for label, values := range map[string][2]any{
		"caption entries": {want.Texts, got.Texts},
		"caption results": {want.Jobs[0].ResultTextIDs, got.Jobs[0].ResultTextIDs},
	} {
		before, err := json.Marshal(values[0])
		if err != nil {
			t.Fatal(err)
		}
		after, err := json.Marshal(values[1])
		if err != nil {
			t.Fatal(err)
		}
		if string(before) != string(after) {
			t.Fatalf("%s changed:\nwant %s\ngot  %s", label, before, after)
		}
	}
}
