package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/objectstore"

	"github.com/gofiber/fiber/v2"
)

type previewS3 struct {
	mu      sync.Mutex
	etag    string
	missing bool
	heads   atomic.Int32
	gets    atomic.Int32
	bytes   atomic.Int64
}

type countingResponse struct {
	http.ResponseWriter
	bytes *atomic.Int64
}

func (w countingResponse) Write(data []byte) (int, error) {
	n, err := w.ResponseWriter.Write(data)
	w.bytes.Add(int64(n))
	return n, err
}

func newPreviewS3(t *testing.T, name string, data io.ReadSeeker, size int64) (*previewS3, *objectstore.Client) {
	t.Helper()
	state := &previewS3{etag: "version-1"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state.mu.Lock()
		defer state.mu.Unlock()
		if r.Method == http.MethodDelete {
			if r.URL.Path == "/bucket/user/"+name {
				state.missing = true
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.URL.Path != "/bucket/user/"+name || state.missing {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", `"`+state.etag+`"`)
		if r.Method == http.MethodHead {
			state.heads.Add(1)
			w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
			return
		}
		state.gets.Add(1)
		if r.Header.Get("If-Match") != `"`+state.etag+`"` {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		http.ServeContent(countingResponse{w, &state.bytes}, r, name, time.Time{}, data)
	}))
	t.Cleanup(server.Close)
	client := objectstore.New(objectstore.Config{
		Endpoint: server.URL, Region: "auto", Bucket: "bucket", AccessKey: "key", SecretKey: "secret",
	})
	return state, client
}

func remotePreviewApp(root string, store previewStore, run mediacache.Runner) *fiber.App {
	app := fiber.New()
	cache := &mediacache.Cache{}
	app.Get("/media-metadata", func(c *fiber.Ctx) error {
		source, err := resolvePreviewSource(c.UserContext(), root, c.Query("file"), []string{"user"}, store)
		if err != nil {
			return AssetError(c, err)
		}
		return serveSourceMetadata(c, source, cache, run)
	})
	app.Get("/thumbnail", func(c *fiber.Ctx) error {
		source, err := resolvePreviewSource(c.UserContext(), root, c.Query("file"), []string{"user"}, store)
		if err != nil {
			return AssetError(c, err)
		}
		return serveSourceThumbnail(c, source, cache, run)
	})
	return app
}

func TestRemotePreviewsDoNotHydrateOriginal(t *testing.T) {
	root := t.TempDir()
	s3, store := newPreviewS3(t, "clip.mp4", bytes.NewReader([]byte("media")), 100<<20)
	var probes, encodes atomic.Int32
	app := remotePreviewApp(root, store, func(ctx context.Context, program string, args ...string) ([]byte, error) {
		arguments := strings.Join(args, " ")
		if !strings.Contains(arguments, store.Config.Endpoint+"/bucket/user/clip.mp4?") ||
			!strings.Contains(arguments, "-format_whitelist "+previewFormats) ||
			!strings.Contains(arguments, "If-Match: \"version-") ||
			strings.Contains(arguments, "file,pipe") {
			return nil, errors.New("remote preview is not using a version-pinned, restricted input")
		}
		if program == "ffprobe" {
			probes.Add(1)
			return []byte(`{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"duration":"10"}}`), nil
		}
		encodes.Add(1)
		return nil, writeTestJPEG(args[len(args)-1])
	})
	for _, endpoint := range []string{"/media-metadata", "/thumbnail"} {
		response := assetRequest(t, app, endpoint+"?file=clip.mp4", "")
		if response.StatusCode != 200 {
			t.Fatalf("%s status = %d", endpoint, response.StatusCode)
		}
		hit := assetRequest(t, app, endpoint+"?file=clip.mp4", response.Header.Get("ETag"))
		if hit.StatusCode != 304 {
			t.Fatalf("%s cache hit = %d", endpoint, hit.StatusCode)
		}
	}
	if probes.Load() != 1 || encodes.Load() != 1 || s3.gets.Load() != 0 {
		t.Fatalf("probes=%d encodes=%d original downloads=%d", probes.Load(), encodes.Load(), s3.gets.Load())
	}
	if _, err := os.Stat(filepath.Join(root, "clip.mp4")); !os.IsNotExist(err) {
		t.Fatalf("original hydrated for a preview: %v", err)
	}
	s3.mu.Lock()
	s3.etag = "version-2"
	s3.mu.Unlock()
	response := assetRequest(t, app, "/thumbnail?file=clip.mp4", "")
	if response.StatusCode != 200 || probes.Load() != 2 || encodes.Load() != 2 {
		t.Fatalf("changed remote source reused stale preview: %d, probes=%d, encodes=%d", response.StatusCode, probes.Load(), encodes.Load())
	}
	s3.mu.Lock()
	s3.missing = true
	s3.mu.Unlock()
	response = assetRequest(t, app, "/thumbnail?file=clip.mp4", "")
	if response.StatusCode != 404 {
		t.Fatalf("deleted source served cached thumbnail: %d", response.StatusCode)
	}
}

func TestRemotePreviewValidationAndLocalHit(t *testing.T) {
	root := t.TempDir()
	s3, store := newPreviewS3(t, "clip.mp4", bytes.NewReader([]byte("media")), 5)
	for _, name := range []string{"../clip.mp4", "clip.mp4:stream.mp4", "bad.txt", "-clip.mp4"} {
		if _, err := resolvePreviewSource(context.Background(), root, name, []string{"user"}, store); err == nil {
			t.Fatalf("accepted invalid preview name %q", name)
		}
	}
	if s3.heads.Load() != 0 {
		t.Fatal("invalid names reached S3")
	}
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), []byte("local"), 0600); err != nil {
		t.Fatal(err)
	}
	source, err := resolvePreviewSource(context.Background(), root, "clip.mp4", []string{"user"}, store)
	if err != nil || source.Remote != nil || s3.heads.Load() != 0 {
		t.Fatalf("local hit used S3: %+v, %v", source, err)
	}
}

func TestRemotePreviewResolvesRenderAndLegacyPrefixes(t *testing.T) {
	_, store := newPreviewS3(t, "renders/render_clip.mp4", bytes.NewReader([]byte("media")), 5)
	source, err := resolvePreviewSource(context.Background(), t.TempDir(), "render_clip.mp4", []string{"owner", "user"}, store)
	if err != nil || source.Remote == nil || source.Remote.Key != "user/renders/render_clip.mp4" {
		t.Fatalf("render fallback source=%+v err=%v", source, err)
	}
}

func TestRemoteDeleteDoesNotHydrateOriginal(t *testing.T) {
	root := t.TempDir()
	s3, store := newPreviewS3(t, "clip.mp4", bytes.NewReader([]byte("media")), 5)
	if err := removeSessionDeleteTarget(context.Background(), root, "clip.mp4", []string{"user"}, store); err != nil {
		t.Fatal(err)
	}
	if s3.gets.Load() != 0 {
		t.Fatal("deleting a remote-only source downloaded the original")
	}
	s3.mu.Lock()
	s3.missing = true
	s3.mu.Unlock()
	err := removeSessionDeleteTarget(context.Background(), root, "clip.mp4", []string{"user"}, store)
	var httpError *fiber.Error
	if !errors.As(err, &httpError) || httpError.Code != fiber.StatusNotFound {
		t.Fatalf("missing deletion target returned %v", err)
	}
}

func TestRemotePlaybackStreamsRequestedRange(t *testing.T) {
	root := t.TempDir()
	s3, store := newPreviewS3(t, "clip.mp4", bytes.NewReader([]byte("0123456789")), 10)
	app := fiber.New()
	app.Get("/download", func(c *fiber.Ctx) error {
		source, err := resolvePreviewSource(c.UserContext(), root, "clip.mp4", []string{"user"}, store)
		if err != nil {
			return AssetError(c, err)
		}
		return streamRemoteDownload(c, source, store)
	})
	for _, test := range []struct {
		method, byteRange, body, contentRange string
		status                                int
	}{
		{http.MethodGet, "bytes=2-4", "234", "bytes 2-4/10", 206},
		{http.MethodGet, "bytes=-2", "89", "bytes 8-9/10", 206},
		{http.MethodGet, "", "0123456789", "", 200},
		{http.MethodHead, "bytes=2-4", "", "bytes 2-4/10", 206},
		{http.MethodGet, "bytes=20-30", "invalid byte range", "bytes */10", 416},
	} {
		request := httptest.NewRequest(test.method, "/download", nil)
		request.Header.Set("Range", test.byteRange)
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != test.status || string(body) != test.body || response.Header.Get("Content-Range") != test.contentRange {
			t.Fatalf("%s %s: status=%d body=%q range=%q err=%v", test.method, test.byteRange, response.StatusCode, body, response.Header.Get("Content-Range"), err)
		}
	}
	if s3.gets.Load() != 3 || s3.bytes.Load() != 15 {
		t.Fatalf("playback fetched unnecessary bytes: gets=%d bytes=%d", s3.gets.Load(), s3.bytes.Load())
	}
	if _, err := os.Stat(filepath.Join(root, "clip.mp4")); !os.IsNotExist(err) {
		t.Fatalf("streaming hydrated original: %v", err)
	}
}

func TestRemotePreviewFormatsWithFFmpeg(t *testing.T) {
	for _, program := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(program); err != nil {
			t.Skip(program + " is not installed")
		}
	}
	for _, fixture := range []struct {
		name string
		args []string
	}{
		{"clip.webm", []string{"-f", "lavfi", "-i", "color=s=320x180:r=2", "-t", "1", "-c:v", "libvpx-vp9"}},
		{"sound.wav", []string{"-f", "lavfi", "-i", "sine=duration=1"}},
		{"sound.mp3", []string{"-f", "lavfi", "-i", "sine=duration=1"}},
		{"sound.m4a", []string{"-f", "lavfi", "-i", "sine=duration=1"}},
		{"still.png", []string{"-f", "lavfi", "-i", "color=s=320x180", "-frames:v", "1", "-update", "1"}},
		{"still.jpg", []string{"-f", "lavfi", "-i", "color=s=320x180", "-frames:v", "1", "-update", "1"}},
		{"still.webp", []string{"-f", "lavfi", "-i", "color=s=320x180", "-frames:v", "1"}},
		{"still.gif", []string{"-f", "lavfi", "-i", "color=s=320x180", "-frames:v", "1"}},
		{"still.bmp", []string{"-f", "lavfi", "-i", "color=s=320x180", "-frames:v", "1", "-update", "1"}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			input := filepath.Join(t.TempDir(), fixture.name)
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			args := append([]string{"-nostdin", "-v", "error", "-y", "-filter_threads", "1"}, fixture.args...)
			args = append(args, "-threads", "1", input)
			if _, err := mediacache.Run(ctx, "ffmpeg", args...); err != nil {
				t.Fatal(err)
			}
			file, err := os.Open(input)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			info, err := file.Stat()
			if err != nil {
				t.Fatal(err)
			}
			_, store := newPreviewS3(t, fixture.name, file, info.Size())
			app := remotePreviewApp(t.TempDir(), store, mediacache.Run)
			metadata := assetRequest(t, app, "/media-metadata?file="+fixture.name, "")
			if metadata.StatusCode != 200 {
				t.Fatalf("metadata status=%d", metadata.StatusCode)
			}
			thumbnail := assetRequest(t, app, "/thumbnail?file="+fixture.name, "")
			want := 200
			if strings.HasPrefix(fixture.name, "sound.") {
				want = 415
			}
			if thumbnail.StatusCode != want {
				t.Fatalf("thumbnail status=%d, want=%d", thumbnail.StatusCode, want)
			}
		})
	}
}

func TestRemotePreviewWithFFmpeg(t *testing.T) {
	for _, program := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(program); err != nil {
			t.Skip(program + " is not installed")
		}
	}
	input := filepath.Join(t.TempDir(), "clip.mp4")
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	_, err := mediacache.Run(ctx, "ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi",
		"-i", "color=s=640x360:r=2", "-t", "2", "-c:v", "libx264", "-threads", "1", "-movflags", "+faststart", input)
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(input, os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	start, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		t.Fatal(err)
	}
	const padding = 64 << 20
	header := make([]byte, 8)
	binary.BigEndian.PutUint32(header, padding)
	copy(header[4:], "free")
	if _, err := file.Write(header); err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(start + padding); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	s3, store := newPreviewS3(t, "clip.mp4", file, start+padding)
	app := remotePreviewApp(root, store, mediacache.Run)
	for _, endpoint := range []string{"/media-metadata", "/thumbnail"} {
		response := assetRequest(t, app, endpoint+"?file=clip.mp4", "")
		if response.StatusCode != 200 {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("%s status=%d body=%s", endpoint, response.StatusCode, body)
		}
	}
	if s3.gets.Load() == 0 || s3.bytes.Load() >= padding/2 {
		t.Fatalf("preview read too much of the original: requests=%d bytes=%d of %d", s3.gets.Load(), s3.bytes.Load(), start+padding)
	}
	t.Logf("metadata and thumbnail read %d bytes of a %d-byte original", s3.bytes.Load(), start+padding)
}
