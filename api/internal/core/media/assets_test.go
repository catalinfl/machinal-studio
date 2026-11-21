package media

import (
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"ffmpeg-go-server/internal/platform/mediacache"

	"github.com/gofiber/fiber/v2"
)

func assetApp(t *testing.T, name string, run mediacache.Runner) (*fiber.App, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, name), []byte("media"), 0600); err != nil {
		t.Fatal(err)
	}
	cache := &mediacache.Cache{}
	app := fiber.New()
	app.Get("/media-metadata", func(c *fiber.Ctx) error { return serveMetadata(c, root, cache, run) })
	app.Get("/thumbnail", func(c *fiber.Ctx) error { return serveThumbnail(c, root, cache, run) })
	return app, root
}

func assetRequest(t *testing.T, app *fiber.App, path, etag string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	if etag != "" {
		request.Header.Set("If-None-Match", etag)
	}
	response, err := app.Test(request, 5000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func writeTestJPEG(path string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	err = jpeg.Encode(file, image.NewRGBA(image.Rect(0, 0, 320, 180)), nil)
	closeErr := file.Close()
	return errors.Join(err, closeErr)
}

func TestParseMetadata(t *testing.T) {
	for _, test := range []struct {
		name  string
		data  string
		image bool
		want  Metadata
		fail  bool
	}{
		{name: "video", data: `{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"pix_fmt":"yuv420p"}],"format":{"duration":"12.5","format_name":"mov,mp4,m4a,3gp,3g2,mj2"}}`, want: Metadata{Duration: 12.5, Width: 1920, Height: 1080, VideoCodec: "h264", PixFmt: "yuv420p", FormatName: "mov,mp4,m4a,3gp,3g2,mj2"}},
		{name: "audio with cover", data: `{"streams":[{"codec_type":"video","width":500,"height":500,"disposition":{"attached_pic":1}},{"codec_type":"audio","codec_name":"aac","duration":"80"}]}`, want: Metadata{Duration: 80, AudioCodec: "aac"}},
		{name: "image", image: true, data: `{"streams":[{"codec_type":"video","width":800,"height":600}],"format":{"format_name":"png_pipe"}}`, want: Metadata{Width: 800, Height: 600, FormatName: "png_pipe"}},
		{name: "rotated", data: `{"streams":[{"codec_type":"video","codec_name":"hevc","width":1920,"height":1080,"duration":"60","side_data_list":[{"rotation":-90}]}]}`, want: Metadata{Duration: 60, Width: 1080, Height: 1920, VideoCodec: "hevc"}},
		{name: "longest stream", data: `{"streams":[{"codec_type":"video","width":320,"height":180,"duration":"61"}],"format":{"duration":"59"}}`, want: Metadata{Duration: 61, Width: 320, Height: 180}},
		{name: "unknown duration", data: `{"streams":[{"codec_type":"video","width":320,"height":180}],"format":{"duration":"N/A"}}`, fail: true},
		{name: "nonfinite", data: `{"streams":[{"codec_type":"audio"}],"format":{"duration":"NaN"}}`, fail: true},
		{name: "invalid dimensions", data: `{"streams":[{"codec_type":"video","width":0,"height":0}],"format":{"duration":"10"}}`, fail: true},
		{name: "renamed movie", image: true, data: `{"streams":[{"codec_type":"video","width":320,"height":180}],"format":{"duration":"120","format_name":"mov,mp4,m4a,3gp,3g2,mj2"}}`, fail: true},
		{name: "empty", data: `{}`, fail: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseMetadata([]byte(test.data), test.image)
			if (err != nil) != test.fail || (!test.fail && got != test.want) {
				t.Fatalf("metadata = %+v, err = %v, want %+v, fail %v", got, err, test.want, test.fail)
			}
		})
	}
}

func TestMetadataCacheReplacementAndMissingSource(t *testing.T) {
	var calls atomic.Int32
	app, root := assetApp(t, "clip.mp4", func(ctx context.Context, program string, args ...string) ([]byte, error) {
		calls.Add(1)
		if _, ok := ctx.Deadline(); !ok || program != "ffprobe" {
			return nil, errors.New("expected bounded ffprobe")
		}
		return []byte(`{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"duration":"10"}}`), nil
	})
	response := assetRequest(t, app, "/media-metadata?file=clip.mp4", "")
	var metadata Metadata
	if err := json.NewDecoder(response.Body).Decode(&metadata); err != nil || metadata != (Metadata{Duration: 10, Width: 640, Height: 360}) {
		t.Fatalf("response = %+v, err = %v", metadata, err)
	}
	etag := response.Header.Get("ETag")
	if response.StatusCode != 200 || etag == "" || response.Header.Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("unexpected response: %d %v", response.StatusCode, response.Header)
	}
	response = assetRequest(t, app, "/media-metadata?file=clip.mp4", `W/`+etag)
	if response.StatusCode != 304 || calls.Load() != 1 {
		t.Fatalf("cache hit status = %d, probes = %d", response.StatusCode, calls.Load())
	}
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), []byte("replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	response = assetRequest(t, app, "/media-metadata?file=clip.mp4", etag)
	if response.StatusCode != 200 || calls.Load() != 2 || response.Header.Get("ETag") == etag {
		t.Fatalf("replacement status = %d, probes = %d", response.StatusCode, calls.Load())
	}
	if err := os.Remove(filepath.Join(root, "clip.mp4")); err != nil {
		t.Fatal(err)
	}
	response = assetRequest(t, app, "/media-metadata?file=clip.mp4", "*")
	if response.StatusCode != 404 || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("missing source served stale: %d %v", response.StatusCode, response.Header)
	}
}

func TestThumbnailLongVideosAndImages(t *testing.T) {
	for _, test := range []struct {
		name   string
		file   string
		probe  string
		status int
	}{
		{name: "exactly sixty", file: "clip.mp4", probe: `{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"duration":"60"}}`, status: 200},
		{name: "over sixty", file: "clip.mp4", probe: `{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"duration":"60.001"}}`, status: 200},
		{name: "long video", file: "clip.mp4", probe: `{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"duration":"3600"}}`, status: 200},
		{name: "unknown duration", file: "clip.mp4", probe: `{"streams":[{"codec_type":"video","width":640,"height":360}]}`, status: 422},
		{name: "audio", file: "clip.mp3", probe: `{"streams":[{"codec_type":"audio"}],"format":{"duration":"10"}}`, status: 415},
		{name: "image", file: "clip.png", probe: `{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"format_name":"png_pipe"}}`, status: 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			var probes, encodes atomic.Int32
			app, _ := assetApp(t, test.file, func(ctx context.Context, program string, args ...string) ([]byte, error) {
				if _, ok := ctx.Deadline(); !ok {
					return nil, errors.New("process has no deadline")
				}
				if program == "ffprobe" {
					probes.Add(1)
					return []byte(test.probe), nil
				}
				encodes.Add(1)
				arguments := strings.Join(args, " ")
				if !strings.Contains(arguments, "-frames:v 1") || !strings.Contains(arguments, thumbnailFilter) || !strings.Contains(arguments, "-f image2") {
					return nil, errors.New("not a bounded single-frame JPEG encode")
				}
				return nil, writeTestJPEG(args[len(args)-1])
			})
			path := "/thumbnail?file=" + test.file
			response := assetRequest(t, app, path, "")
			if response.StatusCode != test.status {
				body, _ := io.ReadAll(response.Body)
				t.Fatalf("status = %d, want %d: %s", response.StatusCode, test.status, body)
			}
			if test.status != 200 {
				if encodes.Load() != 0 || response.Header.Get("Cache-Control") != "no-store" {
					t.Fatalf("rejected request encoded or cached: %d %v", encodes.Load(), response.Header)
				}
				return
			}
			if response.Header.Get("Content-Type") != "image/jpeg" {
				t.Fatalf("content type = %s", response.Header.Get("Content-Type"))
			}
			if _, err := jpeg.Decode(response.Body); err != nil {
				t.Fatal(err)
			}
			response = assetRequest(t, app, path, response.Header.Get("ETag"))
			if response.StatusCode != 304 || encodes.Load() != 1 || probes.Load() != 1 {
				t.Fatalf("cache hit: status %d, encodes %d, probes %d", response.StatusCode, encodes.Load(), probes.Load())
			}
		})
	}
}

func TestAssetValidationAndRetry(t *testing.T) {
	var calls atomic.Int32
	app, _ := assetApp(t, "clip.mp4", func(context.Context, string, ...string) ([]byte, error) {
		if calls.Add(1) == 1 {
			return nil, context.DeadlineExceeded
		}
		return []byte(`{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"duration":"10"}}`), nil
	})
	for _, endpoint := range []string{"/media-metadata", "/thumbnail"} {
		for _, name := range []string{"", "../clip.mp4", ".media-cache", "clip.mp4:stream.mp4", "bad.txt"} {
			response := assetRequest(t, app, endpoint+"?file="+url.QueryEscape(name), "")
			if response.StatusCode != 400 && response.StatusCode != 415 {
				t.Fatalf("invalid file %q: %d", name, response.StatusCode)
			}
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid requests started a process")
	}
	response := assetRequest(t, app, "/media-metadata?file=clip.mp4", "")
	if response.StatusCode != 504 || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("timeout response: %d %v", response.StatusCode, response.Header)
	}
	response = assetRequest(t, app, "/media-metadata?file=clip.mp4", "")
	if response.StatusCode != 200 || calls.Load() != 2 {
		t.Fatalf("retry: %d, calls %d", response.StatusCode, calls.Load())
	}
}

func TestListExcludesCacheAndPreservesSyntax(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "clip final.mp4"), []byte("media"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, mediacache.Directory), 0700); err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Get("/list", func(c *fiber.Ctx) error { return serveList(c, root) })
	response := assetRequest(t, app, "/list", "")
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 200 || string(body) != "clip final.mp4\t5 bytes\n" {
		t.Fatalf("list: %d %q %v", response.StatusCode, body, err)
	}
}
