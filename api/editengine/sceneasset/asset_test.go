package sceneasset

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func testManifest(content []byte) []byte {
	digest := sha256.Sum256(content)
	result := map[string]any{
		"version": 1, "file": "/untrusted/renderer/path.mp4", "sha256": hex.EncodeToString(digest[:]), "size": len(content),
		"duration": 3, "width": 640, "height": 360, "fps": 30, "frames": 90, "hasAudio": false,
		"scene": map[string]any{"version": 1, "sceneId": "intro", "config": map[string]any{"width": 640, "height": 360, "fps": 30, "durationInFrames": 90}},
	}
	data, _ := json.Marshal(result)
	return data
}

func TestImportVerifiesAssetAndBindsApplicationFilename(t *testing.T) {
	root := t.TempDir()
	content := []byte("staged scene asset")
	if err := os.WriteFile(filepath.Join(root, "intro.mp4"), content, 0600); err != nil {
		t.Fatal(err)
	}
	result, err := Import(root, "intro.mp4", "scene-1", bytes.NewReader(testManifest(content)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Asset.ID != "scene-1" || result.Asset.File != "intro.mp4" || result.Asset.Duration.Seconds() != 3 || result.Asset.Kind != "video" {
		t.Fatalf("unexpected asset: %+v", result.Asset)
	}
	if len(result.Scene) == 0 {
		t.Fatal("scene provenance was lost")
	}
}

func TestImportRejectsChangedBytesAndRootEscape(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "intro.mp4"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	manifest := testManifest([]byte("original"))
	if _, err := Import(root, "intro.mp4", "scene-1", bytes.NewReader(manifest)); err == nil {
		t.Fatal("accepted stale scene asset")
	}
	if _, err := Import(root, "../outside.mp4", "scene-1", bytes.NewReader(manifest)); err == nil {
		t.Fatal("accepted asset outside storage root")
	}
}

func TestImportRealRenderedAsset(t *testing.T) {
	path := os.Getenv("SCENE_RENDERED_ASSET")
	if path == "" {
		t.Skip("SCENE_RENDERED_ASSET is not configured")
	}
	sidecar, err := os.Open(path + ".scene.json")
	if err != nil {
		t.Fatal(err)
	}
	defer sidecar.Close()
	result, err := Import(filepath.Dir(path), filepath.Base(path), "scene-native", sidecar)
	if err != nil {
		t.Fatal(err)
	}
	if result.Asset.Width <= 0 || result.Asset.Duration <= 0 {
		t.Fatalf("invalid imported result: %+v", result.Asset)
	}
}
