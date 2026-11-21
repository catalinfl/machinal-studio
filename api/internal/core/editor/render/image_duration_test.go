package render

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestImageOverlayOutlastsUnderlyingVideo(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("FFmpeg integration requires ffmpeg")
	}
	root := t.TempDir()
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=96x64:r=30:d=8", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", filepath.Join(root, "scene.mp4"))
	canvas := image.NewNRGBA(image.Rect(0, 0, 96, 64))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.NRGBA{G: 255, A: 255}), image.Point{}, draw.Src)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, canvas); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "overlay.png"), encoded.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	transform := normalizeTransform(nil)
	transform.ZoomX, transform.ZoomY = 0.548297, 0.548297
	fadeIn, fadeOut := 0.5, 0.5
	req := renderRequest{FPS: 30, VideoChannels: []channel{
		{Clips: []clip{
			{File: "scene.mp4", InPoint: 0, OutPoint: 4.309, Start: 0},
			{File: "scene.mp4", InPoint: 4.309, OutPoint: 8, Start: 6.259},
		}},
		{Clips: []clip{
			{File: "overlay.png", MediaKind: "image", InPoint: 0, OutPoint: 4.309, Start: 0, Transform: &transform, FadeIn: &fadeIn},
			{File: "overlay.png", MediaKind: "image", InPoint: 4.309, OutPoint: 11.809, Start: 5.009, Transform: &transform, FadeOut: &fadeOut},
		}},
	}}
	req.Resolution.W, req.Resolution.H = 96, 64
	output, err := buildVideo(req, 4, 30, 12.509, root, nil, fileScope{root: root})
	if err != nil {
		t.Fatal(err)
	}
	for _, at := range []string{"1", "5.5", "7", "10.5", "11.8"} {
		frame, err := png.Decode(bytes.NewReader(framePNG(t, output, at)))
		if err != nil {
			t.Fatal(err)
		}
		r, g, b, _ := frame.At(48, 32).RGBA()
		if g < 50000 || r > 5000 || b > 5000 {
			t.Errorf("image overlay missing at %ss: rgb16=(%d,%d,%d)", at, r, g, b)
		}
	}
}

func TestVideoCompositeKeepsLongerImageAfterBaseStreamEnds(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("FFmpeg integration requires ffmpeg")
	}
	root := t.TempDir()
	files := []string{filepath.Join(root, "base.mp4"), filepath.Join(root, "image.mp4")}
	masks := []string{filepath.Join(root, "base-mask.mp4"), filepath.Join(root, "image-mask.mp4")}
	for index, fixture := range []struct {
		color    string
		duration string
	}{
		{color: "blue", duration: "1"},
		{color: "lime", duration: "3"},
	} {
		for _, source := range []struct{ color, path string }{
			{color: fixture.color, path: files[index]},
			{color: "white", path: masks[index]},
		} {
			commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c="+source.color+":s=96x64:r=30:d="+fixture.duration,
				"-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", source.path)
		}
	}
	channels := []channel{
		{Clips: []clip{{InPoint: 0, OutPoint: 1, Start: 0}}},
		{Clips: []clip{{MediaKind: "image", InPoint: 0, OutPoint: 3, Start: 0}}},
	}
	output, err := compositeVideoChannels(files, masks, channels, 96, 64, 30, 4, root, nil)
	if err != nil {
		t.Fatal(err)
	}
	frame, err := png.Decode(bytes.NewReader(framePNG(t, output, "2.5")))
	if err != nil {
		t.Fatalf("longer image was truncated when the base stream ended: %v", err)
	}
	r, g, b, _ := frame.At(48, 32).RGBA()
	if g < 50000 || r > 5000 || b > 5000 {
		t.Fatalf("image overlay missing after base EOF: rgb16=(%d,%d,%d)", r, g, b)
	}
	frame, err = png.Decode(bytes.NewReader(framePNG(t, output, "3.5")))
	if err != nil {
		t.Fatalf("composition did not preserve its trailing gap: %v", err)
	}
	r, g, b, _ = frame.At(48, 32).RGBA()
	if r > 5000 || g > 5000 || b > 5000 {
		t.Fatalf("ended layers were frozen instead of cleared: rgb16=(%d,%d,%d)", r, g, b)
	}
}
