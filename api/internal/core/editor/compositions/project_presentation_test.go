package compositions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/render/ffmpeg"
	"ffmpeg-go-server/internal/core/editor/render"
	"ffmpeg-go-server/internal/core/projects"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func TestSuccessfulGenerationPreparesProjectWithoutRendering(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	project, err := projects.NewStore().Create("alice", "Generated film")
	if err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Post("/generate", func(c *fiber.Ctx) error {
		c.Locals("pbUserId", "alice")
		return CompileAndGenerate(c)
	})
	body := []byte(`{"document":{"version":1,"mode":"assemble","inputs":{"shots":{"kind":"image","multiple":true}},"sequence":{"use":"shots","each":{"take":{"from":0,"duration":5}}},"texts":[{"id":"title","text":"Știință și țară","start":0,"duration":2}]},"bindings":{"shots":["image"]},"assets":[{"id":"image","file":"image.png","version":"v1","kind":"image"}]}`)
	request := httptest.NewRequest("POST", "/generate", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Session-Id", project.SessionID)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result composition.Result
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || result.Composition == nil {
		t.Fatalf("generation: %d %+v", response.StatusCode, result)
	}
	saved, err := projects.NewPresentationStore().Load(context.Background(), "alice", project.SessionID)
	if err != nil || saved.Prepared == nil || saved.LastRender != nil {
		t.Fatalf("prepared project: %+v %v", saved, err)
	}
	if saved.Prepared.Composition.ID != result.Composition.ID || saved.Prepared.Document.Texts[0].Text != "Știință și țară" || len(saved.Prepared.Bindings["shots"]) != 1 {
		t.Fatal("prepared project lost its exact composition, captions or bindings")
	}
	opened, err := projects.NewStore().Get("alice", project.ID)
	var state struct {
		Timeline struct {
			Channels []struct {
				Clips []struct {
					FileName string `json:"fileName"`
				} `json:"clips"`
			} `json:"channels"`
		} `json:"timeline"`
		Media []struct{ Name string } `json:"media"`
	}
	if err != nil || json.Unmarshal(opened.State, &state) != nil || len(state.Timeline.Channels) != 1 || len(state.Timeline.Channels[0].Clips) != 1 || len(state.Media) != 1 || state.Media[0].Name != "image.png" {
		t.Fatalf("generation did not save an actual editable project: %s %v", opened.State, err)
	}
}

func TestCompletedRenderRetainsExactSnapshotButPreviewAndFailureDoNotReplaceIt(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	t.Setenv("S3_ENDPOINT", "")
	project, err := projects.NewStore().Create("alice", "Rendered film")
	if err != nil {
		t.Fatal(err)
	}
	runner := NewJobRunner()
	runner.render = func(ctx context.Context, _ string, _ composition.Composition, _ func(float64, string)) (ffmpeg.Output, error) {
		if ctx.Value("fail") == true {
			return ffmpeg.Output{}, errors.New("fixture failure")
		}
		return ffmpeg.Output{Filename: "render_fixture.mp4", Path: "unused-without-cloud"}, nil
	}
	app := fiber.New()
	app.Post("/:mode", func(c *fiber.Ctx) error {
		c.Locals("pbUserId", "alice")
		ctx := c.UserContext()
		if c.Params("mode") == "preview" {
			ctx = render.WithPreviewWindow(ctx, render.PreviewWindow{Duration: 1})
		}
		if c.Params("mode") == "fail" {
			ctx = context.WithValue(ctx, "fail", true)
		}
		id := c.Params("mode")
		return runner.renderQueued(c, ctx, storage.DataDir, project.SessionID, composition.Result{
			Document: &document.Document{Version: 1}, Composition: &composition.Composition{ID: id, Duration: document.Second},
		})
	})
	for _, mode := range []string{"final", "preview", "fail"} {
		request := httptest.NewRequest("POST", "/"+mode, nil)
		request.Header.Set("X-Session-Id", project.SessionID)
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		want := fiber.StatusOK
		if mode == "fail" {
			want = fiber.StatusBadGateway
		}
		if response.StatusCode != want {
			t.Fatalf("%s: status %d", mode, response.StatusCode)
		}
		saved, err := projects.NewPresentationStore().Load(context.Background(), "alice", project.SessionID)
		if err != nil || saved.LastRender == nil || saved.LastRender.Composition.ID != "final" || saved.Prepared.Composition.ID != "final" {
			t.Fatalf("%s replaced final snapshot: %+v %v", mode, saved, err)
		}
		opened, err := projects.NewStore().Get("alice", project.ID)
		var state struct {
			PreparedCompositionID string `json:"preparedCompositionId"`
		}
		if err != nil || json.Unmarshal(opened.State, &state) != nil || state.PreparedCompositionID != "final" || opened.Version != 2 {
			t.Fatalf("%s changed or failed to persist final timeline: %s %v", mode, opened.State, err)
		}
	}
}
