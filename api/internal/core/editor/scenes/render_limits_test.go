package scenes

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLosslessSceneOutputLimitMatchesService(t *testing.T) {
	if maxVideoBytes != 1<<30 {
		t.Fatalf("scene receiver limit = %d, want 1 GiB", maxVideoBytes)
	}
}

func TestSceneDownloadRejectsOversizedContentLengthBeforeStaging(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprint(maxVideoBytes+1))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	t.Setenv("SCENE_SERVICE_URL", server.URL)
	output := filepath.Join(t.TempDir(), "scene.mp4")
	_, err := renderRemote(context.Background(), "<p>Scene</p>", Config{Width: 320, Height: 180, FPS: 30, Frames: 30}, nil, nil, output)
	if err == nil || !strings.Contains(err.Error(), "exceeds output limit") {
		t.Fatalf("unexpected oversized-output error: %v", err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("oversized output was staged: %v", err)
	}
}
