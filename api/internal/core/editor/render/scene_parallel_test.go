package render

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ffmpeg-go-server/internal/core/editor/scenes"
)

func writeCaptureScene(t *testing.T, root, letter string) string {
	t.Helper()
	name := "ai_scene_" + strings.Repeat(letter, 32) + "_01.scene.json"
	source := scenes.LiveSource{Version: 1, Component: "<p>Scene</p>", JavaScript: "preview", Config: scenes.Config{Width: 320, Height: 180, FPS: 30, Frames: 60}}
	data, err := json.Marshal(source)
	if err == nil {
		err = os.WriteFile(filepath.Join(root, name), data, 0600)
	}
	if err != nil {
		t.Fatal(err)
	}
	return name
}

func captureResponse(w http.ResponseWriter, config scenes.Config, capture *scenes.CaptureRange) {
	if capture != nil {
		config.Frames = capture.EndFrame - capture.StartFrame
	}
	video := []byte("synthetic scene video")
	hash := sha256.Sum256(video)
	manifest, _ := json.Marshal(map[string]any{"version": 1, "size": len(video), "sha256": hex.EncodeToString(hash[:]), "duration": float64(config.Frames) / config.FPS,
		"width": config.Width, "height": config.Height, "fps": config.FPS, "frames": config.Frames,
		"scene": map[string]any{"version": 1, "sceneId": "generated", "config": config}})
	w.Header().Set("X-Scene-Manifest", base64.StdEncoding.EncodeToString(manifest))
	w.Write(video)
}

func TestSceneCaptureRangePreservesOriginalConfigAndRebasesOnlySourceTime(t *testing.T) {
	root := t.TempDir()
	file := writeCaptureScene(t, root, "d")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Config scenes.Config        `json:"config"`
			Range  *scenes.CaptureRange `json:"range"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if input.Config.Frames != 60 || input.Range == nil || *input.Range != (scenes.CaptureRange{StartFrame: 15, EndFrame: 45}) {
			t.Error("capture changed authored config or captured unused frames", input)
		}
		captureResponse(w, input.Config, input.Range)
	}))
	defer server.Close()
	t.Setenv("SCENE_SERVICE_URL", server.URL)
	req := renderRequest{VideoChannels: []channel{{Clips: []clip{{File: file, Start: 10, InPoint: 0.5, OutPoint: 1.5, Segments: []segment{{SrcStart: 0.5, SrcEnd: 1.5}}}}}}}
	result, err := materializeSceneClips(context.Background(), req, root, nil)
	if err != nil {
		t.Fatal(err)
	}
	moving := result.VideoChannels[0].Clips[0]
	if moving.Start != 10 || moving.InPoint != 0 || moving.OutPoint != 1 || moving.Segments[0].SrcStart != 0 || moving.Segments[0].SrcEnd != 1 {
		t.Fatal("capture rebased timeline time or lost effect source offsets", moving)
	}
	original, err := scenes.ReadSource(root, file)
	if err != nil || original.Config.Frames != 60 {
		t.Fatal("capture mutated saved source", original.Config, err)
	}
}

func TestSceneMaterializationSubmitsAtMostTwoIndependentCaptures(t *testing.T) {
	root := t.TempDir()
	var clips []clip
	for _, letter := range []string{"a", "b", "c"} {
		clips = append(clips, clip{File: writeCaptureScene(t, root, letter), InPoint: 0, OutPoint: 2})
	}
	started, release := make(chan struct{}, 3), make(chan struct{})
	var active, maximum atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := active.Add(1)
		defer active.Add(-1)
		for before := maximum.Load(); current > before && !maximum.CompareAndSwap(before, current); before = maximum.Load() {
		}
		started <- struct{}{}
		<-release
		captureResponse(w, scenes.Config{Width: 320, Height: 180, FPS: 30, Frames: 60}, nil)
	}))
	defer server.Close()
	t.Setenv("SCENE_SERVICE_URL", server.URL)
	done := make(chan error, 1)
	go func() {
		_, err := materializeSceneClips(context.Background(), renderRequest{VideoChannels: []channel{{Clips: clips}}}, root, nil)
		done <- err
	}()
	for range 2 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			close(release)
			<-done
			t.Fatal("independent scene requests were serialized by the API")
		}
	}
	select {
	case <-started:
		t.Error("scene materialization exceeded its two-request bound")
	default:
	}
	close(release)
	if err := <-done; err != nil || maximum.Load() != 2 {
		t.Fatal(err, maximum.Load())
	}
}
