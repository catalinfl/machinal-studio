package compositions

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/imagegen"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/core/editor/speech"
	"ffmpeg-go-server/internal/core/editor/subtitles"
)

func TestNarrationTimingPassFeedsVisualsAndSurvivesRecovery(t *testing.T) {
	previousSpeech, previousTranscribe := generateSpeechCall, transcribeWindow
	previousImage, previousScene := generateImageCall, generateSceneCall
	t.Cleanup(func() {
		generateSpeechCall, transcribeWindow = previousSpeech, previousTranscribe
		generateImageCall, generateSceneCall = previousImage, previousScene
	})
	generateSpeechCall = func(context.Context, string, func(string) (string, error), speech.Request) (speech.GeneratedSpeech, error) {
		t.Fatal("an existing approved narration must not be synthesized again")
		return speech.GeneratedSpeech{}, nil
	}
	captionCalls := 0
	transcribeWindow = func(_ context.Context, _, file string, start, duration float64, language string) ([]subtitles.Cue, error) {
		captionCalls++
		if captionCalls != 1 || file != "voice.wav" || start != 0 || duration != 4 || language != "ro" {
			t.Fatalf("unexpected or repeated timing pass: %s %g %g %s", file, start, duration, language)
		}
		return measuredNarrationFixture(), nil
	}
	imageCalls, sceneCalls := 0, 0
	generateImageCall = func(_ context.Context, root string, _ func(string) (string, error), _, _, _, _ string) (imagegen.GeneratedImage, error) {
		imageCalls++
		if captionCalls != 1 || imageCalls != 1 {
			t.Fatal("image generated before captions or regenerated during recovery")
		}
		if err := os.WriteFile(filepath.Join(root, "woodland.png"), []byte("fixture"), 0600); err != nil {
			return imagegen.GeneratedImage{}, err
		}
		return imagegen.GeneratedImage{Name: "woodland.png", Width: 64, Height: 64}, nil
	}
	generateSceneCall = func(_ context.Context, _, _ string, request scenes.Request) (scenes.Scene, error) {
		sceneCalls++
		assertMeasuredNarrationRequest(t, request)
		if sceneCalls == 1 {
			return scenes.Scene{}, errors.New("temporary scene failure")
		}
		return scenes.Scene{Asset: document.Asset{ID: "scene", File: "scene.scene.json", Version: "fixture", Kind: "video", Duration: document.Seconds(1.8)}}, nil
	}

	root := t.TempDir()
	timing, err := CompileGenerated(context.Background(), narrationTimingFixture(), root, "")
	if err != nil || timing.Composition == nil || len(timing.Composition.TextItems) != 2 || imageCalls != 0 || sceneCalls != 0 {
		t.Fatalf("audio/caption timing pass failed or generated visuals: %+v, %v", timing, err)
	}
	visualInput := addNarrationVisualFixture(t, compiler.Input{Document: *timing.Document, Assets: timing.Composition.Assets})
	failed, err := CompileGenerated(context.Background(), visualInput, root, "")
	if err == nil || failed.Recovery == nil || len(failed.Recovery.Assets) != 2 {
		t.Fatalf("visual failure lost resolved timing/image recovery: %+v, %v", failed, err)
	}
	recovery := failed.Recovery
	resolved, err := CompileGenerated(context.Background(), compiler.Input{Document: recovery.Document, Assets: recovery.Assets, Bindings: recovery.Bindings}, root, "")
	if err != nil || resolved.Composition == nil || resolved.Composition.Duration != 5*document.Second {
		t.Fatalf("visual pass could not reuse the timing result: %+v, %v", resolved, err)
	}
	if captionCalls != 1 || imageCalls != 1 || sceneCalls != 2 || len(resolved.Composition.TextItems) != 2 {
		t.Fatalf("recovery repeated successful provider work: captions=%d images=%d scenes=%d", captionCalls, imageCalls, sceneCalls)
	}
	replayed, err := CompileGenerated(context.Background(), compiler.Input{Document: *resolved.Document, Assets: resolved.Composition.Assets}, root, "")
	if err != nil || replayed.Composition == nil || replayed.Composition.ID != resolved.Composition.ID || captionCalls != 1 || imageCalls != 1 || sceneCalls != 2 {
		t.Fatalf("replaying the resolved visual pass repeated work or changed timing: %+v, %v", replayed, err)
	}
}

func narrationTimingFixture() compiler.Input {
	return compiler.Input{Document: document.Document{Version: 2, Mode: "assemble",
		Before:     []document.Job{{ID: "voice", Type: "speech.generate", Text: "Codrul și lacul. Lumina lunii.", Language: "ro", ResultAssetID: "voice.wav"}},
		Placements: []document.Placement{{Job: "voice", Track: document.PlacementTrack{Type: "audio", Role: "narration"}, Start: document.Second}},
		After:      []document.Job{{ID: "captions", Type: "captions.generate", Language: "ro", MaxWords: 3}},
	}, Assets: []document.Asset{{ID: "voice.wav", File: "voice.wav", Version: "fixture", Kind: "audio", Duration: 4 * document.Second, HasAudio: true}}}
}

func measuredNarrationFixture() []subtitles.Cue {
	return []subtitles.Cue{
		{Start: 0.2, End: 1.6, Text: "Codrul și lacul.", Words: []subtitles.CueWord{
			{Text: "Codrul", Start: 0.2, End: 0.6}, {Text: "și", Start: 0.7, End: 0.9}, {Text: "lacul.", Start: 1, End: 1.6},
		}},
		{Start: 2.2, End: 3.5, Text: "Lumina lunii.", Words: []subtitles.CueWord{
			{Text: "Lumina", Start: 2.2, End: 2.6}, {Text: "lunii.", Start: 2.7, End: 3.5},
		}},
	}
}

func addNarrationVisualFixture(t *testing.T, input compiler.Input) compiler.Input {
	t.Helper()
	voice := input.Document.Tracks[0].Clips[0]
	start := input.Document.Texts[1].Start
	from := start - voice.Start
	duration := voice.OutPoint - from
	input.Document.Before = []document.Job{
		{ID: "art", Type: "image.generate", Prompt: "Woodland and lake"},
		{ID: "scene", Type: "scene.generate", Prompt: "Moonlight over the woodland", VisualMode: "3d", NarrationJob: "voice", NarrationFrom: from, Duration: duration,
			Images: []document.SceneImage{{ID: "image_1", Job: "art", Name: "Woodland"}}},
	}
	input.Document.Placements = []document.Placement{
		{Job: "art", Track: document.PlacementTrack{Type: "video", Role: "main"}, Start: voice.Start, Duration: from},
		{Job: "scene", Track: document.PlacementTrack{Type: "video", Role: "main"}, Start: start, Duration: duration},
	}
	return input
}

func assertMeasuredNarrationRequest(t *testing.T, request scenes.Request) {
	t.Helper()
	if request.VisualMode != "3d" || request.Language != "ro" || request.NarrationText != "Lumina lunii." || math.Abs(request.Duration-1.8) > 1e-6 {
		t.Fatalf("scene lost its measured narration window: %+v", request)
	}
	if len(request.NarrationCues) != 1 || math.Abs(request.NarrationCues[0].Start) > 1e-6 || math.Abs(request.NarrationCues[0].End-1.3) > 1e-6 {
		t.Fatalf("scene cues lost audio-placement offsets or cue-local timing: %+v", request.NarrationCues)
	}
	if !request.CaptionSafeArea || len(request.Images) != 1 || request.Images[0].File != "woodland.png" {
		t.Fatalf("scene lost caption safe area or generated image: %+v", request)
	}
}
