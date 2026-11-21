package compiler

import (
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func sceneDesignInput() Input {
	return Input{Document: document.Document{Version: 2, Mode: "assemble",
		Before: []document.Job{
			{ID: "art", Type: "image.generate", Prompt: "A detailed fox on a transparent background"},
			{ID: "scene", Type: "scene.generate", Prompt: "Animate the supplied fox", Duration: 6 * document.Second, VisualMode: "3d",
				Images: []document.SceneImage{{ID: "image_1", Job: "art", Name: "Fox"}}},
		},
		Placements: []document.Placement{{Job: "scene", Track: document.PlacementTrack{Type: "video", Role: "scene"}, Duration: 6 * document.Second}},
	}}
}

func TestSceneDesignAcceptsThreeJSAndEarlierGeneratedImages(t *testing.T) {
	result := New().Compile(sceneDesignInput())
	if len(result.Diagnostics) != 0 || len(result.Requirements) != 2 {
		t.Fatalf("valid 3D/image plan was rejected: %+v", result)
	}
}

func TestSceneDesignRejectsInvalidInputsBeforeGeneration(t *testing.T) {
	tests := map[string]func(*document.Job){
		"long prompt":       func(job *document.Job) { job.Prompt = strings.Repeat("ă", document.MaxScenePromptRunes+1) },
		"visual mode":       func(job *document.Job) { job.VisualMode = "webgl-maybe" },
		"missing image job": func(job *document.Job) { job.Images[0].Job = "missing" },
		"self dependency":   func(job *document.Job) { job.Images[0].Job = "scene" },
		"ambiguous image":   func(job *document.Job) { job.Images[0].File = "fox.png" },
		"unsafe image":      func(job *document.Job) { job.Images[0].Job = ""; job.Images[0].File = "../fox.png" },
		"duplicate image":   func(job *document.Job) { job.Images = append(job.Images, job.Images[0]) },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			input := sceneDesignInput()
			mutate(&input.Document.Before[1])
			result := New().Compile(input)
			if len(result.Diagnostics) == 0 || result.Composition != nil {
				t.Fatalf("invalid scene passed preflight: %+v", result)
			}
			if validated := New().Validate(input); len(validated.Diagnostics) == 0 {
				t.Fatalf("validate_recipe missed an invalid scene before compilation: %+v", validated)
			}
		})
	}
}

func TestScenePromptLimitCountsUnicodeCharacters(t *testing.T) {
	input := sceneDesignInput()
	input.Document.Before[1].Prompt = strings.Repeat("ă", document.MaxScenePromptRunes)
	if result := New().Compile(input); len(result.Diagnostics) != 0 {
		t.Fatalf("valid Unicode prompt was rejected: %+v", result.Diagnostics)
	}
}
