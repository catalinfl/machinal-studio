package compositions

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/imagegen"
	"ffmpeg-go-server/internal/core/editor/scenes"
)

func TestGeneratedImageIsAttachedToThreeJSSceneAndRecoveredOnFailure(t *testing.T) {
	previousImage, previousScene := generateImageCall, generateSceneCall
	t.Cleanup(func() { generateImageCall, generateSceneCall = previousImage, previousScene })
	imageCalls := 0
	generateImageCall = func(_ context.Context, root string, _ func(string) (string, error), _, _, _, _ string) (imagegen.GeneratedImage, error) {
		imageCalls++
		if err := os.WriteFile(filepath.Join(root, "generated-fox.png"), []byte("fixture"), 0600); err != nil {
			return imagegen.GeneratedImage{}, err
		}
		return imagegen.GeneratedImage{Name: "generated-fox.png", Width: 64, Height: 64}, nil
	}
	failScene := true
	generateSceneCall = func(_ context.Context, _, _ string, request scenes.Request) (scenes.Scene, error) {
		if request.VisualMode != "3d" || len(request.Images) != 1 || request.Images[0].File != "generated-fox.png" {
			t.Fatalf("lost Three.js mode or generated attachment: %+v", request)
		}
		if failScene {
			return scenes.Scene{}, errors.New("temporary scene provider failure")
		}
		return scenes.Scene{Asset: document.Asset{ID: "scene-result", File: "fox.scene.json", Version: "v1", Kind: "video", Duration: 6 * document.Second}}, nil
	}
	input := compiler.Input{Document: document.Document{Version: 2, Mode: "assemble",
		Before: []document.Job{
			{ID: "art", Type: "image.generate", Prompt: "Detailed fox"},
			{ID: "scene", Type: "scene.generate", Prompt: "Orbit around the fox image", VisualMode: "3d", Duration: 6 * document.Second,
				Images: []document.SceneImage{{ID: "image_1", Job: "art", Name: "Fox"}}},
		},
		Placements: []document.Placement{{Job: "scene", Track: document.PlacementTrack{Type: "video", Role: "scene"}}},
	}}
	root := t.TempDir()
	failed, err := CompileGenerated(context.Background(), input, root, "")
	if err == nil || failed.Recovery == nil || len(failed.Recovery.Assets) != 1 || failed.Recovery.Document.Before[0].ResultAssetID == "" {
		t.Fatalf("successful image was lost after scene failure: %+v, %v", failed, err)
	}
	failScene = false
	recovery := failed.Recovery
	resolved, err := CompileGenerated(context.Background(), compiler.Input{Document: recovery.Document, Assets: recovery.Assets, Bindings: recovery.Bindings}, root, "")
	if err != nil || resolved.Composition == nil || imageCalls != 1 {
		t.Fatalf("recovery regenerated an image or failed: calls=%d, result=%+v, err=%v", imageCalls, resolved, err)
	}
	if len(resolved.Document.Jobs) != 2 || resolved.Document.Jobs[1].Images[0].Job != "" || resolved.Document.Jobs[1].Images[0].File != "generated-fox.png" {
		t.Fatalf("resolved recipe did not pin the actual image filename: %+v", resolved.Document)
	}
}
