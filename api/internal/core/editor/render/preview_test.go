package render

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	textengine "ffmpeg-go-server/editengine/text"
)

func TestPreviewWindowValidationAndContext(t *testing.T) {
	for _, window := range []PreviewWindow{{-1, 1}, {0, 0}, {0, 16}, {math.NaN(), 1}, {0, math.Inf(1)}, {100000, 1}} {
		if window.Validate() == nil {
			t.Fatal("invalid window accepted", window)
		}
	}
	window := PreviewWindow{Start: 2.5, Duration: 1}
	ctx := WithPreviewWindow(context.Background(), window)
	if got, ok := PreviewFromContext(ctx); !ok || got != window {
		t.Fatal(got, ok)
	}
	if err := validatePreviewComposition(ctx, 3, "mp4"); err == nil {
		t.Fatal("interval outside timeline accepted")
	}
	if err := validatePreviewComposition(ctx, 4, "mp3"); err == nil {
		t.Fatal("audio-only preview accepted")
	}
}

func TestPreviewExcerptsOnlyAfterVideoCompositingAndAudioMixing(t *testing.T) {
	output, err := parseOutputSettings("mp4", "high")
	if err != nil {
		t.Fatal(err)
	}
	args := previewEncodingArgs(PreviewWindow{2.5, 1}, "composited.mp4", "mixed.w64", "preview.mp4", output)
	if !reflect.DeepEqual(args[:12], []string{"-i", "composited.mp4", "-i", "mixed.w64", "-ss", "2.5", "-t", "1", "-map", "0:v:0", "-map", "1:a:0"}) {
		t.Fatal("preview must seek final mixed/composited inputs together", args)
	}
	if !slices.Contains(args, "+faststart") || !slices.Contains(args, "aac") {
		t.Fatal("preview lost streaming/audio encoding", args)
	}
}

func TestNativePreviewContainsCorrectTimelinePixelsAndMixedAudio(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for native final-composition excerpt verification")
	}
	root := t.TempDir()
	video, audio, out := filepath.Join(root, "composited.mp4"), filepath.Join(root, "mixed.w64"), filepath.Join(root, "preview.mp4")
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=128x72:r=10:d=1", "-f", "lavfi", "-i", "color=c=blue:s=128x72:r=10:d=1", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-threads", "2", video)
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audio)
	output, err := parseOutputSettings("mp4", "normal")
	if err != nil {
		t.Fatal(err)
	}
	window := PreviewWindow{Start: 1, Duration: 0.5}
	progress := newRenderProgress(1, nil)
	if err := writePreviewOutput(window, renderPlan{hasVideo: true, hasAudio: true, output: output}, video, audio, out, progress); err != nil {
		t.Fatal(err)
	}
	assertMediaDurationWithStreams(t, out, 0.5, 2)
	assertDominantFrame(t, out, "0.1", 2)
	assertPreviewAudioSignal(t, out)
}

func TestNativeCompositionPreviewPreservesPreparedCaptionAndNarration(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for full composition preview verification")
	}
	root := t.TempDir()
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=2", "-c:v", "libx264", "-threads", "2", filepath.Join(root, "shot.mp4"))
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", filepath.Join(root, "voice.wav"))
	parsed, err := document.Parse([]byte("version: 1\nmode: assemble\ninputs:\n  shot: {kind: video}\n  voice: {kind: audio}\nsequence:\n  use: shot\n  each:\n    take: {from: 0s, duration: 2s}\n    source_audio: remove\naudio:\n  - {id: narration, use: voice, start: 0s, from: 0s, fit: sequence, volume: 100}\ntexts:\n  - {id: caption, text: 'Știință', start: 1s, duration: 1s}\noutput: {resolution: 480p, fps: 30, format: mp4, quality: normal}\n"))
	if err != nil {
		t.Fatal(err)
	}
	input := compiler.Input{Document: parsed.Document, Assets: []document.Asset{integrationAsset(t, root, "shot.mp4", "video", 2), integrationAsset(t, root, "voice.wav", "audio", 2)}, Bindings: document.Bindings{"shot": {"shot.mp4"}, "voice": {"voice.wav"}}}
	engine := compiler.New()
	compiled := engine.Compile(input)
	if compiled.Composition == nil {
		t.Fatal(compiled)
	}
	overlay := integrationOverlay(t)
	overlay.Start, overlay.Duration = document.Seconds(1), document.Seconds(1)
	input.PreparedText = &textengine.Prepared{Key: compiled.Composition.TextRenderKey, Overlays: []textengine.Overlay{overlay}}
	compiled = engine.Compile(input)
	if compiled.Composition == nil {
		t.Fatal(compiled)
	}
	before, err := json.Marshal([]any{compiled.Document.Texts, compiled.Composition.TextItems})
	if err != nil {
		t.Fatal(err)
	}
	ctx := WithPreviewWindow(context.Background(), PreviewWindow{Start: 1, Duration: 1})
	output, err := RenderComposition(ctx, *compiled.Composition, CompositionOptions{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	assertMediaDurationWithStreams(t, output.Path, 1, 2)
	assertDominantFrame(t, output.Path, "0.1", 2)
	assertTitlePixels(t, output.Path)
	assertPreviewAudioSignal(t, output.Path)
	if compiled.Document.Texts[0].Text != "Știință" || compiled.Document.Texts[0].Start != document.Seconds(1) || compiled.Document.Texts[0].Duration != document.Seconds(1) {
		t.Fatal("preview rewrote caption data")
	}
	after, err := json.Marshal([]any{compiled.Document.Texts, compiled.Composition.TextItems})
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("preview mutated complete caption entries", err)
	}
}

func assertPreviewAudioSignal(t *testing.T, file string) {
	t.Helper()
	pcm := commandOutput(t, "ffmpeg", "-v", "error", "-i", file, "-map", "0:a:0", "-t", "0.3", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1")
	peak := 0
	for i := 0; i+1 < len(pcm); i += 2 {
		value := int(int16(binary.LittleEndian.Uint16(pcm[i : i+2])))
		if value < 0 {
			value = -value
		}
		peak = max(peak, value)
	}
	if peak < 500 {
		t.Fatal("preview lost the mixed audio signal", peak)
	}
}
