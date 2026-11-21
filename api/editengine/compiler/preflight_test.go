package compiler

import (
	"reflect"
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestPreflightAcceptsEmptyTimelineWithoutMakingItRenderable(t *testing.T) {
	input := Input{Document: document.Document{Mode: "assemble", Tracks: []document.Track{
		{ID: "v1", Type: "video", Clips: []document.Clip{}},
		{ID: "a1", Type: "audio", Clips: []document.Clip{}},
	}}}
	engine := New()
	checked := engine.Preflight(input)
	if checked.Composition != nil || len(checked.Diagnostics) != 0 || len(checked.Requirements) != 0 {
		t.Fatalf("empty base timeline was not accepted: %+v", checked)
	}
	result := engine.Compile(input)
	if result.Composition != nil || len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "invalid_duration" {
		t.Fatalf("empty timeline became renderable: %+v", result)
	}
}

func TestPreflightRetainsTimelineValidation(t *testing.T) {
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
			checked, compiled := engine.Preflight(input), engine.Compile(input)
			if checked.Composition != nil || len(checked.Diagnostics) == 0 || !reflect.DeepEqual(checked.Diagnostics, compiled.Diagnostics) {
				t.Fatalf("preflight lost timeline validation: checked=%+v compiled=%+v", checked, compiled)
			}
		})
	}
}
