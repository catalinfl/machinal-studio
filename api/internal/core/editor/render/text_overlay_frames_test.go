package render

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestCaptionRasterFrameGatesAreExclusiveAcrossChunks(t *testing.T) {
	for _, fps := range []int{24, 25, 30, 60} {
		t.Run(fmt.Sprint(fps), func(t *testing.T) {
			const frames = 137
			items := make([]textItem, frames)
			for index := range items {
				start, end := float64(index)/float64(fps), float64(index+1)/float64(fps)
				items[index] = textItem{Start: start, Duration: end - start}
			}
			chunks := planTextOverlayChunks(items, fps, float64(frames)/float64(fps), 7)
			for _, chunk := range chunks {
				for frame := chunk.startFrame; frame < chunk.endFrame; frame++ {
					active := 0
					for _, index := range chunk.itemIndices {
						var start, end int
						expression := textOverlayFrameEnable(items[index], chunk, fps)
						if _, err := fmt.Sscanf(expression, "gte(n,%d)*lt(n,%d)", &start, &end); err != nil {
							t.Fatal(expression, err)
						}
						if local := frame - chunk.startFrame; local >= start && local < end {
							active++
						}
					}
					if active != 1 {
						t.Fatalf("frame %d has %d caption rasters, want exactly one", frame, active)
					}
				}
			}
		})
	}
}

func TestCaptionRasterFrameGatesPreserveOffGridIntervals(t *testing.T) {
	item := textItem{Start: 0.12, Duration: 1.18}
	start, end := textOverlayFrameRange(item, 30, 60)
	if start != 4 || end != 39 {
		t.Fatalf("cue frame range %d..%d, want 4..39", start, end)
	}
	chunk := textOverlayChunk{startFrame: 24, endFrame: 45}
	if expression := textOverlayFrameEnable(item, chunk, 30); expression != "gte(n,0)*lt(n,15)" {
		t.Fatal(expression)
	}
	if item.Start != 0.12 || item.Duration != 1.18 {
		t.Fatal("raster gating changed source caption timing", item)
	}
}

func TestFFmpegCaptionRasterFramesNeverBlinkAtChunkBoundaries(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for native caption frame regression")
	}
	work := t.TempDir()
	base := filepath.Join(work, "base.mp4")
	if output, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=30:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-threads", "1", "-y", base).CombinedOutput(); err != nil {
		t.Fatalf("create fixture: %v: %s", err, output)
	}
	rasters := [][]byte{captionTestRaster(t, color.NRGBA{R: 255, A: 128}), captionTestRaster(t, color.NRGBA{B: 255, A: 128})}
	items := make([]textItem, 60)
	for index := range items {
		start, end := float64(index)/30, float64(index+1)/30
		items[index] = textItem{Start: start, Duration: end - start, data: rasters[index%2]}
	}
	output, err := overlayTextItems(base, items, 64, 64, 30, 2, work, nil)
	if err != nil {
		t.Fatal(err)
	}
	frames, err := exec.Command("ffmpeg", "-v", "error", "-i", output, "-vf", "crop=2:2:10:10,format=rgb24", "-threads", "1", "-f", "rawvideo", "-").Output()
	if err != nil {
		t.Fatal(err)
	}
	const bytesPerFrame = 2 * 2 * 3
	if len(frames) != 60*bytesPerFrame {
		t.Fatalf("got %d decoded bytes, want %d", len(frames), 60*bytesPerFrame)
	}
	for frame := range 60 {
		red, blue := frames[frame*bytesPerFrame], frames[frame*bytesPerFrame+2]
		active, inactive := red, blue
		if frame%2 != 0 {
			active, inactive = blue, red
		}
		if active < 110 || active > 145 || inactive > 15 {
			t.Errorf("frame %d: red=%d blue=%d; caption raster is missing, duplicated or from the wrong frame", frame, red, blue)
		}
	}
}

func captionTestRaster(t *testing.T, fill color.NRGBA) []byte {
	t.Helper()
	raster := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for y := range 32 {
		for x := range 32 {
			raster.SetNRGBA(x, y, fill)
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, raster); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}
