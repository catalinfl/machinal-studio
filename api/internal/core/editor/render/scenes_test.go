package render

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image/png"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/scenes"
)

func TestNativeLiveSceneCompositionExport(t *testing.T) {
	fixture := os.Getenv("SCENE_LIVE_FIXTURE")
	if fixture == "" {
		t.Skip("set SCENE_LIVE_FIXTURE and SCENE_SERVICE_URL for native live-scene export")
	}
	root := t.TempDir()
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	file := "ai_scene_" + strings.Repeat("c", 32) + "_01.scene.json"
	if err := os.WriteFile(filepath.Join(root, file), data, 0600); err != nil {
		t.Fatal(err)
	}
	asset, err := scenes.SourceAsset(root, file, "scene")
	if err != nil {
		t.Fatal(err)
	}
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=10:d=1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", filepath.Join(root, "ordinary.mp4"))
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-y", filepath.Join(root, "voice.wav"))
	parsed, err := document.Parse([]byte(`version: 1
mode: assemble
tracks:
  - id: video
    type: video
    clips:
      - {id: scene-clip, assetId: scene, start: 0s, inPoint: 0s, outPoint: 1s}
      - {id: ordinary-clip, assetId: ordinary.mp4, start: 1s, inPoint: 0s, outPoint: 1s}
  - id: voice
    type: audio
    clips:
      - {id: voice-clip, assetId: voice.wav, start: 0s, inPoint: 0s, outPoint: 2s}
output: {resolution: 480p, fps: 10, format: mp4, quality: normal}
`))
	if err != nil {
		t.Fatal(err)
	}
	result := compiler.New().Compile(compiler.Input{Document: parsed.Document, Assets: []document.Asset{asset, integrationAsset(t, root, "ordinary.mp4", "video", 1), integrationAsset(t, root, "voice.wav", "audio", 2)}})
	if result.Composition == nil {
		t.Fatalf("compile: %+v", result)
	}
	output, err := RenderComposition(context.Background(), *result.Composition, CompositionOptions{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	assertMediaDuration(t, output.Path, 2)
	assertDominantFrame(t, output.Path, "1.5", 2)
	if bytes.Equal(framePNG(t, output.Path, "0.1"), framePNG(t, output.Path, "0.8")) {
		t.Fatal("the scene animation froze during export")
	}
	if staged, _ := filepath.Glob(filepath.Join(root, "scene_export_*.mp4")); len(staged) != 0 {
		t.Fatal("temporary scene render leaked into source library")
	}
}

func TestExportMaterializesUniqueSceneOnceAndPreservesClipTiming(t *testing.T) {
	for _, transparent := range []bool{false, true} {
		t.Run(fmt.Sprintf("transparent=%t", transparent), func(t *testing.T) {
			testSceneMaterialization(t, transparent)
		})
	}
}

func testSceneMaterialization(t *testing.T, transparent bool) {
	t.Helper()
	root := t.TempDir()
	file := "ai_scene_" + strings.Repeat("a", 32) + "_01.scene.json"
	source := scenes.LiveSource{Version: 1, Component: "<p>Scene</p>", JavaScript: "preview bundle", Config: scenes.Config{Width: 320, Height: 180, FPS: 30, Frames: 60, Transparent: transparent}}
	data, _ := json.Marshal(source)
	if err := os.WriteFile(filepath.Join(root, file), data, 0600); err != nil {
		t.Fatal(err)
	}
	video := []byte("rendered only during export")
	hash := sha256.Sum256(video)
	manifest, _ := json.Marshal(map[string]any{"version": 1, "size": len(video), "sha256": hex.EncodeToString(hash[:]), "duration": 2, "width": 320, "height": 180, "fps": 30, "frames": 60, "scene": map[string]any{"version": 1, "sceneId": "generated", "config": source.Config}})
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/render" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		var input struct {
			Config scenes.Config `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.Config.Transparent != transparent {
			t.Error("render request lost transparency", err)
		}
		w.Header().Set("X-Scene-Manifest", base64.StdEncoding.EncodeToString(manifest))
		w.Write(video)
	}))
	defer server.Close()
	t.Setenv("SCENE_SERVICE_URL", server.URL)
	request := renderRequest{VideoChannels: []channel{{Clips: []clip{{File: file, InPoint: 0.5, OutPoint: 1.5, Start: 3}, {File: file, InPoint: 0, OutPoint: 2, Start: 6}}}}}
	result, err := materializeSceneClips(context.Background(), request, root, nil)
	if err != nil {
		t.Fatal(err)
	}
	clips := result.VideoChannels[0].Clips
	if calls != 1 || clips[0].File != clips[1].File || clips[0].File == file || clips[0].InPoint != 0.5 || clips[0].Start != 3 {
		t.Fatalf("calls=%d clips=%+v", calls, clips)
	}
	extension := ".mp4"
	if transparent {
		extension = ".webm"
	}
	if !strings.HasSuffix(clips[0].File, extension) || clips[0].sceneTransparent != transparent {
		t.Fatalf("materialized output lost transparency: %+v", clips[0])
	}
	if transparent && !strings.Contains(strings.Join(clipInputArgs(clips[0], clips[0].File), " "), "-c:v libvpx-vp9 -i") {
		t.Fatal("mask input must decode WebM alpha through libvpx")
	}
	if _, err := os.Stat(filepath.Join(root, file)); err != nil {
		t.Fatal("source removed", err)
	}
}

func TestNativeTransparentOverlayCompositionExport(t *testing.T) {
	fixture := os.Getenv("SCENE_OVERLAY_FIXTURE")
	if fixture == "" {
		t.Skip("set SCENE_OVERLAY_FIXTURE and SCENE_SERVICE_URL for native overlay composition export")
	}
	root := t.TempDir()
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	file := "ai_scene_" + strings.Repeat("f", 32) + "_01.scene.json"
	if err := os.WriteFile(filepath.Join(root, file), data, 0600); err != nil {
		t.Fatal(err)
	}
	asset, err := scenes.SourceAsset(root, file, "overlay")
	if err != nil {
		t.Fatal(err)
	}
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=10:d=2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", filepath.Join(root, "blue.mp4"))
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-y", filepath.Join(root, "voice.wav"))
	parsed, err := document.Parse([]byte(`version: 1
mode: assemble
tracks:
  - id: background
    type: video
    clips:
      - {id: footage, assetId: blue.mp4, start: 0s, inPoint: 0s, outPoint: 2s}
  - id: overlay
    type: video
    clips:
      - {id: effect, assetId: overlay, start: 0.5s, inPoint: 0s, outPoint: 1s}
  - id: narration
    type: audio
    clips:
      - {id: voice, assetId: voice.wav, start: 0s, inPoint: 0s, outPoint: 2s}
output: {resolution: 480p, fps: 10, format: mp4, quality: normal}
`))
	if err != nil {
		t.Fatal(err)
	}
	compiled := compiler.New().Compile(compiler.Input{Document: parsed.Document, Assets: []document.Asset{asset, integrationAsset(t, root, "blue.mp4", "video", 2), integrationAsset(t, root, "voice.wav", "audio", 2)}})
	if compiled.Composition == nil {
		t.Fatalf("compile: %+v", compiled)
	}
	output, err := RenderComposition(context.Background(), *compiled.Composition, CompositionOptions{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	assertMediaDuration(t, output.Path, 2)
	frame, err := png.Decode(bytes.NewReader(framePNG(t, output.Path, "0.7")))
	if err != nil {
		t.Fatal(err)
	}
	for _, sample := range []struct {
		x, y int
		rgb  [3]int
	}{
		{300, 150, [3]int{0, 0, 255}},
		{80, 90, [3]int{255, 0, 0}},
		{244, 40, [3]int{128, 0, 127}},
	} {
		r, g, b, _ := frame.At(sample.x*frame.Bounds().Dx()/320, sample.y*frame.Bounds().Dy()/180).RGBA()
		for channel, value := range []uint32{r, g, b} {
			if math.Abs(float64(int(value>>8)-sample.rgb[channel])) > 25 {
				t.Fatalf("pixel %d,%d = %d,%d,%d", sample.x, sample.y, r>>8, g>>8, b>>8)
			}
		}
	}
	assertDominantFrame(t, output.Path, "1.8", 2)
	if staged, _ := filepath.Glob(filepath.Join(root, "scene_export_*")); len(staged) != 0 {
		t.Fatalf("temporary alpha export leaked: %v", staged)
	}
}
