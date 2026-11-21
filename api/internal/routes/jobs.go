package routes

import (
	"encoding/hex"
	"encoding/json"
	"ffmpeg-go-server/internal/core/billing"
	"ffmpeg-go-server/internal/core/editor/ai"
	"ffmpeg-go-server/internal/core/editor/compositions"
	"ffmpeg-go-server/internal/core/editor/imagegen"
	"ffmpeg-go-server/internal/core/editor/render"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/core/editor/speech"
	"ffmpeg-go-server/internal/core/editor/subtitles"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/sessions"
	"github.com/gofiber/fiber/v2"
)

func newJobService(accountBilling *billing.Handler) *jobqueue.Service {
	renders := compositions.NewJobRunner()
	sceneJobs := scenes.NewRunner()
	tasks := map[string]jobqueue.Task{
		"render":            jobqueue.FiberTask(renders.RunQueued(false)),
		"automation-render": jobqueue.FiberTask(renders.RunQueued(true)),
		"editor-render":     retainEditorRender(jobqueue.FiberTask(render.RunQueued)),
		"compile-generate":  jobqueue.FiberTask(compositions.CompileAndGenerate),
		"ai-composition":    jobqueue.FiberTask(ai.EditComposition),
		"ai-edit":           jobqueue.FiberTask(ai.Edit),
		"ai-image":          jobqueue.FiberTask(imagegen.Generate),
		"ai-speech":         jobqueue.FiberTask(speech.Generate),
		"ai-subtitles":      jobqueue.FiberTask(subtitles.Generate),
		"ai-scene":          jobqueue.FiberTask(sceneJobs.RunQueued),
		"scene-compile":     jobqueue.FiberTask(sceneJobs.CompileSource),
	}
	options := jobqueue.Options{}
	if accountBilling != nil {
		options.Prepare = accountBilling.PrepareJob
	}
	return jobqueue.New(jobqueue.PocketBaseFromEnv(), tasks, options)
}

func downloadJob(jobs *jobqueue.Service) fiber.Handler {
	return withRenderOutput(jobs, func(c *fiber.Ctx, name string) error {
		c.Request().URI().QueryArgs().Set("file", name)
		return media.SignedDownload(c)
	})
}

func withRenderOutput(jobs *jobqueue.Service, handle func(*fiber.Ctx, string) error) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if id, err := hex.DecodeString(c.Params("id")); err != nil || len(id) != 16 {
			return fiber.ErrNotFound
		}
		job, err := jobs.Store.Get(c.UserContext(), auth.UserID(c), sessions.FromRequest(c), c.Params("id"))
		if err != nil {
			return fiber.ErrNotFound
		}
		if job.Status != "completed" {
			return fiber.NewError(fiber.StatusConflict, "This job has no completed download yet.")
		}
		if job.Kind != "render" && job.Kind != "editor-render" && job.Kind != "automation-render" {
			return fiber.ErrNotFound
		}
		var result struct {
			Filename string `json:"filename"`
			File     string `json:"file"`
		}
		if json.Unmarshal(job.Result, &result) != nil {
			return fiber.ErrNotFound
		}
		name := result.Filename
		if name == "" {
			name = result.File
		}
		if !sessions.IsRenderOutput(name) {
			return fiber.ErrNotFound
		}
		return handle(c, name)
	}
}

func jobService(existing []*jobqueue.Service) *jobqueue.Service {
	if len(existing) > 0 {
		return existing[0]
	}
	return newJobService(nil)
}
