package media

import (
	"context"
	"encoding/json"
	"image/jpeg"
	"io"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/mediacache"

	"github.com/gofiber/fiber/v2"
)

func TestAssetsWithFFmpeg(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe is not installed")
	}
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	for _, fixture := range []struct {
		name string
		args []string
	}{
		{"short.webm", []string{"-f", "lavfi", "-i", "color=s=640x360:r=2", "-t", "1", "-c:v", "libvpx-vp9"}},
		{"long.mp4", []string{"-f", "lavfi", "-i", "color=s=32x32:r=1", "-t", "61", "-c:v", "libx264"}},
		{"sound.wav", []string{"-f", "lavfi", "-i", "sine=duration=1"}},
		{"still.png", []string{"-f", "lavfi", "-i", "color=s=100x600", "-frames:v", "1", "-update", "1"}},
		{"still.jpg", []string{"-f", "lavfi", "-i", "color=s=640x360", "-frames:v", "1", "-update", "1"}},
		{"still.webp", []string{"-f", "lavfi", "-i", "color=s=640x360", "-frames:v", "1"}},
		{"still.gif", []string{"-f", "lavfi", "-i", "color=s=640x360", "-frames:v", "1"}},
		{"still.bmp", []string{"-f", "lavfi", "-i", "color=s=640x360", "-frames:v", "1", "-update", "1"}},
	} {
		args := append([]string{"-nostdin", "-v", "error", "-y", "-filter_threads", "1"}, fixture.args...)
		args = append(args, "-threads", "1", filepath.Join(root, fixture.name))
		if _, err := mediacache.Run(ctx, "ffmpeg", args...); err != nil {
			t.Fatal(err)
		}
	}
	cache := &mediacache.Cache{}
	app := fiber.New()
	app.Get("/media-metadata", func(c *fiber.Ctx) error { return serveMetadata(c, root, cache, mediacache.Run) })
	app.Get("/thumbnail", func(c *fiber.Ctx) error { return serveThumbnail(c, root, cache, mediacache.Run) })
	for _, name := range []string{"short.webm", "long.mp4", "sound.wav", "still.png", "still.jpg", "still.webp", "still.gif", "still.bmp"} {
		t.Run(name, func(t *testing.T) {
			response := assetRequest(t, app, "/media-metadata?file="+name, "")
			if response.StatusCode != 200 {
				body, _ := io.ReadAll(response.Body)
				t.Fatalf("metadata status %d: %s", response.StatusCode, body)
			}
			var metadata Metadata
			if err := json.NewDecoder(response.Body).Decode(&metadata); err != nil {
				t.Fatal(err)
			}
			if !metadata.valid(isImage(name)) {
				t.Fatalf("invalid metadata: %+v", metadata)
			}
			response = assetRequest(t, app, "/thumbnail?file="+name, "")
			status := 200
			if name == "long.mp4" {
				status = 422
			}
			if name == "sound.wav" {
				status = 415
			}
			if response.StatusCode != status {
				body, _ := io.ReadAll(response.Body)
				t.Fatalf("thumbnail status %d, want %d: %s", response.StatusCode, status, body)
			}
			if status == 200 {
				thumbnail, err := jpeg.Decode(response.Body)
				if err != nil {
					t.Fatal(err)
				}
				if thumbnail.Bounds().Dx() > 320 || thumbnail.Bounds().Dy() > 320 {
					t.Fatalf("oversized thumbnail: %v", thumbnail.Bounds())
				}
			}
		})
	}
}
