package compositions

import (
	"context"
	"log"
	"time"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/render"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

func (runner *JobRunner) RunQueued(generate bool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		jobqueue.ReportStage(c.UserContext(), 0, "Preparing sources, recipe actions and text", jobqueue.Stage{Name: "preparing", Scope: "job"})
		input, parsed, err := ParseProject(c.Body())
		if err != nil {
			return parseError(c, err)
		}
		root, session := sessions.ResolveRoot(c)
		ctx := c.UserContext()
		preview, err := previewQuery(c)
		if err != nil {
			return err
		}
		var result composition.Result
		if preview != nil {
			result = WithPositions(engine.Compile(input), parsed)
			if err := validatePreviewPlan(*preview, result); err != nil {
				return fiber.NewError(fiber.StatusUnprocessableEntity, err.Error())
			}
			result, err = prepareAutomationRender(ctx, input, root, session)
			if err != nil {
				return fiber.NewError(fiber.StatusUnprocessableEntity, "Preview source or text preparation failed; no new generation was requested.")
			}
			ctx = render.WithPreviewWindow(ctx, *preview)
		} else if generate {
			result, err = prepareAutomationRender(ctx, input, root, session)
			if err != nil {
				if !HasErrors(result) {
					result.Diagnostics = append(result.Diagnostics, document.Diagnostic{Path: "render", Code: "preparation_failed", Message: err.Error(), Severity: "error"})
				}
				return c.Status(fiber.StatusUnprocessableEntity).JSON(result)
			}
		} else {
			result = WithPositions(engine.Compile(input), parsed)
			if result.Composition == nil {
				return c.Status(422).JSON(result)
			}
			if _, err := result.Composition.PreparedText.Resolve(result.Composition.TextItems, result.Composition.Output); err != nil {
				return fiber.NewError(422, err.Error())
			}
		}
		for _, asset := range result.Composition.Assets {
			media.WarmSession(ctx, session, root, asset.File)
		}
		return runner.renderQueued(c, ctx, root, session, result)
	}
}

func (runner *JobRunner) renderQueued(c *fiber.Ctx, ctx context.Context, root, session string, result composition.Result) error {
	if err := credits.ChargeRender(ctx, result.Composition.Duration.Seconds()); err != nil {
		return fiber.NewError(402, "Not enough credits for this render.")
	}
	output, err := runner.render(ctx, root, *result.Composition, func(ratio float64, message string) {
		jobqueue.ReportStage(ctx, ratio, message, jobqueue.Stage{Name: render.ProgressStage(message), Scope: "job"})
	})
	if err != nil {
		return queuedRenderFailure(ctx, "render", err)
	}
	jobqueue.ReportStage(ctx, 0.98, "Saving video to cloud storage", jobqueue.Stage{Name: "publication", Scope: "job"})
	publishStarted := time.Now()
	err = objectstore.PublishFile(ctx, output.Path, objectstore.RenderKey(sessions.S3Prefix(session), output.Filename))
	log.Printf("render_publication job=%q elapsed_ms=%d success=%t", jobqueue.ID(ctx), time.Since(publishStarted).Milliseconds(), err == nil)
	if err != nil {
		return queuedRenderFailure(ctx, "cloud_publish", err)
	}
	jobqueue.ReportStage(ctx, 0.99, "Finalizing usage accounting", jobqueue.Stage{Name: "accounting", Scope: "job"})
	response := fiber.Map{"filename": output.Filename, "compositionId": result.Composition.ID,
		"documentRevision": result.Document.Revision, "cost": completedRenderCost(ctx)}
	if preview, present := render.PreviewFromContext(ctx); present {
		response["preview"] = preview
		response["billingBasis"] = "complete-composition-duration; referenced scenes retain full scene-render billing"
		response["processedDuration"] = result.Composition.Duration.Seconds()
	} else {
		retainProjectComposition(c, result, output.Filename)
	}
	return c.JSON(response)
}

func queuedRenderFailure(ctx context.Context, stage string, err error) error {
	credits.RefundRender(ctx)
	log.Printf("composition_render_failed job=%q stage=%q error=%q", jobqueue.ID(ctx), stage, err)
	if stage == "cloud_publish" {
		return fiber.NewError(fiber.StatusBadGateway, "Cloud persistence failed. The local render was kept.")
	}
	if diagnostic := scenes.PublicServiceDiagnostic(err); diagnostic != "" {
		return fiber.NewError(fiber.StatusBadGateway, diagnostic)
	}
	return fiber.NewError(fiber.StatusBadGateway, "Video rendering failed. Existing source assets were kept.")
}
