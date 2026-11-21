package render

import (
	"log"
	"time"

	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

func RunQueued(c *fiber.Ctx) error {
	jobqueue.ReportStage(c.UserContext(), 0, "Preparing sources and render plan", jobqueue.Stage{Name: "preparing", Scope: "job"})
	req, err := parseRenderRequest(c.Body())
	if err != nil {
		return fiber.NewError(400, err.Error())
	}
	req, err = normalizeOutputRequest(req)
	if err != nil {
		return fiber.NewError(400, err.Error())
	}
	session := sessions.FromRequest(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	scope := scopeForRequest(session)
	scope.warm(c.UserContext(), collectAllClips(req))
	plan, err := prepareRenderPlan(req, scope)
	if err != nil {
		return fiber.NewError(400, err.Error())
	}
	if err := credits.ChargeRender(c.UserContext(), plan.totalDuration); err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Rendering credit pricing is unavailable.")
	}
	progress := newRenderProgress(estimateRenderWork(req, plan), func(ratio float64, message string) {
		jobqueue.ReportStage(c.UserContext(), ratio, message, jobqueue.Stage{Name: ProgressStage(message), Scope: "job"})
	})
	progress.ctx = c.UserContext()
	filename, path, err := executeRender(req, plan, progress)
	if err != nil {
		credits.RefundRender(c.UserContext())
		return fiber.NewError(502, "Media processing failed.")
	}
	jobqueue.ReportStage(c.UserContext(), 0.98, "Saving video to cloud storage", jobqueue.Stage{Name: "publication", Scope: "job"})
	publishStarted := time.Now()
	err = objectstore.PublishFile(c.UserContext(), path, objectstore.RenderKey(sessions.S3Prefix(session), filename))
	log.Printf("render_publication job=%q elapsed_ms=%d success=%t", jobqueue.ID(c.UserContext()), time.Since(publishStarted).Milliseconds(), err == nil)
	if err != nil {
		credits.RefundRender(c.UserContext())
		return fiber.NewError(502, "Cloud persistence failed. The local render was kept.")
	}
	return c.JSON(fiber.Map{"filename": filename})
}
