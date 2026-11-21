package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/internal/core/editor/compositions"
)

func TestPreflightSummaryRetainsDiagnosticsVersionsAndReviews(t *testing.T) {
	source, err := os.ReadFile("testdata/caption-preservation.edit.yaml")
	if err != nil {
		t.Fatal(err)
	}
	input, _, err := compositions.ParseProject(source)
	if err != nil {
		t.Fatal(err)
	}
	compiled := compiler.New().Compile(input)
	body, err := json.Marshal(compiled)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		if string(request.Body) != strings.ReplaceAll(string(source), "\r\n", "\n") {
			t.Fatal("preflight changed recipe")
		}
		return Response{StatusCode: 200, Body: body}, nil
	})
	for _, name := range []string{"validate_recipe", "compile_recipe"} {
		for _, full := range []bool{false, true} {
			result, output := callTool(t, handler, name, map[string]any{"projectId": "owned", "composition": string(source), "fullResult": full})
			if result.IsError {
				t.Fatal(result)
			}
			fields := output.Data.(map[string]any)
			if fields["compositionVersion"] != compositionVersion(string(source)) || fields["captionVersion"] != recipeCaptionVersion(string(source)) || fields["planSummary"] == nil || fields["diagnostics"] == nil || fields["requirements"] == nil {
				t.Fatal(fields)
			}
			if (fields["document"] != nil) != full || (fields["composition"] != nil) != full {
				t.Fatal("normalized content must be opt-in", full)
			}
			if name == "compile_recipe" && (fields["editorialReview"] == nil || fields["productionReview"] == nil) {
				t.Fatal("review evidence lost")
			}
		}
	}
}

func TestCaptionVersionDetectsExactEntryAndResultIDChangesBeforeSubmission(t *testing.T) {
	source, err := os.ReadFile("testdata/caption-preservation.edit.yaml")
	if err != nil {
		t.Fatal(err)
	}
	baseline := recipeCaptionVersion(string(source))
	if baseline == "" {
		t.Fatal("missing baseline")
	}
	for _, replacement := range [][2]string{
		{"Știință,  artă", "Știință, artă"}, {"text: artă", "text: arta"}, {"end: 0.2s", "end: 0.3s"},
		{"fontSize: 48", "fontSize: 49"}, {"y: 1560", "y: 1550"}, {"animation: rise", "animation: pop"},
		{"captions-ro/0, captions-ro/1", "captions-ro/1, captions-ro/0"},
	} {
		changed := strings.Replace(string(source), replacement[0], replacement[1], 1)
		if changed == string(source) || recipeCaptionVersion(changed) == baseline {
			t.Fatal("missed text/caption change", replacement)
		}
		for _, name := range []string{"validate_recipe", "compile_recipe", "render_video", "generate_assets"} {
			handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
				t.Fatal("changed captions reached API", name)
				return Response{}, nil
			})
			args := map[string]any{"projectId": "owned", "composition": changed, "expectedCaptionVersion": baseline}
			if name == "render_video" || name == "generate_assets" {
				args["userApproved"], args["idempotencyKey"] = true, "same-key"
			}
			result, _ := callTool(t, handler, name, args)
			if !result.IsError {
				t.Fatal("changed baseline accepted", replacement, name)
			}
		}
	}
	visualChange := strings.Replace(string(source), "fps: 30", "fps: 24", 1)
	if err := checkCaptionVersion(visualChange, baseline); err != nil {
		t.Fatal("unrelated visual edit changed captions", err)
	}
}
