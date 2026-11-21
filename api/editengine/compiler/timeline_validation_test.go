package compiler

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func portraitTimelineInput(t *testing.T) Input {
	t.Helper()
	parsed, err := document.Parse([]byte(`version: 2
mode: assemble
catalogVersion: '1'
compilerVersion: '1'
tracks:
  - id: main
    type: video
    clips:
      - {id: intro, assetId: photo, start: 0, inPoint: 0, outPoint: 3.15}
      - {id: snagov, assetId: photo, start: 2.8, inPoint: 0, outPoint: 4.77}
      - {id: dacia, assetId: photo, start: 7.22, inPoint: 0, outPoint: 7.39}
      - {id: sceptre, assetId: photo, start: 14.26, inPoint: 0, outPoint: 4.57}
      - {id: canal, assetId: photo, start: 18.48, inPoint: 0, outPoint: 3.92}
      - {id: tanca, assetId: photo, start: 22.05, inPoint: 0, outPoint: 6.71}
      - {id: berlin, assetId: photo, start: 28.41, inPoint: 0, outPoint: 1.7}
transitions:
  - {id: x0, trackId: main, leftClipId: intro, rightClipId: snagov, preset: cross-dissolve, duration: 0.35}
  - {id: x1, trackId: main, leftClipId: snagov, rightClipId: dacia, preset: cross-dissolve, duration: 0.35}
  - {id: x2, trackId: main, leftClipId: dacia, rightClipId: sceptre, preset: cross-dissolve, duration: 0.35}
  - {id: x3, trackId: main, leftClipId: sceptre, rightClipId: canal, preset: cross-dissolve, duration: 0.35}
  - {id: x4, trackId: main, leftClipId: canal, rightClipId: tanca, preset: cross-dissolve, duration: 0.35}
  - {id: x5, trackId: main, leftClipId: tanca, rightClipId: berlin, preset: cross-dissolve, duration: 0.35}
output: {aspect: portrait, resolution: 1080p, fps: 30, format: mp4}
`))
	if err != nil {
		t.Fatal(err)
	}
	return Input{Document: parsed.Document, Assets: []document.Asset{
		{ID: "photo", File: "fixture.jpg", Version: "example-only", Kind: "image", Width: 1080, Height: 1920},
	}}
}

func TestValidateRejectsTimelineEndsUsedAsSourceOutPoints(t *testing.T) {
	input := portraitTimelineInput(t)
	for index := range input.Document.Tracks[0].Clips {
		clip := &input.Document.Tracks[0].Clips[index]
		clip.OutPoint = clip.End()
	}
	engine := New()
	checked, compiled := engine.Validate(input), engine.Compile(input)
	if checked.Composition != nil || len(checked.Diagnostics) == 0 || !reflect.DeepEqual(checked.Diagnostics, compiled.Diagnostics) {
		t.Fatalf("free validation missed timeline errors: checked=%+v compiled=%+v", checked, compiled)
	}
	invalid := make(map[string]bool)
	for _, diagnostic := range checked.Diagnostics {
		if diagnostic.Code == "invalid_overlap" {
			invalid[diagnostic.Path] = true
			for _, detail := range []string{"timeline overlap", "outPoint", "inPoint", "playbackRate"} {
				if !strings.Contains(diagnostic.Message, detail) {
					t.Errorf("missing %q in overlap diagnostic: %+v", detail, diagnostic)
				}
			}
		}
	}
	if invalid["transitions[0].duration"] || len(invalid) != 5 {
		t.Fatalf("expected only the five later transitions to fail: %+v", checked.Diagnostics)
	}
	for index := 1; index < 6; index++ {
		if !invalid[fmt.Sprintf("transitions[%d].duration", index)] {
			t.Errorf("missing error for transition x%d", index)
		}
	}
}

func TestValidateAcceptsSourceDurationsAndExactDecimalOverlaps(t *testing.T) {
	input := portraitTimelineInput(t)
	engine := New()
	checked := engine.Validate(input)
	if checked.Composition != nil || len(checked.Diagnostics) != 0 || len(checked.Requirements) != 0 {
		t.Fatalf("valid timeline failed free validation: %+v", checked)
	}
	resolved := successful(t, engine.Compile(input))
	if resolved.Duration != document.Seconds(30.11) || len(resolved.Transitions) != 6 {
		t.Fatalf("incorrect timeline: %+v", resolved)
	}
	for index, transition := range resolved.Transitions {
		clips := resolved.Tracks[0].Clips
		if transition.Duration != document.Seconds(0.35) || clips[index].End()-clips[index+1].Start != transition.Duration {
			t.Fatalf("decimal overlap drifted: %+v", transition)
		}
	}
}

func TestValidatePreservesPendingGenerationRequirements(t *testing.T) {
	input := Input{Document: document.Document{Version: 2, Mode: "assemble", Before: []document.Job{
		{ID: "voice", Type: "speech.generate", Text: "Salut"},
	}}}
	result := New().Validate(input)
	if result.Composition != nil || len(result.Diagnostics) != 0 || len(result.Requirements) != 1 || result.Requirements[0].ID != "voice" {
		t.Fatalf("validation lost pending generation: %+v", result)
	}
}
