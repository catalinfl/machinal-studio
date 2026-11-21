package render

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTextLayerKeepsFrameBoundariesAndFallsBackForUnsupportedMotion(t *testing.T) {
	raster := captionTestRaster(t, color.NRGBA{R: 255, A: 128})
	items := []textItem{
		{Start: 0.3, Duration: 0.2, X: 25, Y: 83, data: raster},
		{Start: 0.12, Duration: 0.18, X: 21, Y: 81, data: raster},
	}
	layer, ok := planTextLayer(items, 128, 128, 30, 30)
	if !ok || layer.bounds != image.Rect(20, 80, 56, 114) {
		t.Fatalf("unexpected layer: %+v", layer)
	}
	if first, second := layer.spans[0], layer.spans[1]; first.start != 4 || first.end != 9 || second.start != 9 || second.end != 15 {
		t.Fatalf("unexpected frame intervals: %+v", layer.spans)
	}
	file, err := writeTextLayer(context.Background(), t.TempDir(), layer, items, 30, 30)
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"file caption_blank.png\noption framerate 30\nduration 0.133333\n",
		"file caption_1.png\noption framerate 30\nduration 0.166667\n",
		"file caption_0.png\noption framerate 30\nduration 0.200000\n",
	} {
		if !strings.Contains(string(manifest), expected) {
			t.Fatalf("missing %q in %s", expected, manifest)
		}
	}
	items[0].Animation = "slide-left"
	if _, ok := planTextLayer(items, 128, 128, 30, 30); ok {
		t.Fatal("moving overlay should retain the existing rendition path")
	}
	items[0].Animation, items[0].Start = "", 0.2
	if _, ok := planTextLayer(items, 128, 128, 30, 30); ok {
		t.Fatal("overlapping overlays should retain interactive layering")
	}
}

func TestPlanFusedTextInputsKeepsTitleOrderAndBoundsFallback(t *testing.T) {
	raster := captionTestRaster(t, color.NRGBA{R: 255, A: 128})
	items := make([]textItem, 33)
	for index := range items {
		items[index] = textItem{Start: float64(index), Duration: 1, X: 10, Y: 50, data: raster}
	}
	short, ok := planFusedTextInputs(items[:16], 128, 96, 30, 16*30)
	if !ok || len(short) != 1 || len(short[0].layer.spans) != 16 {
		t.Fatal("sequential captions should use one input even below the ordinary overlay limit")
	}
	// Keep an independently moving title between two static runs in draw order.
	items[16].Start, items[16].Duration, items[16].Animation = 0, 33, "rise"
	inputs, ok := planFusedTextInputs(items, 128, 96, 30, 33*30)
	if !ok || len(inputs) != 3 {
		t.Fatalf("expected two packed runs and the title, got %d inputs (eligible=%t)", len(inputs), ok)
	}
	want := []struct{ index, spans int }{{0, 16}, {16, 0}, {17, 16}}
	for index, input := range inputs {
		if input.index != want[index].index || len(input.layer.spans) != want[index].spans {
			t.Fatalf("input %d lost order or spans: %+v", index, input)
		}
	}
	for index := range items {
		items[index].Animation = "rise"
	}
	if _, ok := planFusedTextInputs(items, 128, 96, 30, 33*30); ok {
		t.Fatal("too many uncompressed overlays should use the staged renderer")
	}
}

func TestNativeCaptionLayerMatchesStagedExport(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for native caption layer regression")
	}
	cases := []struct {
		name      string
		fps       int
		withTitle bool
		blackBase bool
	}{
		{name: "24fps", fps: 24},
		{name: "30fps-with-title", fps: 30, withTitle: true},
		{name: "60fps-black-base", fps: 60, blackBase: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fps := tc.fps
			const width, height, seconds = 128, 96, 3
			root := t.TempDir()
			rate := fmt.Sprintf("color=c=gray:s=%dx%d:r=%d:d=%d", width, height, fps, seconds)
			commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", rate, "-c:v", "libx264", "-threads", "2", filepath.Join(root, "shot.mp4"))
			commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", filepath.Join(root, "voice.wav"))
			req := renderRequest{FPS: fps, Format: "mp4", Quality: "high",
				VideoChannels: []channel{{Clips: []clip{{File: "shot.mp4", InPoint: 0, OutPoint: seconds}}}},
				AudioChannels: []channel{{Clips: []clip{{File: "voice.wav", InPoint: 0, OutPoint: seconds}}}},
			}
			if tc.blackBase {
				req.VideoChannels = nil
			}
			req.Resolution.W, req.Resolution.H = width, height
			red := sizedCaptionRaster(t, image.Rect(0, 0, 33, 35), color.NRGBA{R: 255, A: 128})
			blue := sizedCaptionRaster(t, image.Rect(0, 0, 32, 32), color.NRGBA{B: 255, A: 128})
			for i := 1; i < seconds*fps-1; i++ {
				if i%7 == 0 {
					continue
				}
				pixels := red
				if i%2 == 0 {
					pixels = blue
				}
				req.TextItems = append(req.TextItems, textItem{Start: float64(i)/float64(fps) - 0.0001,
					Duration: 1 / float64(fps), X: 11 + 2*(i%3), Y: 39, Image: base64.StdEncoding.EncodeToString(pixels)})
			}
			if tc.withTitle {
				title := sizedCaptionRaster(t, image.Rect(0, 0, 32, 32), color.NRGBA{G: 255, A: 128})
				req.TextItems = append(req.TextItems, textItem{Start: 0.5, Duration: 2, X: 20, Y: 42,
					Animation: "rise", AnimationDuration: 0.25, Image: base64.StdEncoding.EncodeToString(title)})
			}
			plan, err := prepareRenderPlan(req, fileScope{root: root})
			if err != nil {
				t.Fatal(err)
			}
			legacyWork := t.TempDir()
			started := time.Now()
			video, audio, err := renderTracks(req, plan, legacyWork, nil)
			if err != nil {
				t.Fatal(err)
			}
			staged := filepath.Join(root, "staged.mp4")
			if err := writeRenderOutput(plan, video, audio, staged, nil); err != nil {
				t.Fatal(err)
			}
			stagedTime := time.Since(started)

			fast := filepath.Join(root, "fast.mp4")
			started = time.Now()
			handled, err := renderFusedOutput(req, plan, t.TempDir(), fast, nil)
			if err != nil || !handled {
				t.Fatalf("caption layer was not used: handled=%t, err=%v", handled, err)
			}
			t.Logf("already prepared captions, %d rasters: staged=%s layer=%s", len(req.TextItems), stagedTime, time.Since(started))
			decode := func(path, stream, format string, flags ...string) []byte {
				args := []string{"-v", "error", "-i", path, "-map", stream, "-threads", "1"}
				args = append(args, flags...)
				return commandOutput(t, "ffmpeg", append(args, "-f", format, "pipe:1")...)
			}
			old, got := decode(staged, "0:v:0", "rawvideo", "-pix_fmt", "yuv420p"), decode(fast, "0:v:0", "rawvideo", "-pix_fmt", "yuv420p")
			if len(got) != width*height*3/2*fps*seconds || len(old) != len(got) {
				t.Fatalf("frame count changed: staged=%d fast=%d bytes", len(old), len(got))
			}
			if !bytes.Equal(old, got) {
				assertCaptionLayerPixels(t, old, got, width, height)
			}
			if !bytes.Equal(decode(staged, "0:a:0", "s16le"), decode(fast, "0:a:0", "s16le")) {
				t.Fatal("encoded audio changed")
			}
		})
	}
}

func sizedCaptionRaster(t *testing.T, bounds image.Rectangle, fill color.NRGBA) []byte {
	t.Helper()
	raster := image.NewNRGBA(bounds)
	draw.Draw(raster, bounds, image.NewUniform(fill), image.Point{}, draw.Src)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, raster); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func assertCaptionLayerPixels(t *testing.T, old, got []byte, width, height int) {
	t.Helper()
	frameBytes := width * height * 3 / 2
	var squared int64
	for index, pixel := range old {
		diff := int(got[index]) - int(pixel)
		squared += int64(diff * diff)
	}
	if float64(squared)/float64(len(old)) > 2 {
		t.Errorf("video differs beyond delivery codec tolerance: MSE=%.3f", float64(squared)/float64(len(old)))
	}
	// Check each frame inside the caption, in luma and both chroma planes.
	for frame := range len(old) / frameBytes {
		base := frame * frameBytes
		for _, point := range []int{
			50*width + 22,
			width*height + 25*(width/2) + 11,
			width*height*5/4 + 25*(width/2) + 11,
		} {
			diff := int(got[base+point]) - int(old[base+point])
			if diff < -6 || diff > 6 {
				t.Fatalf("caption state or timing changed at frame %d offset %d: staged=%d fast=%d", frame, point, old[base+point], got[base+point])
			}
		}
	}
}
