package compositions

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/imagegen"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const emptyTimelineImageProject = `document:
  version: 2
  mode: assemble
  tracks:
    - {id: v1, type: video, name: Video 1, clips: []}
    - {id: a1, type: audio, name: Audio 1, clips: []}
  before:
    - id: image-1
      type: image.generate
      prompt: dfsf
      model: openai/gpt-image-2.6-sunburst
      aspect: 16:9
      background: opaque
      imageStyle: ""
  placements:
    - job: image-1
      track: {type: video, role: overlay-image-1}
      start: 0
      duration: 5
      transform:
        zoomX: 0.62
        zoomY: 0.62
        linkZoom: true
        positionX: 0
        positionY: 0
        rotation: 0
        anchorX: 0.5
        anchorY: 0.5
        pitch: 0
        yaw: 0
        flipH: false
        flipV: false
bindings: {}
assets: []
`

func TestCompileAndGenerateStagedImageOnEmptyTimeline(t *testing.T) {
	calls := 0
	previous := generateImageCall
	generateImageCall = func(_ context.Context, _ string, safeJoin func(string) (string, error), prompt, model, aspect, background string) (imagegen.GeneratedImage, error) {
		calls++
		if prompt != "dfsf" || model != "openai/gpt-image-2.6-sunburst" || aspect != "16:9" || background != "opaque" {
			t.Errorf("unexpected generation settings: %q %q %q %q", prompt, model, aspect, background)
		}
		path, err := safeJoin("empty-timeline-image.png")
		if err != nil {
			return imagegen.GeneratedImage{}, err
		}
		if err := os.WriteFile(path, []byte("test-image"), 0600); err != nil {
			return imagegen.GeneratedImage{}, err
		}
		return imagegen.GeneratedImage{Name: "empty-timeline-image.png", Width: 64, Height: 32}, nil
	}
	t.Cleanup(func() { generateImageCall = previous })

	app := fiber.New()
	app.Post("/compositions/compile-and-generate", CompileAndGenerate)
	for _, start := range []document.Time{0, 2 * document.Second} {
		t.Run(fmt.Sprintf("start_%gs", start.Seconds()), func(t *testing.T) {
			input, _, err := ParseProject([]byte(emptyTimelineImageProject))
			if err != nil {
				t.Fatal(err)
			}
			input.Document.Placements[0].Start = start
			body, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			session := sessions.NewID()
			t.Cleanup(func() {
				if err := sessions.Evict(session); err != nil {
					t.Error(err)
				}
			})
			before := calls
			result := stagedImageRequest(t, app, session, body)
			if calls != before+1 || result.Composition == nil {
				t.Fatalf("image was not generated and compiled: calls=%d result=%+v", calls-before, result)
			}
			resolved := result.Composition
			if resolved.Duration != start+5*document.Second || len(resolved.Tracks) != 3 {
				t.Fatalf("unexpected generated timeline: %+v", resolved)
			}
			clip := resolved.Tracks[2].Clips[0]
			if clip.Start != start || clip.Duration() != 5*document.Second || clip.Transform.ZoomX != 0.62 || clip.Transform.ZoomY != 0.62 {
				t.Fatalf("placement timing or transform changed: %+v", clip)
			}
			body, err = json.Marshal(compiler.Input{Document: *result.Document, Bindings: document.Bindings{}, Assets: resolved.Assets})
			if err != nil {
				t.Fatal(err)
			}
			replayed := stagedImageRequest(t, app, session, body)
			if calls != before+1 || replayed.Composition == nil || replayed.Composition.ID != resolved.ID {
				t.Fatalf("saved result regenerated or changed: %+v", replayed)
			}
		})
	}
}

func stagedImageRequest(t *testing.T, app *fiber.App, session string, body []byte) composition.Result {
	t.Helper()
	request := httptest.NewRequest("POST", "/compositions/compile-and-generate", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Session-Id", session)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result composition.Result
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status=%d diagnostics=%+v requirements=%+v", response.StatusCode, result.Diagnostics, result.Requirements)
	}
	return result
}

func TestCompileAndGenerateStagedSceneAndReplay(t *testing.T) {
	previous := generateSceneCall
	t.Cleanup(func() { generateSceneCall = previous })
	image := scenes.SceneImage{ID: "image_1", File: "product.png", Name: "Product", Description: "Keep this image inside the moving card"}
	app := fiber.New()
	app.Post("/compositions/compile-and-generate", CompileAndGenerate)
	for _, kind := range []string{"scene.generate", "scene.edit"} {
		t.Run(kind, func(t *testing.T) {
			calls := 0
			original := "ai_scene_" + strings.Repeat("a", 32) + "_01.scene.json"
			generateSceneCall = func(_ context.Context, session, root string, request scenes.Request) (scenes.Scene, error) {
				calls++
				if request.Prompt != "Blue tree" || request.Duration != 2.01 || request.Width != 1080 || request.Height != 1920 || request.FPS != 24 {
					t.Errorf("lost scene settings: %+v", request)
				}
				if kind == "scene.edit" && request.SourceFile != original {
					t.Errorf("wrong scene source: %s", request.SourceFile)
				}
				if kind == "scene.generate" && (len(request.Images) != 1 || request.Images[0] != image) {
					t.Errorf("lost scene image attachment: %+v", request.Images)
				}
				generated := scenes.Scene{Asset: document.Asset{ID: "new-scene", File: "ai_scene_" + strings.Repeat("b", 32) + "_01.scene.json", Version: "v2", Kind: "video", Duration: document.Seconds(49.0 / 24)}}
				if kind == "scene.edit" {
					if err := os.WriteFile(filepath.Join(root, "voice.wav"), []byte("voice"), 0600); err != nil {
						return scenes.Scene{}, err
					}
					generated.Source = &scenes.LiveSource{Audio: &scenes.Narration{File: "voice.wav", Start: 3, Duration: 10}}
				}
				return generated, nil
			}
			input := compiler.Input{Bindings: document.Bindings{}, Document: document.Document{Version: 1, Mode: "assemble", Output: document.Output{Aspect: "portrait", FPS: 24},
				Before:     []document.Job{{ID: "scene", Type: kind, Prompt: "Blue tree", AssetID: "original", Duration: document.Seconds(2.01)}},
				Placements: []document.Placement{{Job: "scene", Track: document.PlacementTrack{Type: "video", Role: "scene"}, Start: document.Second}}},
				Assets: []document.Asset{{ID: "original", File: original, Version: "v1", Kind: "video", Duration: 3 * document.Second}}}
			if kind == "scene.generate" {
				input.Document.Before[0].Images = []document.SceneImage{{ID: image.ID, File: image.File, Name: image.Name, Description: image.Description}}
			}
			body, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			session := sessions.NewID()
			t.Cleanup(func() {
				if err := sessions.Evict(session); err != nil {
					t.Error(err)
				}
			})
			result := stagedImageRequest(t, app, session, body)
			if result.Document.Version != 1 || result.Composition == nil || calls != 1 || result.Composition.Duration != document.Seconds(3.01) {
				t.Fatalf("scene generation failed or changed version: %+v", result)
			}
			if kind == "scene.edit" {
				audio := result.Composition.Tracks[1].Clips[0]
				if audio.InPoint != 3*document.Second || audio.Start != document.Second || audio.LinkedClipID == "" {
					t.Fatalf("lost scene narration: %+v", audio)
				}
			}
			body, err = json.Marshal(compiler.Input{Document: *result.Document, Bindings: document.Bindings{}, Assets: result.Composition.Assets})
			if err != nil {
				t.Fatal(err)
			}
			replayed := stagedImageRequest(t, app, session, body)
			if replayed.Composition == nil || replayed.Composition.ID != result.Composition.ID || calls != 1 {
				t.Fatalf("scene regenerated during replay: %+v", replayed)
			}
		})
	}
}
