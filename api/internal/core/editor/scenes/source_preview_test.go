package scenes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLegacyScenePreviewUsesSharedRenderEnvironment(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/compile" {
			t.Errorf("unexpected compiler endpoint: %s", r.URL.Path)
		}
		var request struct {
			Component string `json:"component"`
			Config    Config `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.Component != "<p>Saved scene</p>" || request.Config != (Config{Width: 1080, Height: 1920, FPS: 30, Frames: 60}) {
			t.Errorf("legacy scene changed: %+v", request)
		}
		if err := json.NewEncoder(w).Encode(map[string]string{"javascript": "shared-font-bundle"}); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	t.Setenv("SCENE_SERVICE_URL", server.URL)
	original := LiveSource{Version: 1, Component: "<p>Saved scene</p>", JavaScript: "old-bundle", Config: Config{Width: 1080, Height: 1920, FPS: 30, Frames: 60}, Audio: &Narration{File: "voice.wav", Start: 3, Duration: 10}}
	preview, err := preparePreviewSource(context.Background(), original)
	if err != nil || preview.JavaScript != "shared-font-bundle" || preview.EnvironmentVersion != previewEnvironmentVersion || preview.Audio != original.Audio {
		t.Fatalf("refreshed preview: %+v, %v", preview, err)
	}
	if original.JavaScript != "old-bundle" || original.EnvironmentVersion != 0 {
		t.Fatal("refresh mutated the stored asset")
	}
	if _, err := preparePreviewSource(context.Background(), preview); err != nil || calls != 1 {
		t.Fatalf("current previews should not recompile: calls=%d, %v", calls, err)
	}
	previous := original
	previous.EnvironmentVersion = previewEnvironmentVersion - 1
	refreshed, err := preparePreviewSource(context.Background(), previous)
	if err != nil || calls != 2 || refreshed.EnvironmentVersion != previewEnvironmentVersion || refreshed.JavaScript != "shared-font-bundle" {
		t.Fatalf("previous environment should refresh: calls=%d, source=%+v, %v", calls, refreshed, err)
	}
}
