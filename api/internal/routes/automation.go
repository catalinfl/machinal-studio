package routes

import (
	"os"

	"ffmpeg-go-server/internal/core/billing"
	"ffmpeg-go-server/internal/core/editor/compositions"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/core/preferences"
	"ffmpeg-go-server/internal/core/projects"
	"ffmpeg-go-server/internal/core/toolrouting"
	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/jobqueue"

	"github.com/gofiber/fiber/v2"
)

func registerAutomationRoutes(app *fiber.App, store *projects.Store, jobs *jobqueue.Service, accountBilling *billing.Handler) {
	keys := auth.NewAPIKeys()
	management := app.Group("/api-keys", auth.RequirePBAuth, requestLimiter(30, rateWindow, "API key rate limit exceeded"))
	management.Get("/", keys.List)
	management.Post("/", auth.RequirePaid, keys.Create)
	management.Delete("/:keyID", keys.Revoke)
	api := app.Group("/v1", requestLimiter(300, rateWindow, "API authentication rate limit exceeded"), keys.Require, requestLimiter(120, rateWindow, "API rate limit exceeded"))
	api.Get("/billing/credits", accountBilling.Summary)
	downloadPreferences := preferences.NewDownloads()
	api.Get("/preferences/downloads", downloadPreferences.Get)
	api.Post("/preferences/downloads", downloadPreferences.Save)
	workflowPreferences := preferences.NewWorkflows()
	api.Get("/preferences/workflow", workflowPreferences.Get)
	api.Post("/preferences/workflow", workflowPreferences.Save)
	api.Get("/projects", store.ListHandler)
	api.Post("/projects", store.CreateHandler)
	api.Get("/compositions/schema", compositions.Schema)
	api.Get("/compositions/capabilities", compositions.Capabilities)
	api.Post("/ai/tool-selection", requestLimiter(20, rateWindow, "Tool routing rate limit exceeded"), toolrouting.Validate, accountBilling.Meter, toolrouting.Select)
	project := api.Group("/projects/:projectID", store.ScopeAPI)
	project.Get("/", store.GetHandler)
	project.Post("/", store.SaveHandler)
	project.Post("/duplicate", requestLimiter(3, rateWindow, "project duplication limit exceeded"), store.DuplicateHandler)
	project.Get("/versions", store.VersionsHandler)
	project.Post("/versions", requestLimiter(10, rateWindow, "version save limit exceeded"), store.SaveVersionHandler)
	project.Get("/versions/:versionID", store.GetVersionHandler)
	project.Delete("/versions/:versionID", store.DeleteVersionHandler)
	project.Post("/upload", requestLimiter(30, rateWindow, "upload rate limit exceeded"), media.Upload)
	localSources := media.NewLocalSources(os.Getenv("LOCAL_MEDIA_ROOTS_JSON"))
	project.Get("/media/local", localSources.List)
	project.Post("/media/local/inspect", requestLimiter(6, rateWindow, "local inspection rate limit exceeded"), localSources.Inspect)
	project.Post("/media/local/import", requestLimiter(10, rateWindow, "local import rate limit exceeded"), localSources.Import)
	project.Get("/media", media.List)
	project.Get("/media/catalog", media.Catalog)
	project.Get("/media/file", media.DescribeFile)
	project.Get("/media/download-url", media.SignedDownload)
	registerDeliveryRoutes(app, project, store, keys)
	project.Delete("/media", media.Delete)
	project.Get("/download", downloadSource)
	project.Post("/compositions/assets", compositions.AssetMetadata)
	project.Post("/compositions/validate", compositions.Validate)
	project.Post("/compositions/compile", compositions.Compile)
	project.Post("/scenes/compile", requestLimiter(10, rateWindow, "scene compilation rate limit exceeded"), scenes.ValidateCompileRequest, compileScene(jobs))
	project.Get("/scenes/source", scenes.ClientSource)
	project.Post("/scenes/inspect", requestLimiter(6, rateWindow, "scene inspection rate limit exceeded"), scenes.ClientInspect)
	project.Post("/compositions/compile-and-generate", requestLimiter(10, rateWindow, "generation rate limit exceeded"), compositions.MCPRecipePolicy, accountBilling.RequireJobPricing, jobs.Submit("compile-generate", true))
	project.Post("/renders", requestLimiter(10, rateWindow, "render rate limit exceeded"), compositions.MCPRenderPolicy, accountBilling.RequireJobPricing, jobs.Submit("automation-render", true))
	project.Post("/renders/preview", requestLimiter(6, rateWindow, "preview rate limit exceeded"), compositions.MCPPreviewPolicy, accountBilling.RequireJobPricing, jobs.Submit("automation-render", true))
	project.Get("/renders/:id", jobs.Status)
	project.Post("/ai/compositions", requestLimiter(20, rateWindow, "AI edit rate limit exceeded"), accountBilling.RequireJobPricing, jobs.Submit("ai-composition", true))
	project.Post("/ai/edit", requestLimiter(20, rateWindow, "AI edit rate limit exceeded"), accountBilling.RequireJobPricing, jobs.Submit("ai-edit", true))
	project.Post("/ai/images", requestLimiter(5, rateWindow, "AI image rate limit exceeded"), accountBilling.RequireJobPricing, jobs.Submit("ai-image", true))
	project.Post("/ai/speech", requestLimiter(10, rateWindow, "AI speech rate limit exceeded"), accountBilling.RequireJobPricing, jobs.Submit("ai-speech", true))
	project.Post("/ai/subtitles", requestLimiter(10, rateWindow, "AI subtitles rate limit exceeded"), accountBilling.RequireJobPricing, jobs.Submit("ai-subtitles", true))
	project.Post("/ai/scenes", requestLimiter(5, rateWindow, "AI scene rate limit exceeded"), accountBilling.RequireJobPricing, jobs.Submit("ai-scene", true))
	project.Get("/ai/scenes/:id", jobs.Status)
	project.Delete("/ai/scenes/:id", jobs.Cancel)
	project.Get("/jobs", jobs.List)
	project.Get("/jobs/:id", jobs.Status)
	project.Delete("/jobs/:id", jobs.Cancel)
	registerMCPRoutes(app, keys)
}
