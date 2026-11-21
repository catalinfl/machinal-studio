package compiler

import (
	"reflect"
	"testing"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

func TestGeneratedPlacementRetainsTransformOnReplay(t *testing.T) {
	parsed, err := document.Parse([]byte(`version: 2
mode: assemble
before:
  - {id: image, type: image.generate, prompt: Coast, resultAssetId: generated}
placements:
  - job: image
    track: {type: video, role: overlay}
    start: 2s
    duration: 3s
    transform: {zoomX: 0.62, zoomY: 0.62, positionX: -24, positionY: 10}
`))
	if err != nil {
		t.Fatal(err)
	}
	input := Input{Document: parsed.Document, Assets: []document.Asset{
		{ID: "generated", File: "generated.png", Version: "v1", Kind: "image"},
	}}
	result := New().Compile(input)
	resolved := successful(t, result)
	transform := resolved.Tracks[0].Clips[0].Transform
	if transform.ZoomX != 0.62 || transform.PositionX != -24 || transform.PositionY != 10 || transform.AnchorX != 0.5 {
		t.Fatalf("placement transform or defaults changed: %+v", transform)
	}
	input.Document = *result.Document
	if replayed := successful(t, New().Compile(input)); !reflect.DeepEqual(resolved.Tracks, replayed.Tracks) {
		t.Fatal("placement geometry changed when replaying the saved document")
	}
}

func TestInvalidPlacementTransformFailsBeforeGeneration(t *testing.T) {
	transform := document.IdentityTransform()
	transform.PositionX = 101
	input := reelInput(t)
	input.Document.Version = document.RecipeVersion
	input.Document.Before = []document.Job{{ID: "image", Type: "image.generate", Prompt: "Coast"}}
	input.Document.Placements = []document.Placement{{Job: "image", Track: document.PlacementTrack{Type: "video", Role: "overlay"}, Duration: document.Second, Transform: &transform}}
	result := New().Compile(input)
	if result.Composition != nil || len(result.Diagnostics) == 0 || len(result.Requirements) != 0 {
		t.Fatalf("invalid geometry reached generation requirements: %+v", result)
	}
}

func TestModifyTextActionReplacesExistingText(t *testing.T) {
	input := reelInput(t)
	base := successful(t, New().Compile(input))
	style := document.DefaultTextStyle()
	old := document.TextItem{ID: "text-1", Text: "Old title", Duration: document.Second, TextStyle: style}
	manual := document.TextItem{ID: "manual", Text: "Keep me", Duration: document.Second, TextStyle: style}
	input.Document = document.Document{Version: document.RecipeVersion, Mode: "modify", Texts: []document.TextItem{
		{ID: "text-1", Text: "New title", Duration: document.Second, TextStyle: style},
	}}
	input.Bindings = nil
	input.Snapshot = &composition.Snapshot{Revision: "r1", Tracks: base.Tracks, TextItems: []document.TextItem{old, manual}}
	resolved := successful(t, New().Compile(input))
	if len(resolved.TextItems) != 2 || resolved.TextItems[0].Text != "Keep me" || resolved.TextItems[1].Text != "New title" {
		t.Fatalf("text action duplicated content or removed unrelated text: %+v", resolved.TextItems)
	}
}
