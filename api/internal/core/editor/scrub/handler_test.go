package scrub

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/mediacache"

	"github.com/gofiber/fiber/v2"
)

func TestProxyPreviewUsesVersioned480Edge(t *testing.T) {
	if got := proxyOutputName("clip.final.mp4", "landscape"); got != "clip.final_scrub_landscape_480.mp4" {
		t.Fatalf("proxy output name = %q", got)
	}
	if got := proxyVideoFilter("landscape"); got != "scale=480:-2,setsar=1,format=yuv420p" {
		t.Fatalf("landscape filter = %q", got)
	}
	if got := proxyVideoFilter("portrait"); got != "scale=-2:480,setsar=1,format=yuv420p" {
		t.Fatalf("portrait filter = %q", got)
	}
}

var testMP4 = []byte("\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isomiso2\x00\x00\x00\x0cmoovtest\x00\x00\x00\x0cmdattest")

func TestRemoteRenderProxyDoesNotRequireLocalOriginal(t *testing.T) {
	root := t.TempDir()
	source := mediacache.Source{
		Path: filepath.Join(root, "render_test.mp4"), Size: 100,
		Remote: &mediacache.RemoteSource{Key: "user/renders/render_test.mp4", ETag: "version-1", URL: "https://storage.example.test/render_test.mp4?signature=test"},
	}
	cache := &mediacache.Cache{}
	var encodes int
	run := func(ctx context.Context, program string, args ...string) ([]byte, error) {
		arguments := strings.Join(args, " ")
		for _, required := range []string{source.Remote.URL, "-protocol_whitelist https,tls,tcp", "-format_whitelist", "If-Match: \"version-1\""} {
			if !strings.Contains(arguments, required) {
				return nil, errors.New("missing remote input protection: " + required)
			}
		}
		if program == "ffprobe" {
			return []byte(`{"streams":[{"codec_type":"video","codec_name":"vp9","width":640,"height":360}],"format":{"duration":"10","format_name":"matroska"}}`), nil
		}
		encodes++
		return nil, os.WriteFile(args[len(args)-1], testMP4, 0600)
	}
	app := fiber.New()
	app.Get("/scrub-proxy", func(c *fiber.Ctx) error { return serveSourceProxy(c, source, cache, run) })
	for i := 0; i < 2; i++ {
		response := proxyRequest(t, app, "")
		body, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != http.StatusOK || string(body) != string(testMP4) {
			t.Fatalf("remote proxy: status %d, body %q, error %v", response.StatusCode, body, err)
		}
	}
	if encodes != 1 {
		t.Fatalf("remote proxy encoded %d times", encodes)
	}
	if _, err := os.Stat(source.Path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("original was hydrated: %v", err)
	}
}

func proxyApp(t *testing.T, run mediacache.Runner) (*fiber.App, string) {
	t.Helper()
	return proxyAppWithDuration(t, 10, run)
}

func proxyAppWithDuration(t *testing.T, duration float64, run mediacache.Runner) (*fiber.App, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "clip.webm"), []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	// Unmanaged old outputs, including interrupted encodes, are not trusted.
	if err := os.WriteFile(filepath.Join(root, proxyOutputName("clip.webm", "landscape")), []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	cache := &mediacache.Cache{}
	runWithMetadata := func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if program == "ffprobe" {
			value := strconv.FormatFloat(duration, 'f', -1, 64)
			return []byte(`{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"duration":"` + value + `"}}`), nil
		}
		return run(ctx, program, args...)
	}
	app := fiber.New()
	app.Get("/scrub-proxy", func(c *fiber.Ctx) error { return serveProxy(c, root, cache, runWithMetadata) })
	return app, root
}

func proxyRequest(t *testing.T, app *fiber.App, etag string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/scrub-proxy?file=clip.webm", nil)
	request.Header.Set("If-None-Match", etag)
	response, err := app.Test(request, 5000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func TestProxyCachingReplacementAndContainer(t *testing.T) {
	var calls atomic.Int32
	app, root := proxyApp(t, func(ctx context.Context, program string, args ...string) ([]byte, error) {
		calls.Add(1)
		if program != "ffmpeg" {
			return nil, errors.New("unexpected preprobe")
		}
		if _, ok := ctx.Deadline(); !ok {
			return nil, errors.New("missing deadline")
		}
		arguments := strings.Join(args, " ")
		for _, required := range []string{"-f mp4", "-crf 27", "-preset ultrafast", "-g 6", "-b:a 96k", "-threads " + strconv.Itoa(mediacache.Threads), proxyVideoFilter("landscape")} {
			if !strings.Contains(arguments, required) {
				return nil, errors.New("missing encode option: " + required)
			}
		}
		return nil, os.WriteFile(args[len(args)-1], testMP4, 0600)
	})
	response := proxyRequest(t, app, "")
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 200 || string(body) != string(testMP4) {
		t.Fatalf("proxy response: %d %q %v", response.StatusCode, body, err)
	}
	if response.Header.Get("Content-Type") != "video/mp4" || response.Header.Get("Content-Disposition") != `inline; filename="clip_scrub_landscape_480.webm"` {
		t.Fatalf("proxy headers: %v", response.Header)
	}
	etag := response.Header.Get("ETag")
	response = proxyRequest(t, app, etag)
	if response.StatusCode != 304 || calls.Load() != 1 {
		t.Fatalf("cache hit: status %d, calls %d", response.StatusCode, calls.Load())
	}
	request := httptest.NewRequest(http.MethodGet, "/scrub-proxy?file=clip.webm", nil)
	request.Header.Set("Range", "bytes=4-7")
	response, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	body, err = io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 206 || string(body) != "ftyp" || response.Header.Get("Content-Type") != "video/mp4" {
		t.Fatalf("range response: %d %q %v", response.StatusCode, body, err)
	}
	if err := os.WriteFile(filepath.Join(root, "clip.webm"), []byte("replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	response = proxyRequest(t, app, etag)
	if response.StatusCode != 200 || calls.Load() != 2 || response.Header.Get("ETag") == etag {
		t.Fatalf("replacement: status %d, calls %d", response.StatusCode, calls.Load())
	}
	if err := os.Remove(filepath.Join(root, "clip.webm")); err != nil {
		t.Fatal(err)
	}
	response = proxyRequest(t, app, "*")
	if response.StatusCode != 404 || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("missing source: status %d, headers %v", response.StatusCode, response.Header)
	}
}

func TestProxyUsesFastProfileOnlyAboveTwoMinutes(t *testing.T) {
	for _, test := range []struct {
		name        string
		duration    float64
		gop         string
		keyframeMin string
		filter      string
	}{
		{name: "two minutes", duration: 120, gop: "6", keyframeMin: "1", filter: proxyVideoFilter("landscape")},
		{name: "over two minutes", duration: 120.001, gop: "30", keyframeMin: "30", filter: "fps=15," + proxyVideoFilter("landscape")},
	} {
		t.Run(test.name, func(t *testing.T) {
			app, _ := proxyAppWithDuration(t, test.duration, func(_ context.Context, program string, args ...string) ([]byte, error) {
				if program != "ffmpeg" {
					return nil, errors.New("unexpected encoder")
				}
				arguments := strings.Join(args, " ")
				for _, required := range []string{"-vf " + test.filter, "-g " + test.gop, "-keyint_min " + test.keyframeMin} {
					if !strings.Contains(arguments, required) {
						return nil, errors.New("missing long-video option: " + required)
					}
				}
				return nil, os.WriteFile(args[len(args)-1], testMP4, 0600)
			})
			response := proxyRequest(t, app, "")
			if response.StatusCode != http.StatusOK {
				t.Fatalf("proxy status = %d", response.StatusCode)
			}
		})
	}
}

func TestProxyConcurrentRequestsAndFailureRetry(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	app, _ := proxyApp(t, func(_ context.Context, _ string, args ...string) ([]byte, error) {
		call := calls.Add(1)
		if err := os.WriteFile(args[len(args)-1], testMP4, 0600); err != nil {
			return nil, err
		}
		if call == 1 {
			return nil, errors.New("interrupted encode")
		}
		if call == 2 {
			close(started)
			<-release
		}
		return nil, nil
	})
	response := proxyRequest(t, app, "")
	if response.StatusCode != 500 || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("encode failure: %d %v", response.StatusCode, response.Header)
	}
	var workers sync.WaitGroup
	for range 8 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			response, err := app.Test(httptest.NewRequest(http.MethodGet, "/scrub-proxy?file=clip.webm", nil), 5000)
			if err != nil {
				t.Error(err)
				return
			}
			defer response.Body.Close()
			if response.StatusCode != 200 {
				t.Errorf("concurrent retry: %d", response.StatusCode)
			}
		}()
	}
	<-started
	close(release)
	workers.Wait()
	if calls.Load() != 2 {
		t.Fatalf("encode calls = %d, want one failure and one success", calls.Load())
	}
}

func TestProxyRejectsInvalidRequests(t *testing.T) {
	app, _ := proxyApp(t, func(context.Context, string, ...string) ([]byte, error) {
		t.Error("invalid request started encoder")
		return nil, nil
	})
	for _, query := range []string{"", "file=../clip.webm", "file=clip.webm&aspect=invalid", "file=.hidden.mp4"} {
		response, err := app.Test(httptest.NewRequest(http.MethodGet, "/scrub-proxy?"+query, nil))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 400 {
			t.Fatalf("query %q: status %d", query, response.StatusCode)
		}
	}
}

func TestProxyRangeAndHead(t *testing.T) {
	app, _ := proxyApp(t, func(_ context.Context, _ string, args ...string) ([]byte, error) {
		return nil, os.WriteFile(args[len(args)-1], testMP4, 0600)
	})
	for _, test := range []struct {
		name      string
		method    string
		byteRange string
		ifRange   string
		status    int
		body      string
	}{
		{name: "suffix", method: http.MethodGet, byteRange: "bytes=-4", status: 206, body: "test"},
		{name: "invalid", method: http.MethodGet, byteRange: "bytes=999-1000", status: 416, body: "invalid byte range"},
		{name: "stale resume", method: http.MethodGet, byteRange: "bytes=4-7", ifRange: `"old-source"`, status: 200, body: string(testMP4)},
		{name: "head", method: http.MethodHead, status: 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, "/scrub-proxy?file=clip.webm", nil)
			request.Header.Set("Range", test.byteRange)
			request.Header.Set("If-Range", test.ifRange)
			response, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil || response.StatusCode != test.status || string(body) != test.body {
				t.Fatalf("response: %d %q %v", response.StatusCode, body, err)
			}
			if test.method == http.MethodHead && response.ContentLength != int64(len(testMP4)) {
				t.Fatalf("HEAD length = %d", response.ContentLength)
			}
		})
	}
}

func TestProxyRejectsTruncatedCache(t *testing.T) {
	for _, data := range [][]byte{testMP4[:24], testMP4[:len(testMP4)-1], []byte("not an MP4 output")} {
		path := filepath.Join(t.TempDir(), "proxy.mp4")
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		if err := validateProxy(path); err == nil {
			t.Fatalf("accepted incomplete proxy: %q", data)
		}
	}
}

func TestCanPassthroughScrub(t *testing.T) {
	native := media.Metadata{Duration: 720, Width: 1280, Height: 720, VideoCodec: "h264", PixFmt: "yuv420p", AudioCodec: "aac", FormatName: "mov,mp4,m4a,3gp,3g2,mj2"}
	for _, test := range []struct {
		name     string
		file     string
		metadata media.Metadata
		want     bool
	}{
		{name: "mp4 h264 aac", file: "clip.mp4", metadata: native, want: true},
		{name: "mov h264 no audio", file: "clip.mov", metadata: media.Metadata{Duration: 60, Width: 640, Height: 480, VideoCodec: "h264", PixFmt: "yuv420p", FormatName: "mov,mp4,m4a"}, want: true},
		{name: "m4v h264 mp3", file: "clip.m4v", metadata: media.Metadata{Duration: 60, Width: 640, Height: 480, VideoCodec: "h264", PixFmt: "yuv420p", AudioCodec: "mp3", FormatName: "mov,mp4,m4a"}, want: true},
		{name: "uppercase extension", file: "CLIP.MP4", metadata: native, want: true},
		{name: "webm never passes", file: "clip.webm", metadata: native, want: false},
		{name: "mkv never passes", file: "clip.mkv", metadata: native, want: false},
		{name: "renamed matroska", file: "clip.mp4", metadata: media.Metadata{Duration: 60, Width: 640, Height: 480, VideoCodec: "h264", PixFmt: "yuv420p", AudioCodec: "aac", FormatName: "matroska,webm"}, want: false},
		{name: "hevc falls back", file: "clip.mp4", metadata: media.Metadata{Duration: 60, Width: 1920, Height: 1080, VideoCodec: "hevc", PixFmt: "yuv420p", AudioCodec: "aac", FormatName: "mov,mp4,m4a"}, want: false},
		{name: "10-bit pix fmt falls back", file: "clip.mp4", metadata: media.Metadata{Duration: 60, Width: 1920, Height: 1080, VideoCodec: "h264", PixFmt: "yuv420p10le", AudioCodec: "aac", FormatName: "mov,mp4,m4a"}, want: false},
		{name: "ac3 audio falls back", file: "clip.mp4", metadata: media.Metadata{Duration: 60, Width: 640, Height: 480, VideoCodec: "h264", PixFmt: "yuv420p", AudioCodec: "ac3", FormatName: "mov,mp4,m4a"}, want: false},
		{name: "opus audio falls back", file: "clip.mp4", metadata: media.Metadata{Duration: 60, Width: 640, Height: 480, VideoCodec: "h264", PixFmt: "yuv420p", AudioCodec: "opus", FormatName: "mov,mp4,m4a"}, want: false},
		{name: "audio-only falls back", file: "clip.mp4", metadata: media.Metadata{Duration: 60, AudioCodec: "aac", FormatName: "mov,mp4,m4a"}, want: false},
		{name: "unknown codec falls back", file: "clip.mp4", metadata: media.Metadata{Duration: 60, Width: 640, Height: 480, FormatName: "mov,mp4,m4a"}, want: false},
		{name: "missing format falls back", file: "clip.mp4", metadata: media.Metadata{Duration: 60, Width: 640, Height: 480, VideoCodec: "h264", PixFmt: "yuv420p", AudioCodec: "aac"}, want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := canPassthroughScrub(test.file, test.metadata); got != test.want {
				t.Fatalf("canPassthroughScrub(%q, %+v) = %v, want %v", test.file, test.metadata, got, test.want)
			}
		})
	}
}

// passthroughApp serves fileName with the given bytes and answers ffprobe
// with probeJSON. ffmpeg calls are delegated to onFFmpeg.
func passthroughApp(t *testing.T, fileName string, sourceBytes []byte, probeJSON string, onFFmpeg mediacache.Runner) *fiber.App {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, fileName), sourceBytes, 0600); err != nil {
		t.Fatal(err)
	}
	cache := &mediacache.Cache{}
	run := func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if program == "ffprobe" {
			return []byte(probeJSON), nil
		}
		return onFFmpeg(ctx, program, args...)
	}
	app := fiber.New()
	app.Get("/scrub-proxy", func(c *fiber.Ctx) error { return serveProxy(c, root, cache, run) })
	return app
}

const nativeProbe = `{"streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720,"pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac"}],"format":{"duration":"720","format_name":"mov,mp4,m4a,3gp,3g2,mj2"}}`

func TestProxyPassthroughServesOriginal(t *testing.T) {
	original := []byte("original-browser-native-mp4-bytes")
	app := passthroughApp(t, "long.mp4", original, nativeProbe, func(context.Context, string, ...string) ([]byte, error) {
		t.Error("passthrough must not start ffmpeg")
		return nil, errors.New("ffmpeg must not run on passthrough")
	})
	request := httptest.NewRequest(http.MethodGet, "/scrub-proxy?file=long.mp4&aspect=landscape", nil)
	response, err := app.Test(request, 5000)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || string(body) != string(original) {
		t.Fatalf("passthrough response: %d %q %v", response.StatusCode, body, err)
	}
	if response.Header.Get("Content-Type") != "video/mp4" {
		t.Fatalf("content type = %q", response.Header.Get("Content-Type"))
	}
	if response.Header.Get("Content-Disposition") != `inline; filename="long.mp4"` {
		t.Fatalf("content disposition = %q", response.Header.Get("Content-Disposition"))
	}
	etag := response.Header.Get("ETag")
	if etag == "" {
		t.Fatal("passthrough response has no ETag")
	}
	cached := httptest.NewRequest(http.MethodGet, "/scrub-proxy?file=long.mp4&aspect=landscape", nil)
	cached.Header.Set("If-None-Match", etag)
	response, err = app.Test(cached, 5000)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotModified {
		t.Fatalf("passthrough cache hit status = %d", response.StatusCode)
	}
	ranged := httptest.NewRequest(http.MethodGet, "/scrub-proxy?file=long.mp4&aspect=landscape", nil)
	ranged.Header.Set("Range", "bytes=0-7")
	response, err = app.Test(ranged, 5000)
	if err != nil {
		t.Fatal(err)
	}
	body, err = io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != 206 || string(body) != string(original[:8]) {
		t.Fatalf("passthrough range: %d %q %v", response.StatusCode, body, err)
	}
}

func TestProxyPassthroughFallback(t *testing.T) {
	for _, test := range []struct {
		name  string
		file  string
		probe string
	}{
		{name: "hevc", file: "clip.mp4", probe: `{"streams":[{"codec_type":"video","codec_name":"hevc","width":1920,"height":1080,"pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac"}],"format":{"duration":"720","format_name":"mov,mp4,m4a"}}`},
		{name: "ac3 audio", file: "clip.mp4", probe: `{"streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720,"pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"ac3"}],"format":{"duration":"720","format_name":"mov,mp4,m4a"}}`},
		{name: "renamed matroska", file: "clip.mp4", probe: `{"streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720,"pix_fmt":"yuv420p"}],"format":{"duration":"720","format_name":"matroska,webm"}}`},
		{name: "webm", file: "clip.webm", probe: `{"streams":[{"codec_type":"video","codec_name":"vp9","width":1280,"height":720,"pix_fmt":"yuv420p"}],"format":{"duration":"720","format_name":"webm"}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			var encodes atomic.Int32
			app := passthroughApp(t, test.file, []byte("source"), test.probe, func(_ context.Context, _ string, args ...string) ([]byte, error) {
				encodes.Add(1)
				return nil, os.WriteFile(args[len(args)-1], testMP4, 0600)
			})
			response, err := app.Test(httptest.NewRequest(http.MethodGet, "/scrub-proxy?file="+test.file, nil), 5000)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil || response.StatusCode != 200 || string(body) != string(testMP4) {
				t.Fatalf("fallback response: %d %q %v", response.StatusCode, body, err)
			}
			if encodes.Load() != 1 {
				t.Fatalf("fallback encodes = %d, want 1", encodes.Load())
			}
		})
	}
}
