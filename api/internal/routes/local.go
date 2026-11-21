package routes

import (
	"context"
	"errors"
	"os"

	"ffmpeg-go-server/internal/core/editor/compositions"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/core/editor/scrub"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/core/preferences"
	"ffmpeg-go-server/internal/core/projects"
	"ffmpeg-go-server/internal/core/settings"
	"ffmpeg-go-server/internal/core/toolrouting"
	"ffmpeg-go-server/internal/platform/delivery"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/localaccess"
	"ffmpeg-go-server/internal/platform/sessions"
	"github.com/gofiber/fiber/v2"
)

func RegisterLocal(app *fiber.App, ai *settings.Service, queue *jobqueue.Local) {
	registerHealthRoutes(app)
	app.Get("/runtime", localRuntime)
	app.Get("/settings/openrouter", ai.Status)
	app.Post("/settings/openrouter", requestLimiter(5, rateWindow, "Key verification rate limit exceeded"), ai.Save)
	store := projects.NewStore()
	app.Get("/projects", store.ListHandler)
	app.Post("/projects", store.CreateHandler)
	app.Get("/projects/:projectID", store.GetHandler)
	app.Post("/projects/:projectID", store.SaveHandler)
	jobs := localJobs(queue)
	store.Presentations.Jobs = jobs.Store
	registerLocalEditor(app, jobs)
	registerLocalAutomation(app, store, jobs)
	jobs.Start(context.Background())
	app.Hooks().OnShutdown(func() error { return errors.Join(jobs.Close(), queue.Close()) })
}

func localRuntime(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"mode": "local", "applicationKeyRequired": false,
		"accountRequired": false, "billing": "none", "storage": "volume", "cloudStorage": false,
		"ai": fiber.Map{"provider": "openrouter", "configured": os.Getenv("OPENROUTER_API_KEY") != "", "payment": "user-provider-account"}})
}

func registerLocalEditor(app *fiber.App, jobs *jobqueue.Service) {
	app.Use(localaccess.ProjectSession)
	app.Post("/sessions", sessions.Create)
	app.Post("/sessions/:id/heartbeat", func(c *fiber.Ctx) error {
		id := c.Params("id")
		owner, ok := sessions.OwnerOf(id)
		if id != localaccess.DefaultSession && (!ok || owner != localaccess.Owner) {
			return fiber.ErrNotFound
		}
		return sessions.Heartbeat(c)
	})
	app.Post("/upload", requestLimiter(30, rateWindow, "Upload rate limit exceeded"), media.Upload)
	app.Get("/list", media.List)
	app.Get("/download", downloadSource)
	app.Delete("/media", media.Delete)
	app.Get("/media-metadata", media.MediaMetadata)
	app.Get("/thumbnail", media.Thumbnail)
	app.Get("/audio-preview", media.AudioPreview)
	app.Get("/waveform", media.Waveform)
	app.Get("/scrub-proxy", scrub.Proxy)
	app.Get("/compositions/capabilities", compositions.Capabilities)
	app.Get("/compositions/schema", compositions.Schema)
	app.Post("/compositions/validate", compositions.Validate)
	app.Post("/compositions/compile", compositions.Compile)
	app.Post("/compositions/assets", compositions.AssetMetadata)
	for path, kind := range map[string]string{
		"/render": "editor-render", "/renders": "render", "/compositions/compile-and-generate": "compile-generate",
		"/ai/edit": "ai-edit", "/ai/compositions": "ai-composition", "/ai/images": "ai-image",
		"/ai/speech": "ai-speech", "/ai/subtitles": "ai-subtitles", "/ai/scenes": "ai-scene",
	} {
		app.Post(path, requestLimiter(20, rateWindow, "Job submission rate limit exceeded"), jobs.Submit(kind, false))
	}
	app.Get("/renders/:id", jobs.Status)
	app.Get("/ai/scenes/:id", jobs.Status)
	app.Delete("/ai/scenes/:id", jobs.Cancel)
	app.Get("/jobs", jobs.List)
	app.Get("/jobs/:id", jobs.Status)
	app.Get("/jobs/:id/download", downloadLocalJob(jobs))
	app.Delete("/jobs/:id", jobs.Cancel)
}

func registerLocalAutomation(app *fiber.App, store *projects.Store, jobs *jobqueue.Service) {
	api := app.Group("/v1", requestLimiter(300, rateWindow, "API rate limit exceeded"))
	api.Get("/runtime", localRuntime)
	downloads := preferences.NewDownloads()
	api.Get("/preferences/downloads", downloads.Get)
	api.Post("/preferences/downloads", downloads.Save)
	workflows := preferences.NewWorkflows()
	api.Get("/preferences/workflow", workflows.Get)
	api.Post("/preferences/workflow", workflows.Save)
	api.Get("/projects", store.ListHandler)
	api.Post("/projects", store.CreateHandler)
	api.Get("/compositions/schema", compositions.Schema)
	api.Get("/compositions/capabilities", compositions.Capabilities)
	api.Post("/ai/tool-selection", toolrouting.Validate, toolrouting.Select)
	project := api.Group("/projects/:projectID", store.ScopeAPI)
	project.Get("/", store.GetHandler)
	project.Post("/", store.SaveHandler)
	project.Post("/upload", media.Upload)
	roots := media.NewLocalSources(os.Getenv("LOCAL_MEDIA_ROOTS_JSON"))
	project.Get("/media/local", roots.List)
	project.Post("/media/local/inspect", roots.Inspect)
	project.Post("/media/local/import", roots.Import)
	project.Get("/media", media.List)
	project.Get("/media/catalog", media.Catalog)
	project.Get("/media/file", media.DescribeFile)
	project.Delete("/media", media.Delete)
	project.Get("/download", downloadSource)
	project.Post("/compositions/assets", compositions.AssetMetadata)
	project.Post("/compositions/validate", compositions.Validate)
	project.Post("/compositions/compile", compositions.Compile)
	project.Post("/scenes/compile", scenes.ValidateCompileRequest, jobs.Submit("scene-compile", false))
	project.Get("/scenes/source", scenes.ClientSource)
	project.Post("/scenes/inspect", scenes.ClientInspect)
	for path, kind := range map[string]string{
		"/ai/compositions": "ai-composition", "/ai/edit": "ai-edit", "/ai/images": "ai-image",
		"/ai/speech": "ai-speech", "/ai/subtitles": "ai-subtitles", "/ai/scenes": "ai-scene",
	} {
		project.Post(path, requestLimiter(20, rateWindow, "AI job submission rate limit exceeded"), jobs.Submit(kind, false))
	}
	project.Get("/ai/scenes/:id", jobs.Status)
	project.Delete("/ai/scenes/:id", jobs.Cancel)
	project.Post("/compositions/compile-and-generate", compositions.MCPRecipePolicy, jobs.Submit("compile-generate", false))
	project.Post("/renders", compositions.MCPRenderPolicy, jobs.Submit("automation-render", false))
	project.Post("/renders/preview", compositions.MCPPreviewPolicy, jobs.Submit("automation-render", false))
	project.Get("/renders/:id", jobs.Status)
	project.Get("/jobs", jobs.List)
	project.Get("/jobs/:id", jobs.Status)
	project.Delete("/jobs/:id", jobs.Cancel)
	links := media.NewDeliveryLinks(delivery.NewStore(), func(c *fiber.Ctx, record delivery.Record) error {
		if record.Owner != localaccess.Owner || record.Storage != "volume" {
			return fiber.ErrNotFound
		}
		owned, err := store.Get(localaccess.Owner, record.ProjectID)
		if err != nil {
			return fiber.ErrNotFound
		}
		c.Request().Header.Set("X-Session-Id", owned.SessionID)
		return nil
	})
	project.Post("/media/delivery-links", links.Create)
	project.Delete("/media/delivery-links/:linkID", links.Revoke)
	app.Get("/deliveries/:token", links.Download)
	registerLocalMCP(app)
}

func localJobs(queue jobqueue.Repository) *jobqueue.Service {
	service := newJobService(nil)
	service.Store = queue
	service.Options.Local = true
	return service
}

func downloadLocalJob(jobs *jobqueue.Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		job, err := jobs.Store.Get(c.UserContext(), localaccess.Owner, sessions.FromRequest(c), c.Params("id"))
		if err != nil || job.Status != "completed" {
			return fiber.ErrNotFound
		}
		name, _ := job.View()["filename"].(string)
		if !sessions.IsRenderOutput(name) {
			return fiber.ErrNotFound
		}
		c.Request().URI().QueryArgs().Set("file", name)
		return media.Download(c)
	}
}
