package compositions

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/render/ffmpeg"
	"ffmpeg-go-server/internal/platform/credits"

	"github.com/gofiber/fiber/v2"
)

func TestQueuedRenderReportsRenderingFailureWithoutExposingInternalPaths(t *testing.T) {
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previous) })
	runner := NewJobRunner()
	runner.render = func(context.Context, string, composition.Composition, func(float64, string)) (ffmpeg.Output, error) {
		return ffmpeg.Output{}, errors.New("materialize scene: FFmpeg: No space left on device at /private/render.mp4")
	}
	root := t.TempDir()
	app := fiber.New()
	app.Post("/render", func(c *fiber.Ctx) error {
		return runner.renderQueued(c, c.UserContext(), root, "", composition.Result{
			Composition: &composition.Composition{Duration: document.Second},
		})
	})
	response, err := app.Test(httptest.NewRequest("POST", "/render", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusBadGateway || !strings.Contains(string(body), "Video rendering failed") {
		t.Fatalf("unexpected response: %d %s", response.StatusCode, body)
	}
	if strings.Contains(string(body), "/private") || strings.Contains(string(body), "cloud") {
		t.Fatalf("response leaked internals or blamed cloud storage: %s", body)
	}
	if !strings.Contains(logs.String(), `stage="render"`) || !strings.Contains(logs.String(), "No space left on device") {
		t.Fatalf("missing internal render diagnostic: %s", &logs)
	}
}

func TestQueuedRenderCloudFailureHasSeparatePublicMessage(t *testing.T) {
	err := queuedRenderFailure(context.Background(), "cloud_publish", errors.New("private storage failure"))
	var response *fiber.Error
	if !errors.As(err, &response) || response.Code != fiber.StatusBadGateway || response.Message != "Cloud persistence failed. The local render was kept." {
		t.Fatalf("unexpected cloud failure: %v", err)
	}
}

func TestQueuedRenderFailureRefundsChargeAtEitherStage(t *testing.T) {
	for _, stage := range []string{"render", "cloud_publish"} {
		t.Run(stage, func(t *testing.T) {
			store, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { store.Close() })
			if err := store.Begin("alice", stage, true); err != nil {
				t.Fatal(err)
			}
			ctx := credits.WithMeter(context.Background(), &credits.Meter{
				Store: store, Owner: "alice", ID: stage, DeferredUsage: true,
				Pricing: credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "10"},
			})
			if err := credits.ChargeRender(ctx, 60); err != nil {
				t.Fatal(err)
			}
			queuedRenderFailure(ctx, stage, errors.New("processing failed"))
			pending, err := store.Pending("alice")
			if err != nil || pending.Render != 0 {
				t.Fatalf("failed render charge was retained: %+v %v", pending, err)
			}
		})
	}
}
