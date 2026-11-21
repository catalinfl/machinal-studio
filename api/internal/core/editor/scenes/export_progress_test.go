package scenes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSceneProgressCrossesServiceBoundaryWithoutAnotherRender(t *testing.T) {
	progressRead := make(chan struct{})
	progressReported := make(chan struct{})
	var readOnce, reportedOnce sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing private service authentication")
		}
		if strings.HasPrefix(r.URL.Path, "/render-progress/") {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(ExportProgress{Stage: "capture", WrittenFrames: 15, TotalFrames: 60, ElapsedMS: 1000})
			readOnce.Do(func() { close(progressRead) })
			return
		}
		if r.URL.Path != "/render" || len(r.Header.Get("X-Scene-Progress-Id")) != 32 {
			t.Error("missing invocation-scoped progress token")
		}
		select {
		case <-progressRead:
		case <-r.Context().Done():
			return
		}
		select {
		case <-progressReported:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("X-Scene-Manifest", base64.StdEncoding.EncodeToString([]byte(`{}`)))
		w.Write([]byte("video"))
	}))
	defer server.Close()
	t.Setenv("SCENE_SERVICE_URL", server.URL)
	t.Setenv("SCENE_SERVICE_TOKEN", "test-token")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	updates := []ExportProgress{}
	ctx = WithExportProgress(ctx, func(update ExportProgress) {
		updates = append(updates, update)
		reportedOnce.Do(func() { close(progressReported) })
	})
	_, err := renderRemote(ctx, "<p>synthetic</p>", Config{Frames: 60}, nil, nil, filepath.Join(t.TempDir(), "scene.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	if len(updates) != 1 || updates[0].WrittenFrames != 15 || updates[0].Stage != "capture" {
		t.Fatal("frame progress was lost", updates)
	}
}

func TestSceneProgressIsBoundedValidatedAndOptional(t *testing.T) {
	for _, body := range []string{
		`{"stage":"capture","writtenFrames":-1,"totalFrames":60}`,
		`{"stage":"capture","writtenFrames":10,"totalFrames":600}`,
		`{"stage":"capture","writtenFrames":61,"totalFrames":60}`,
		`{"stage":"private source code","writtenFrames":10,"totalFrames":60}`,
		`{"stage":"capture","writtenFrames":10,"totalFrames":60,"elapsedMs":-1}`,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(body)) }))
		request, err := http.NewRequest(http.MethodPost, server.URL+"/render", nil)
		if err != nil {
			t.Fatal(err)
		}
		_, valid := readExportProgress(context.Background(), request, strings.Repeat("a", 32), 60)
		server.Close()
		if valid {
			t.Fatal("invalid progress accepted", body)
		}
	}
}
