package render

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	textengine "ffmpeg-go-server/editengine/text"
)

func TestCompositionCatalogMatchesRenderer(t *testing.T) {
	registry := compiler.New().Catalog
	if len(registry.Effects) != len(EffectCatalog()) || len(registry.Transitions) != len(xfadeNames) {
		t.Fatal("compiler and renderer catalogs diverged")
	}
	for _, effect := range registry.Effects {
		params, err := registry.ResolveEffect(effect.ID, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateEffect(effect.ID, params); err != nil {
			t.Errorf("%s: %v", effect.ID, err)
		}
	}
	for _, transition := range registry.Transitions {
		if !xfadeNames[transition.Xfade] {
			t.Errorf("missing renderer transition %s", transition.ID)
		}
	}
}

func TestStagingRejectsChangedAssets(t *testing.T) {
	root, staging := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	err := stageVersionedAsset(root, staging, "clip.mp4", "sha256:"+strings.Repeat("0", 64))
	if err == nil || !strings.Contains(err.Error(), "version changed") {
		t.Fatalf("changed asset accepted: %v", err)
	}
}

func TestHeadlessCompositionRendersAndReusesMaterializedText(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("FFmpeg integration requires ffmpeg")
	}
	root := t.TempDir()
	assets := make([]document.Asset, 0, 4)
	for index, color := range []string{"red", "green", "blue"} {
		name := "shot" + strconv.Itoa(index) + ".mp4"
		commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c="+color+":s=320x180:r=30:d=6", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", filepath.Join(root, name))
		assets = append(assets, integrationAsset(t, root, name, "video", 6))
	}
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=13", "-y", filepath.Join(root, "music.wav"))
	assets = append(assets, integrationAsset(t, root, "music.wav", "audio", 13))
	parsed, err := document.Parse([]byte(`version: 1
mode: assemble
inputs:
  shots: {kind: video, multiple: true}
  music: {kind: audio}
sequence:
  use: shots
  each:
    take: {from: 1s, duration: 5s}
    source_audio: remove
    look: raw-story
  between: {preset: cross-dissolve, duration: 1s}
audio:
  - {id: music-track, use: music, start: 0s, from: 0s, fit: sequence, volume: 35}
texts:
  - id: title
    text: HEADLESS COMPOSITION
    start: 0s
    duration: 2s
    fontFamily: montserrat
    fontSize: 100
    fontWeight: 700
    x: 960
    y: 540
output: {resolution: 480p, fps: 30, format: mp4, quality: normal}
`))
	if err != nil {
		t.Fatal(err)
	}
	input := compiler.Input{Document: parsed.Document, Assets: assets, Bindings: document.Bindings{
		"shots": {"shot0.mp4", "shot1.mp4", "shot2.mp4"}, "music": {"music.wav"},
	}}
	engine := compiler.New()
	result := engine.Compile(input)
	if result.Composition == nil {
		t.Fatalf("compile failed: %+v", result)
	}
	input.PreparedText = &textengine.Prepared{Key: result.Composition.TextRenderKey, Overlays: []textengine.Overlay{integrationOverlay(t)}}
	result = engine.Compile(input)
	options := CompositionOptions{Root: root}
	output, err := RenderComposition(context.Background(), *result.Composition, options)
	if err != nil {
		t.Fatal(err)
	}
	assertMediaDuration(t, output.Path, 13)
	for index, at := range []string{"0.5", "6", "11"} {
		assertDominantFrame(t, output.Path, at, index)
	}
	assertTitlePixels(t, output.Path)
	input.Document = *result.Document
	shorter := document.Seconds(3)
	input.Document.Overrides = []document.Override{{Target: result.Composition.Tracks[0].Clips[0].ID, Duration: &shorter}}
	revised := engine.Compile(input)
	if revised.Composition == nil {
		t.Fatalf("recompile failed: %+v", revised)
	}
	before, err := json.Marshal(result.Composition.TextItems)
	if err != nil {
		t.Fatal(err)
	}
	after, err := json.Marshal(revised.Composition.TextItems)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("rerender regenerated text")
	}
	second, err := RenderComposition(context.Background(), *revised.Composition, options)
	if err != nil {
		t.Fatal(err)
	}
	assertMediaDuration(t, second.Path, 11)
}

func integrationOverlay(t *testing.T) textengine.Overlay {
	t.Helper()
	canvas := image.NewNRGBA(image.Rect(0, 0, 160, 40))
	draw.Draw(canvas, image.Rect(4, 4, 156, 36), image.NewUniform(color.White), image.Point{}, draw.Src)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, canvas); err != nil {
		t.Fatal(err)
	}
	return textengine.Overlay{Start: 0, Duration: document.Seconds(2), X: 347, Y: 220, Image: base64.StdEncoding.EncodeToString(encoded.Bytes())}
}

func TestCompositionUsesTheExistingTextOverlayPayload(t *testing.T) {
	parsed, err := document.Parse([]byte("version: 1\nmode: assemble\ntexts:\n  - {id: title, text: Hello, start: 0s, duration: 2s}\noutput: {resolution: 480p}\n"))
	if err != nil {
		t.Fatal(err)
	}
	input := compiler.Input{Document: parsed.Document}
	result := compiler.New().Compile(input)
	if result.Composition == nil {
		t.Fatalf("compile: %+v", result)
	}
	if _, err := compositionRequest(*result.Composition); err == nil {
		t.Fatal("missing images were accepted")
	}
	overlay := integrationOverlay(t)
	input.PreparedText = &textengine.Prepared{Key: result.Composition.TextRenderKey, Overlays: []textengine.Overlay{overlay}}
	prepared := compiler.New().Compile(input)
	if prepared.Composition.ID != result.Composition.ID {
		t.Fatal("preparing images changed the composition identity")
	}
	request, err := compositionRequest(*prepared.Composition)
	if err != nil {
		t.Fatal(err)
	}
	if len(request.TextItems) != 1 || request.TextItems[0].Image != overlay.Image || request.TextItems[0].X != overlay.X || request.TextItems[0].Duration != 2 {
		t.Fatalf("prepared overlay changed: %+v", request.TextItems)
	}
	if _, err := prepareRenderPlan(request, fileScope{root: t.TempDir()}); err != nil {
		t.Fatalf("existing FFmpeg pipeline rejected prepared text: %v", err)
	}
}

func integrationAsset(t *testing.T, root, name, kind string, duration float64) document.Asset {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, name))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	return document.Asset{ID: name, File: name, Kind: kind, Duration: document.Seconds(duration), Version: "sha256:" + hex.EncodeToString(sum[:]), HasAudio: kind == "audio"}
}

func commandOutput(t *testing.T, program string, args ...string) []byte {
	t.Helper()
	output, err := exec.Command(program, args...).Output()
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			t.Fatalf("%s: %v\n%s", program, err, exit.Stderr)
		}
		t.Fatal(err)
	}
	return output
}

func assertMediaDuration(t *testing.T, file string, expected float64) {
	t.Helper()
	assertMediaDurationWithStreams(t, file, expected, 2)
}

func assertMediaDurationWithStreams(t *testing.T, file string, expected float64, streamCount int) {
	t.Helper()
	output := commandOutput(t, "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file)
	var metadata struct {
		Streams []struct {
			Type string `json:"codec_type"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(output, &metadata); err != nil {
		t.Fatal(err)
	}
	duration, err := strconv.ParseFloat(metadata.Format.Duration, 64)
	if err != nil {
		t.Fatal(err)
	}
	if duration < expected-0.04 || duration > expected+0.04 || len(metadata.Streams) != streamCount {
		t.Fatalf("expected %d streams, %gs: %s", streamCount, expected, output)
	}
}

func framePNG(t *testing.T, file, at string) []byte {
	return commandOutput(t, "ffmpeg", "-v", "error", "-ss", at, "-i", file, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-")
}

func assertDominantFrame(t *testing.T, file, at string, channel int) {
	t.Helper()
	frame, err := png.Decode(bytes.NewReader(framePNG(t, file, at)))
	if err != nil {
		t.Fatal(err)
	}
	r, g, b, _ := frame.At(50, 50).RGBA()
	values := []uint32{r, g, b}
	if values[channel] < 20000 || values[channel] < values[(channel+1)%3]*2 || values[channel] < values[(channel+2)%3]*2 {
		t.Fatalf("unexpected representative frame at %s: %d %d %d", at, r, g, b)
	}
}

func assertTitlePixels(t *testing.T, file string) {
	t.Helper()
	frame, err := png.Decode(bytes.NewReader(framePNG(t, file, "0.5")))
	if err != nil {
		t.Fatal(err)
	}
	white := 0
	for y := 180; y < 300; y++ {
		for x := 80; x < 774; x++ {
			r, g, b, _ := frame.At(x, y).RGBA()
			if r > 50000 && g > 50000 && b > 50000 {
				white++
			}
		}
	}
	if white < 100 {
		t.Fatalf("server-side title is missing: %d white pixels", white)
	}
}
