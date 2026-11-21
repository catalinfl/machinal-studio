package scrub

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/mediacache"

	"github.com/gofiber/fiber/v2"
)

func TestProxyWithFFmpeg(t *testing.T) {
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
		{"clip.webm", []string{"-f", "lavfi", "-i", "color=s=128x72:r=6", "-t", "1", "-c:v", "libvpx-vp9"}},
		{"clip.mkv", []string{"-f", "lavfi", "-i", "color=s=128x72:r=6", "-f", "lavfi", "-i", "sine=duration=1", "-t", "1", "-c:v", "libx264", "-c:a", "aac"}},
		{"sound.wav", []string{"-f", "lavfi", "-i", "sine=duration=1"}},
		{"still.png", []string{"-f", "lavfi", "-i", "color=s=128x72", "-frames:v", "1", "-update", "1"}},
	} {
		args := append([]string{"-nostdin", "-v", "error", "-y", "-filter_threads", "1"}, fixture.args...)
		args = append(args, "-threads", "1", filepath.Join(root, fixture.name))
		if _, err := mediacache.Run(ctx, "ffmpeg", args...); err != nil {
			t.Fatal(err)
		}
	}
	cache := &mediacache.Cache{}
	app := fiber.New()
	app.Get("/scrub-proxy", func(c *fiber.Ctx) error { return serveProxy(c, root, cache, mediacache.Run) })
	for _, name := range []string{"clip.webm", "clip.mkv", "sound.wav", "still.png"} {
		t.Run(name, func(t *testing.T) {
			response, err := app.Test(httptest.NewRequest(http.MethodGet, "/scrub-proxy?file="+name, nil), 30000)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil || response.StatusCode != 200 {
				t.Fatalf("proxy status %d: %s, %v", response.StatusCode, body, err)
			}
			if response.Header.Get("Content-Type") != "video/mp4" {
				t.Fatalf("content type: %s", response.Header.Get("Content-Type"))
			}
			path := filepath.Join(t.TempDir(), proxyOutputName(name, "landscape"))
			if err := os.WriteFile(path, body, 0600); err != nil {
				t.Fatal(err)
			}
			data, err := mediacache.Run(ctx, "ffprobe", "-v", "error", "-show_entries", "format=format_name:stream=codec_name,width,height", "-of", "json", path)
			if err != nil {
				t.Fatal(err)
			}
			var probe struct {
				Format struct {
					Name string `json:"format_name"`
				} `json:"format"`
				Streams []struct {
					Codec  string `json:"codec_name"`
					Width  int    `json:"width"`
					Height int    `json:"height"`
				} `json:"streams"`
			}
			if err := json.Unmarshal(data, &probe); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(probe.Format.Name, "mp4") || len(probe.Streams) == 0 {
				t.Fatalf("invalid MP4: %s", data)
			}
			for _, stream := range probe.Streams {
				if stream.Codec != "h264" && stream.Codec != "aac" {
					t.Fatalf("unexpected codec: %s", data)
				}
				if stream.Codec == "h264" && stream.Width != previewLongEdge {
					t.Fatalf("wrong preview dimensions: %s", data)
				}
			}
		})
	}
}
