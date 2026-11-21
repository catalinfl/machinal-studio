package compositions

import (
	"context"
	"errors"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/speech"
)

func TestCaptionedRenderRejectsMissingTextServiceBeforePaidGeneration(t *testing.T) {
	t.Setenv("SCENE_SERVICE_URL", "")
	previous := generateSpeechCall
	t.Cleanup(func() { generateSpeechCall = previous })
	calls := 0
	generateSpeechCall = func(_ context.Context, _ string, _ func(string) (string, error), _ speech.Request) (speech.GeneratedSpeech, error) {
		calls++
		return speech.GeneratedSpeech{}, errors.New("unexpected paid provider call")
	}
	input := compiler.Input{Document: document.Document{Version: 2, Mode: "assemble",
		Before:     []document.Job{{ID: "voice", Type: "speech.generate", Text: "Hello world"}},
		After:      []document.Job{{ID: "captions", Type: "captions.generate"}},
		Placements: []document.Placement{{Job: "voice", Track: document.PlacementTrack{Type: "audio", Role: "narration"}}},
	}}
	result, err := prepareAutomationRender(context.Background(), input, t.TempDir(), "")
	if calls != 0 || err == nil || !strings.Contains(err.Error(), "SCENE_SERVICE_URL") || result.Document == nil || result.Document.Before[0].ResultAssetID != "" {
		t.Fatalf("caption render was not rejected before generation: %+v, %v", result, err)
	}
	input.Document.Output.Format = "mp3"
	if needsTextService(input) {
		t.Fatal("audio-only export incorrectly requires a text renderer")
	}
}

func TestIncompatibleRomanianVoiceIsRejectedBeforeEarlierPaidImages(t *testing.T) {
	input := compiler.Input{Document: document.Document{Version: 2, Mode: "assemble", Before: []document.Job{
		{ID: "art", Type: "image.generate", Prompt: "A woodland"},
		{ID: "voice", Type: "speech.generate", Text: "În copilărie descoperă poezia.", Language: "ro", Model: "mistralai/voxtral-mini-tts-2603", Voice: "fr_marie_neutral"},
	}}}
	result, err := CompileGenerated(context.Background(), input, t.TempDir(), "")
	if err == nil || result.Recovery == nil || !strings.Contains(err.Error(), "does not support language ro") {
		t.Fatalf("incompatible speech was not rejected in preflight: %+v, %v", result, err)
	}
}
