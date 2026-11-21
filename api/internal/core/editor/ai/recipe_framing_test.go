package ai

import (
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
)

func TestRecipeFramingPreservesOtherOutputSettings(t *testing.T) {
	input := twoMinuteInput()
	input.Document.Output.Fit = document.VideoFitCover
	for name, output := range map[string]map[string]any{
		"preserve": {},
		"portrait": {"aspect": "portrait"},
		"contain":  {"fit": "contain"},
	} {
		t.Run(name, func(t *testing.T) {
			response := dslTestResponse(dslCall("framing", recipeToolName, map[string]any{
				"mode": "execute", "summary": "Update framing", "recipe": map[string]any{"mode": "modify", "output": output},
			}))
			_, result, err := validateRecipeResponse(response, input, compiler.New(), recipeAnalysis{}, "update framing", recipeProject(input, 0))
			if err != nil {
				t.Fatal(err)
			}
			want := input.Document.Output
			if name == "portrait" {
				want.Aspect = "portrait"
			}
			if name == "contain" {
				want.Fit = document.VideoFitContain
			}
			if result.Composition == nil || result.Composition.Output != want {
				t.Fatalf("framing or unrelated output settings changed: %+v", result)
			}
		})
	}
}
