package render

import (
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestVideoFitNativeAlphaComposition(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("FFmpeg integration requires ffmpeg")
	}
	root := t.TempDir()
	writeImage := func(name string, img image.Image) {
		t.Helper()
		file, err := os.Create(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		encodeErr := png.Encode(file, img)
		closeErr := file.Close()
		if encodeErr != nil || closeErr != nil {
			t.Fatalf("write fixture: encode=%v close=%v", encodeErr, closeErr)
		}
	}
	background := image.NewRGBA(image.Rect(0, 0, 90, 160))
	draw.Draw(background, background.Bounds(), image.NewUniform(color.RGBA{B: 255, A: 255}), image.Point{}, draw.Src)
	writeImage("background.png", background)
	bands := image.NewRGBA(image.Rect(0, 0, 320, 180))
	for index, shade := range []color.RGBA{{R: 255, A: 255}, {G: 255, A: 255}, {B: 255, A: 255}} {
		draw.Draw(bands, image.Rect(index*320/3, 0, (index+1)*320/3, 180), image.NewUniform(shade), image.Point{}, draw.Src)
	}
	writeImage("bands.png", bands)
	for _, fit := range []document.VideoFit{document.VideoFitContain, document.VideoFitCover} {
		t.Run(string(fit), func(t *testing.T) {
			opacity := 0.5
			request := renderRequest{Fit: fit, VideoChannels: []channel{
				{Clips: []clip{{File: "background.png", MediaKind: "image", OutPoint: 0.5}}},
				{Clips: []clip{{File: "bands.png", MediaKind: "image", OutPoint: 0.5, Opacity: &opacity}}},
			}}
			request.Resolution.W, request.Resolution.H = 90, 160
			work := filepath.Join(root, string(fit))
			if err := os.Mkdir(work, 0700); err != nil {
				t.Fatal(err)
			}
			output, err := buildVideo(request, 2, 10, 0.5, work, nil, fileScope{root: root})
			if err != nil {
				t.Fatal(err)
			}
			pixels := commandOutput(t, "ffmpeg", "-v", "error", "-i", output, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
			if len(pixels) != 90*160*3 {
				t.Fatalf("unexpected output geometry: %d bytes", len(pixels))
			}
			offset := (16*90 + 45) * 3
			r, g, b := pixels[offset], pixels[offset+1], pixels[offset+2]
			if fit == document.VideoFitCover {
				if r > 10 || g < 110 || g > 145 || b < 110 || b > 145 {
					t.Fatalf("fill did not crop/composite the green center at half opacity: rgb=%d,%d,%d", r, g, b)
				}
			} else if r > 10 || g > 10 || b < 240 {
				t.Fatalf("fit did not retain the blue background outside the image: rgb=%d,%d,%d", r, g, b)
			}
		})
	}
}
