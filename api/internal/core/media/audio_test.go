package media

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/mediacache"

	"github.com/gofiber/fiber/v2"
)

const audioTestMetadata = `{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"duration":"7200"}}`

func audioTestApp(t *testing.T, run mediacache.Runner) (*fiber.App, string) {
	t.Helper()
	app, root := assetApp(t, "clip.mp4", run)
	cache := &mediacache.Cache{}
	app.Get("/audio-preview", func(c *fiber.Ctx) error { return serveAudioPreview(c, root, cache, run) })
	return app, root
}

func audioTestMP4() []byte {
	var data []byte
	for _, box := range []string{"ftyp", "moov", "mdat"} {
		data = binary.BigEndian.AppendUint32(data, 12)
		data = append(data, box...)
		data = append(data, 0, 0, 0, 0)
	}
	return data
}

func TestAudioPreviewCacheRangeAndSourceChanges(t *testing.T) {
	var probes, encodes int
	app, root := audioTestApp(t, func(ctx context.Context, program string, args ...string) ([]byte, error) {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > mediacache.ProxyTimeout {
			return nil, errors.New("unbounded process")
		}
		arguments := strings.Join(args, " ")
		if !strings.Contains(arguments, "-protocol_whitelist file,pipe") || args[len(args)-1] == "clip.mp4" {
			return nil, errors.New("unsafe source arguments")
		}
		if program == "ffprobe" {
			probes++
			if time.Until(deadline) > mediacache.ProbeTimeout {
				return nil, errors.New("unbounded probe")
			}
			if strings.Contains(arguments, "-select_streams a:0 -show_entries stream=index") {
				return []byte(`{"streams":[{"index":1}]}`), nil
			}
			return []byte(audioTestMetadata), nil
		}
		encodes++
		for index, arg := range args {
			if arg == "-i" && (!filepath.IsAbs(args[index+1]) || filepath.Base(args[index+1]) != "clip.mp4") {
				return nil, errors.New("encode must use the original server source")
			}
		}
		for _, required := range []string{"-nostdin", "-filter_threads 1", "-map 0:a:0 -vn -sn -dn", "-c:a aac -b:a 128k", "-threads ", "-movflags +faststart -f mp4"} {
			if !strings.Contains(arguments, required) {
				return nil, errors.New("missing encode option: " + required)
			}
		}
		return nil, os.WriteFile(args[len(args)-1], audioTestMP4(), 0600)
	})
	path := "/audio-preview?file=clip.mp4"
	response := assetRequest(t, app, path, "")
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || response.Header.Get("Content-Type") != "audio/mp4" || string(body) != string(audioTestMP4()) {
		t.Fatalf("preview: %d %v %q", response.StatusCode, response.Header, body)
	}
	etag := response.Header.Get("ETag")
	if etag == "" || response.Header.Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("cache headers: %v", response.Header)
	}
	response = assetRequest(t, app, path, etag)
	if response.StatusCode != 304 || probes != 2 || encodes != 1 {
		t.Fatalf("cache hit: %d probes=%d encodes=%d", response.StatusCode, probes, encodes)
	}
	for _, test := range []struct {
		rangeValue, ifRange string
		status, length      int
	}{
		{"bytes=0-7", etag, 206, 8},
		{"bytes=0-7", `"old"`, 200, 36},
		{"bytes=999-", "", 416, -1},
	} {
		request := httptest.NewRequest("GET", path, nil)
		request.Header.Set("Range", test.rangeValue)
		request.Header.Set("If-Range", test.ifRange)
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != test.status || (test.length >= 0 && len(body) != test.length) {
			t.Fatalf("range: %d %q", response.StatusCode, body)
		}
	}
	source, err := ResolveSource(root, "clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	cachePath := filepath.Join(root, mediacache.Directory, source.Key(audioPreviewProfile), "audio.mp4")
	if err := os.WriteFile(cachePath, audioTestMP4()[:28], 0600); err != nil {
		t.Fatal(err)
	}
	response = assetRequest(t, app, path, "")
	if response.StatusCode != 200 || encodes != 2 || probes != 3 {
		t.Fatalf("corrupt cache was not regenerated: %d %d %d", response.StatusCode, encodes, probes)
	}
	if err := os.WriteFile(source.Path, []byte("replacement video"), 0600); err != nil {
		t.Fatal(err)
	}
	response = assetRequest(t, app, path, etag)
	if response.StatusCode != 200 || response.Header.Get("ETag") == etag || encodes != 3 || probes != 5 {
		t.Fatalf("replacement served stale: %d %d %d", response.StatusCode, encodes, probes)
	}
	if err := os.Remove(source.Path); err != nil {
		t.Fatal(err)
	}
	if response := assetRequest(t, app, path, "*"); response.StatusCode != 404 {
		t.Fatalf("deleted source: %d", response.StatusCode)
	}
}

func TestAudioPreviewNoAudioAndFailures(t *testing.T) {
	for _, test := range []struct {
		name, probe         string
		probeErr, encodeErr error
		invalidOutput       bool
		status              int
	}{
		{name: "no audio", probe: `{"streams":[]}`, status: 204},
		{name: "malformed", probe: `{`, status: 422},
		{name: "missing streams", probe: `{}`, status: 422},
		{name: "null streams", probe: `{"streams":null}`, status: 422},
		{name: "missing index", probe: `{"streams":[{}]}`, status: 422},
		{name: "probe timeout", probeErr: context.DeadlineExceeded, status: 504},
		{name: "probe failure", probeErr: &exec.ExitError{}, status: 422},
		{name: "missing binary", probeErr: errors.New("cannot start ffprobe"), status: 500},
		{name: "encode failure", probe: `{"streams":[{"index":0}]}`, encodeErr: &exec.ExitError{}, status: 422},
		{name: "encode timeout", probe: `{"streams":[{"index":0}]}`, encodeErr: context.DeadlineExceeded, status: 504},
		{name: "invalid output", probe: `{"streams":[{"index":0}]}`, invalidOutput: true, status: 500},
	} {
		t.Run(test.name, func(t *testing.T) {
			var probes, encodes int
			app, _ := audioTestApp(t, func(ctx context.Context, program string, args ...string) ([]byte, error) {
				if program == "ffprobe" {
					if !strings.Contains(strings.Join(args, " "), "-select_streams") {
						return []byte(audioTestMetadata), nil
					}
					probes++
					return []byte(test.probe), test.probeErr
				}
				encodes++
				if test.invalidOutput {
					return nil, os.WriteFile(args[len(args)-1], []byte("broken"), 0600)
				}
				return nil, test.encodeErr
			})
			for attempt := 0; attempt < 2; attempt++ {
				response := assetRequest(t, app, "/audio-preview?file=clip.mp4", "*")
				body, _ := io.ReadAll(response.Body)
				if response.StatusCode != test.status || response.Header.Get("Cache-Control") != "no-store" || (test.status == 204 && len(body) != 0) {
					t.Fatalf("response: %d %v %q", response.StatusCode, response.Header, body)
				}
			}
			if probes != 2 || (test.encodeErr == nil && !test.invalidOutput && encodes != 0) {
				t.Fatalf("unexpected process counts: probes=%d encodes=%d", probes, encodes)
			}
		})
	}
}

func TestAudioPreviewNoAudioSourceChanged(t *testing.T) {
	app, _ := audioTestApp(t, func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if program != "ffprobe" {
			return nil, errors.New("silent source must not encode")
		}
		if !strings.Contains(strings.Join(args, " "), "-select_streams") {
			return []byte(audioTestMetadata), nil
		}
		if err := os.WriteFile(args[len(args)-1], []byte("replaced while probing"), 0600); err != nil {
			return nil, err
		}
		return []byte(`{"streams":[]}`), nil
	})
	response := assetRequest(t, app, "/audio-preview?file=clip.mp4", "*")
	if response.StatusCode != 409 || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("changed source reported silence: %d %v", response.StatusCode, response.Header)
	}
}

func TestAudioPreviewSourceSafety(t *testing.T) {
	app, root := audioTestApp(t, func(context.Context, string, ...string) ([]byte, error) {
		t.Error("unsafe request started a process")
		return nil, errors.New("unexpected process")
	})
	if err := os.Mkdir(filepath.Join(root, "directory.mp4"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name   string
		status int
	}{
		{"", 400}, {"../clip.mp4", 400}, {"clip.mp4:stream.mp4", 400},
		{"https://example.com/clip.mp4", 400}, {"bad.txt", 415},
		{"missing.mp4", 404}, {"directory.mp4", 400}, {".media-cache/audio.mp4", 400},
	} {
		response := assetRequest(t, app, "/audio-preview?file="+url.QueryEscape(test.name), "*")
		if response.StatusCode != test.status {
			t.Fatalf("file %q: %d, want %d", test.name, response.StatusCode, test.status)
		}
	}
	t.Run("symlink", func(t *testing.T) {
		if err := os.Symlink(filepath.Join(root, "clip.mp4"), filepath.Join(root, "link.mp4")); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
		if response := assetRequest(t, app, "/audio-preview?file=link.mp4", ""); response.StatusCode != 400 {
			t.Fatalf("symlink: %d", response.StatusCode)
		}
	})
}

func TestAudioPreviewWithFFmpeg(t *testing.T) {
	for _, program := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(program); err != nil {
			t.Skipf("%s is not installed", program)
		}
	}
	root := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cache := &mediacache.Cache{}
	app := fiber.New()
	app.Get("/audio-preview", func(c *fiber.Ctx) error { return serveAudioPreview(c, root, cache, mediacache.Run) })
	for _, withAudio := range []bool{false, true} {
		name := "silent.mp4"
		args := []string{"-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=s=32x32:r=1"}
		if withAudio {
			name = "sound.mp4"
			args = append(args, "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac")
		}
		args = append(args, "-t", "1", "-c:v", "mpeg4", "-threads", "1", filepath.Join(root, name))
		if _, err := mediacache.Run(ctx, "ffmpeg", args...); err != nil {
			t.Fatal(err)
		}
		response := assetRequest(t, app, "/audio-preview?file="+name, "")
		body, _ := io.ReadAll(response.Body)
		if !withAudio {
			if response.StatusCode != 204 || len(body) != 0 {
				t.Fatalf("silent video: %d %q", response.StatusCode, body)
			}
			continue
		}
		if response.StatusCode != 200 {
			t.Fatalf("audio video: %d %q", response.StatusCode, body)
		}
		output := filepath.Join(root, "result.mp4")
		if err := os.WriteFile(output, body, 0600); err != nil {
			t.Fatal(err)
		}
		data, err := mediacache.Run(ctx, "ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name:format=duration", "-of", "json", output)
		if err != nil {
			t.Fatal(err)
		}
		var probe struct {
			Streams []struct {
				CodecType string `json:"codec_type"`
				CodecName string `json:"codec_name"`
			} `json:"streams"`
			Format struct {
				Duration string `json:"duration"`
			} `json:"format"`
		}
		if err := json.Unmarshal(data, &probe); err != nil || len(probe.Streams) != 1 || probe.Streams[0].CodecType != "audio" || probe.Streams[0].CodecName != "aac" || validDuration(probe.Format.Duration) < 0.9 {
			t.Fatalf("invalid preview: %s (%v)", data, err)
		}
		if _, err := mediacache.Run(ctx, "ffmpeg", "-nostdin", "-v", "error", "-i", output, "-f", "null", "-"); err != nil {
			t.Fatalf("preview cannot decode: %v", err)
		}
	}
}
