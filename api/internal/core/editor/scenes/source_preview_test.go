package scenes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"

	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func TestScenePreviewStreamsSavedBundleWithoutWakingWorker(t *testing.T) {
	var calls atomic.Int32
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer worker.Close()
	t.Setenv("SCENE_SERVICE_URL", worker.URL)
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { sessions.Evict("preview-test"); storage.DataDir = previous })
	root, err := sessions.Touch("preview-test")
	if err != nil {
		t.Fatal(err)
	}
	name := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	app := fiber.New()
	app.Get("/download", DownloadSource)
	for _, version := range []int{0, previewEnvironmentVersion - 1, previewEnvironmentVersion} {
		t.Run(strconv.Itoa(version), func(t *testing.T) {
			source := LiveSource{Version: 1, Component: "<p>Scenă salvată</p>", JavaScript: "saved-browser-bundle",
				EnvironmentVersion: version, Config: Config{Width: 320, Height: 180, FPS: 30, Frames: 60},
				Images: map[string]string{"image_1": "data:image/png;base64,AAAA"}}
			data, err := json.MarshalIndent(source, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, name), data, 0600); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodGet, "/download?file="+name+"&session=preview-test", nil)
			response, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil || response.StatusCode != http.StatusOK || string(body) != string(data) {
				t.Fatalf("saved preview changed: status=%d err=%v", response.StatusCode, err)
			}
			if calls.Load() != 0 {
				t.Fatal("viewing a saved scene contacted the compiler or renderer")
			}
			request.Header.Set("If-None-Match", response.Header.Get("ETag"))
			cached, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			cached.Body.Close()
			if cached.StatusCode != http.StatusNotModified {
				t.Fatalf("saved scene cache not reused: %d", cached.StatusCode)
			}
		})
	}
}
