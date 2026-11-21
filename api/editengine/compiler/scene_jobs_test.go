package compiler

import (
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestSceneAndImageBeforeJobsKeepDocumentVersionAndDuration(t *testing.T) {
	for _, version := range []int{1, 2, 3} {
		input := Input{Document: document.Document{Version: version, Mode: "assemble",
			Before: []document.Job{
				{ID: "scene", Type: "scene.generate", Prompt: "A growing tree", Duration: 3 * document.Second, ResultAssetID: "scene-asset"},
				{ID: "image", Type: "image.generate", Prompt: "Sunset", Duration: 2 * document.Second, ResultAssetID: "image-asset"},
			}, Placements: []document.Placement{
				{Job: "scene", Track: document.PlacementTrack{Type: "video", Role: "scene"}, Start: document.Second},
				{Job: "image", Track: document.PlacementTrack{Type: "video", Role: "image"}, Start: 4 * document.Second},
			}}, Assets: []document.Asset{
			{ID: "scene-asset", File: "scene.scene.json", Version: "v1", Kind: "video", Duration: 3 * document.Second},
			{ID: "image-asset", File: "image.png", Version: "v1", Kind: "image"},
		}}
		result := New().Compile(input)
		if result.Composition == nil || result.Document.Version != version || result.Composition.Duration != 6*document.Second {
			t.Fatalf("version=%d result=%+v", version, result)
		}
		replayed := New().Compile(Input{Document: *result.Document, Assets: input.Assets})
		if replayed.Composition == nil || replayed.Composition.ID != result.Composition.ID {
			t.Fatalf("scene replay changed: %+v", replayed)
		}
	}
}

func TestSceneNarrationPreservesOffsetAndRemainsAlignedAfterTrim(t *testing.T) {
	input := Input{Document: document.Document{Version: 1, Mode: "assemble",
		Before:     []document.Job{{ID: "scene", Type: "scene.edit", Prompt: "Change colors", Duration: 3 * document.Second, ResultAssetID: "scene-asset", ResultAudioAssetID: "voice", AudioStart: 5 * document.Second}},
		Placements: []document.Placement{{Job: "scene", Track: document.PlacementTrack{Type: "video", Role: "scene"}, Start: 2 * document.Second}}},
		Assets: []document.Asset{{ID: "scene-asset", File: "scene.scene.json", Version: "v1", Kind: "video", Duration: 3 * document.Second}, {ID: "voice", File: "voice.wav", Version: "v1", Kind: "audio", Duration: 7 * document.Second}}}
	result := New().Compile(input)
	if result.Composition == nil {
		t.Fatalf("narrated scene failed: %+v", result.Diagnostics)
	}
	video, audio := result.Composition.Tracks[0].Clips[0], result.Composition.Tracks[1].Clips[0]
	if audio.InPoint != 5*document.Second || audio.OutPoint != 7*document.Second || audio.Start != video.Start || audio.LinkedClipID != video.ID || video.LinkedClipID != audio.ID {
		t.Fatalf("narration timing changed: video=%+v audio=%+v", video, audio)
	}
	from, duration := document.Second, document.Second
	doc := *result.Document
	doc.Overrides = []document.Override{{Target: video.ID, From: &from, Duration: &duration}}
	trimmed := New().Compile(Input{Document: doc, Assets: input.Assets})
	if trimmed.Composition == nil || trimmed.Composition.Tracks[1].Clips[0].InPoint != 6*document.Second {
		t.Fatalf("trim lost narration offset: %+v", trimmed)
	}
}
