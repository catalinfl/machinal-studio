package compositions

import (
	"context"
	"errors"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/render/ffmpeg"
	"ffmpeg-go-server/internal/core/editor/render"
	"ffmpeg-go-server/internal/platform/credits"

	"github.com/gofiber/fiber/v2"
)

func TestPreviewAdmissionRejectsAmbiguousQueriesAndPendingGeneration(t *testing.T) {
	app := fiber.New()
	app.Post("/preview", MCPPreviewPolicy, func(c *fiber.Ctx) error { t.Fatal("invalid preview reached queue"); return nil })
	for _, query := range []string{"", "?previewStart=0", "?previewStart=0&previewStart=1&previewDuration=1", "?previewStart=NaN&previewDuration=1", "?previewStart=0&previewDuration=16", "?previewStart=0&previewDuration=1"} {
		request := httptest.NewRequest("POST", "/preview"+query, strings.NewReader("document: {version: 2, before: [{id: image, type: image.generate, prompt: Missing}]}"))
		request.Header.Set("Content-Type", "application/yaml")
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode < 400 {
			t.Fatal("invalid preview admitted", query, response.StatusCode)
		}
	}
}

func TestPreviewWorkerRechecksResolvedPlanBeforeAnyGeneration(t *testing.T) {
	app := fiber.New()
	app.Post("/preview", NewJobRunner().RunQueued(true))
	request := httptest.NewRequest("POST", "/preview?previewStart=0&previewDuration=1", strings.NewReader("document: {version: 2, before: [{id: image, type: image.generate, prompt: Missing}]}"))
	request.Header.Set("Content-Type", "application/yaml")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 422 {
		t.Fatal("pending generation was not rejected by worker", response.StatusCode)
	}
}

func TestPreviewCannotPretendPartialRenderBillingOrMutateCaptionGeometry(t *testing.T) {
	plan := composition.Result{Composition: &composition.Composition{Duration: document.Seconds(8), Output: document.Output{Format: "mp4", FPS: 30}, TextItems: []document.TextItem{{ID: "caption", Text: "Știință", Start: document.Seconds(2), Duration: document.Seconds(2)}}}}
	before := plan.Composition.TextItems[0]
	if err := validatePreviewPlan(render.PreviewWindow{Start: 2, Duration: 1}, plan); err != nil {
		t.Fatal(err)
	}
	if plan.Composition.Duration != document.Seconds(8) || plan.Composition.TextItems[0].Text != before.Text || plan.Composition.TextItems[0].Start != before.Start || plan.Composition.TextItems[0].Duration != before.Duration {
		t.Fatal("preview altered full timeline/caption basis")
	}
	if _, ok := render.PreviewFromContext(context.Background()); ok {
		t.Fatal("normal render acquired preview mode")
	}
}

func TestPreviewChargesProcessingWindowWithoutChangingOriginalComposition(t *testing.T) {
	store, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Begin("alice", "preview-full-basis", true); err != nil {
		t.Fatal(err)
	}
	ctx := credits.WithMeter(context.Background(), &credits.Meter{Store: store, Owner: "alice", ID: "preview-full-basis", Pricing: credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}})
	ctx = credits.WithWorkflowPolicy(ctx, credits.MCPServerRender)
	ctx = render.WithPreviewWindow(ctx, render.PreviewWindow{Start: 10, Duration: 1})
	runner := NewJobRunner()
	called := false
	runner.render = func(ctx context.Context, _ string, plan composition.Composition, _ func(float64, string)) (ffmpeg.Output, error) {
		called = true
		usage, err := store.Operation("alice", "preview-full-basis")
		if err != nil || usage.Render != 0 || usage.RenderUsage["render"].DurationSeconds != 1 || plan.Duration != document.Seconds(120) {
			t.Fatal("preview did not bill its actual processing window", usage, err, plan.Duration)
		}
		window, ok := render.PreviewFromContext(ctx)
		if !ok || window.Duration != 1 {
			t.Fatal("excerpt context lost", window)
		}
		return ffmpeg.Output{}, errors.New("intentional stop before encoding/publication")
	}
	app := fiber.New()
	app.Post("/preview", func(c *fiber.Ctx) error {
		return runner.renderQueued(c, ctx, t.TempDir(), "", composition.Result{Composition: &composition.Composition{Duration: document.Seconds(120)}})
	})
	response, err := app.Test(httptest.NewRequest("POST", "/preview", nil))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 502 || !called {
		t.Fatal("render test did not reach charged stage", response.StatusCode)
	}
}
