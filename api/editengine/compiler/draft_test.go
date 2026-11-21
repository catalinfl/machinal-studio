package compiler

import (
	"reflect"
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestCompileDraftAcceptsEmptyEditorTimeline(t *testing.T) {
	input := Input{Document: document.Document{Mode: "assemble", Tracks: []document.Track{
		{ID: "v1", Type: "video", Clips: []document.Clip{}},
		{ID: "a1", Type: "audio", Clips: []document.Clip{}},
	}}}
	engine := New()
	draft := engine.CompileDraft(input)
	resolved := successful(t, draft)
	if resolved.Duration != 0 || len(resolved.Tracks) != 2 {
		t.Fatalf("empty draft changed editor geometry: %+v", resolved)
	}
	input.Document = *draft.Document
	if replayed := successful(t, engine.CompileDraft(input)); replayed.ID != resolved.ID {
		t.Fatal("empty draft did not recompile identically")
	}
	if result := engine.Compile(input); result.Composition != nil || len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "invalid_duration" {
		t.Fatalf("render compilation accepted an empty draft: %+v", result)
	}
}

func TestCompileDraftMatchesRenderableComposition(t *testing.T) {
	input := reelInput(t)
	engine := New()
	draft, rendered := engine.CompileDraft(input), engine.Compile(input)
	if successful(t, draft).ID != successful(t, rendered).ID {
		t.Fatal("draft compilation changed a nonempty composition")
	}
}

func TestCompileDraftRetainsValidation(t *testing.T) {
	for name, change := range map[string]func(*Input){
		"source bounds": func(input *Input) { input.Document.Sequence.Each.Take.From = 8 * document.Second },
		"duration limit": func(input *Input) {
			start := document.MaxTime
			input.Document.Overrides = []document.Override{{Target: "sequence/shots/c/1", Start: &start}}
		},
		"duplicate track": func(input *Input) {
			input.Document.Tracks = []document.Track{{ID: "sequence/video", Type: "audio", Clips: []document.Clip{}}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			input := reelInput(t)
			change(&input)
			engine := New()
			draft, rendered := engine.CompileDraft(input), engine.Compile(input)
			if draft.Composition != nil || len(draft.Diagnostics) == 0 || !reflect.DeepEqual(draft.Diagnostics, rendered.Diagnostics) {
				t.Fatalf("draft lost validation: draft=%+v rendered=%+v", draft, rendered)
			}
		})
	}
}
