package routes

import (
	"context"
	"time"

	"ffmpeg-go-server/internal/core/billing"
	"ffmpeg-go-server/internal/core/editor/compositions"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/core/editor/scrub"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/core/projects"
	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

func Register(app *fiber.App, accountBilling *billing.Handler) {
	auth.SetMembershipAccess(func(owner string) (bool, error) {
		membership, err := accountBilling.Store.Membership(owner)
		return membership.Active, err
	})
	registerHealthRoutes(app)
	registerSessionRoutes(app)
	store := registerProjectRoutes(app)
	registerMediaRoutes(app)
	jobs := newJobService(accountBilling)
	registerReadinessRoute(app, jobs)
	registerEditorRoutes(app, jobs)
	registerBillingRoutes(app, accountBilling)
	registerAutomationRoutes(app, store, jobs, accountBilling)
	jobs.Start(context.Background())
	app.Hooks().OnShutdown(jobs.Close)
}

func registerBillingRoutes(app *fiber.App, accountBilling *billing.Handler) {
	app.Get("/billing/catalog", requestLimiter(60, rateWindow, "billing rate limit exceeded"), accountBilling.Catalog)
	app.Post("/billing/paypal/webhook", requestLimiter(120, rateWindow, "webhook rate limit exceeded"), accountBilling.Webhook)
	group := app.Group("/billing", auth.RequirePBAuth, requestLimiter(30, rateWindow, "billing rate limit exceeded"))
	group.Get("/credits", accountBilling.Summary)
	group.Get("/access", accountBilling.Access)
	group.Get("/orders", accountBilling.Orders)
	group.Post("/membership/orders", requestLimiter(5, rateWindow, "checkout rate limit exceeded"), accountBilling.CreateMembershipOrder)
	group.Post("/paypal/orders/:orderID/refund-request", requestLimiter(5, rateWindow, "refund request rate limit exceeded"), accountBilling.RequestRefund)
	group.Post("/paypal/orders", requestLimiter(5, rateWindow, "checkout rate limit exceeded"), accountBilling.CreateOrder)
	group.Post("/paypal/orders/:orderID/capture", accountBilling.CaptureOrder)
}

func registerProjectRoutes(app *fiber.App) *projects.Store {
	store := projects.NewStore()
	group := app.Group("/projects", auth.RequirePBAuth)
	group.Get("/", store.ListHandler)
	group.Post("/", store.CreateHandler)
	group.Get("/:projectID", store.GetHandler)
	group.Post("/:projectID", store.SaveHandler)
	group.Post("/:projectID/duplicate", requestLimiter(3, rateWindow, "project duplication limit exceeded"), store.DuplicateHandler)
	group.Get("/:projectID/versions", store.VersionsHandler)
	group.Post("/:projectID/versions", requestLimiter(10, rateWindow, "version save limit exceeded"), store.SaveVersionHandler)
	group.Get("/:projectID/versions/:versionID", store.GetVersionHandler)
	group.Delete("/:projectID/versions/:versionID", store.DeleteVersionHandler)
	group.Get("/:projectID/text-assets/:assetID", requestLimiter(120, rateWindow, "caption image limit exceeded"), store.GetTextAssetHandler)
	group.Post("/:projectID/text-assets/:assetID", requestLimiter(30, rateWindow, "caption image limit exceeded"), store.SaveTextAssetHandler)
	return store
}

// rateWindow is the fixed counting window for all request limiters.
const rateWindow = time.Minute

// Public compilation is rate-limited but unauthenticated; large projects require login.
const maxPublicCompositionBytes = 8 << 20

func registerHealthRoutes(app *fiber.App) {
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendString("Server Go is working")
	})
}

func registerSessionRoutes(app *fiber.App) {
	app.Post("/sessions", requestLimiter(30, rateWindow, "session rate limit exceeded"), auth.RequirePBAuth, sessions.Create)
	app.Post("/sessions/:id/heartbeat", requestLimiter(120, rateWindow, "rate limit exceeded"), auth.RequirePBAuth, auth.RequireOwnedSessionPath, sessions.Heartbeat)
}

func registerMediaRoutes(app *fiber.App) {
	app.Post("/upload", requestLimiter(30, rateWindow, "upload rate limit exceeded"), auth.RequirePBAuth, auth.RequireOwnedSession, media.Upload)
	// /list is JSON via fetch: require ownership (client sends Authorization).
	// Opaque sessions remain read capabilities; predictable legacy IDs need a
	// separate read token for media tags, or an authenticated owner request.
	app.Get("/list", requestLimiter(120, rateWindow, "rate limit exceeded"), auth.RequirePBAuth, auth.RequireOwnedSession, media.List)
	app.Get("/download", requestLimiter(120, rateWindow, "rate limit exceeded"), auth.OptionalPBAuth, auth.RequireMediaRead, downloadSource)
	app.Delete("/media", requestLimiter(60, rateWindow, "rate limit exceeded"), auth.RequirePBAuth, auth.RequireOwnedSession, media.Delete)
	app.Get("/media-metadata", requestLimiter(120, rateWindow, "rate limit exceeded"), auth.OptionalPBAuth, auth.RequireMediaRead, media.MediaMetadata)
	app.Get("/thumbnail", requestLimiter(120, rateWindow, "rate limit exceeded"), auth.OptionalPBAuth, auth.RequireMediaRead, media.Thumbnail)
	app.Get("/audio-preview", requestLimiter(120, rateWindow, "rate limit exceeded"), auth.OptionalPBAuth, auth.RequireMediaRead, media.AudioPreview)
	app.Get("/waveform", requestLimiter(30, rateWindow, "rate limit exceeded"), auth.OptionalPBAuth, auth.RequireMediaRead, media.Waveform)
}

func downloadSource(c *fiber.Ctx) error {
	if scenes.IsSource(c.Query("file")) {
		return scenes.DownloadSource(c)
	}
	return media.Download(c)
}

func registerEditorRoutes(app *fiber.App, existing ...*jobqueue.Service) *jobqueue.Service {
	jobs := registerCompositionRoutes(app, jobService(existing))
	app.Post("/ai/scenes", auth.RequirePBAuth, auth.RequireOwnedSession, auth.RequirePaid, requestLimiter(5, rateWindow, "AI scene limit exceeded"), jobs.Submit("ai-scene", true))
	app.Get("/ai/scenes/:id", auth.RequirePBAuth, auth.RequireOwnedSession, jobs.Status)
	app.Delete("/ai/scenes/:id", auth.RequirePBAuth, auth.RequireOwnedSession, jobs.Cancel)
	app.Get("/scrub-proxy", requestLimiter(60, rateWindow, "rate limit exceeded"), auth.OptionalPBAuth, auth.RequireMediaRead, scrub.Proxy)
	app.Post("/render", requestLimiter(10, rateWindow, "rate limit exceeded"), auth.RequirePBAuth, auth.RequireOwnedSession, auth.RequirePaid, jobs.Submit("editor-render", true))
	app.Post("/ai/edit", auth.RequirePBAuth, auth.RequireOwnedSession, auth.RequirePaid, requestLimiter(20, rateWindow, "AI edit rate limit exceeded"), jobs.Submit("ai-edit", true))
	app.Post("/ai/compositions", auth.RequirePBAuth, auth.RequireOwnedSession, auth.RequirePaid, requestLimiter(20, rateWindow, "AI edit rate limit exceeded"), jobs.Submit("ai-composition", true))
	app.Post("/ai/images", auth.RequirePBAuth, auth.RequirePaid, auth.RequireOwnedSession, requestLimiter(5, rateWindow, "AI image limit exceeded"), jobs.Submit("ai-image", true))
	app.Post("/ai/speech", auth.RequirePBAuth, auth.RequirePaid, auth.RequireOwnedSession, requestLimiter(10, rateWindow, "AI speech limit exceeded"), jobs.Submit("ai-speech", true))
	app.Post("/ai/subtitles", auth.RequirePBAuth, auth.RequireOwnedSession, auth.RequirePaid, requestLimiter(10, rateWindow, "AI subtitles limit exceeded"), jobs.Submit("ai-subtitles", true))
	return jobs
}

func registerCompositionRoutes(app *fiber.App, existing ...*jobqueue.Service) *jobqueue.Service {
	jobs := jobService(existing)
	app.Get("/compositions/capabilities", compositions.Capabilities)
	app.Get("/compositions/schema", compositions.Schema)
	app.Post("/compositions/validate", requestLimiter(120, rateWindow, "compile rate limit exceeded"), authenticateLargeComposition, compositions.Validate)
	app.Post("/compositions/compile", requestLimiter(120, rateWindow, "compile rate limit exceeded"), authenticateLargeComposition, compositions.Compile)
	app.Post("/compositions/compile-and-generate", auth.RequirePBAuth, auth.RequireOwnedSession, auth.RequirePaid, requestLimiter(10, rateWindow, "AI subtitles limit exceeded"), jobs.Submit("compile-generate", true))
	app.Post("/compositions/assets", auth.RequirePBAuth, auth.RequireOwnedSession, requestLimiter(30, rateWindow, "asset rate limit exceeded"), compositions.AssetMetadata)
	app.Post("/renders", auth.RequirePBAuth, auth.RequireOwnedSession, auth.RequirePaid, requestLimiter(10, rateWindow, "render rate limit exceeded"), jobs.Submit("render", true))
	app.Get("/renders/:id", auth.RequirePBAuth, auth.RequireOwnedSession, jobs.Status)
	app.Get("/jobs", auth.RequirePBAuth, auth.RequireOwnedSession, jobs.List)
	app.Get("/jobs/:id", auth.RequirePBAuth, auth.RequireOwnedSession, jobs.Status)
	app.Get("/jobs/:id/download", auth.RequirePBAuth, auth.RequireOwnedSession, requestLimiter(30, rateWindow, "download link limit exceeded"), downloadJob(jobs))
	app.Delete("/jobs/:id", auth.RequirePBAuth, auth.RequireOwnedSession, jobs.Cancel)
	return jobs
}

func authenticateLargeComposition(c *fiber.Ctx) error {
	if len(c.Body()) > maxPublicCompositionBytes {
		return auth.RequirePBAuth(c)
	}
	return c.Next()
}

func requestLimiter(max int, expiration time.Duration, message string) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        max,
		Expiration: expiration,
		// Per-user when authed (inserted after auth middleware on paid routes),
		// per-IP otherwise. Requires ProxyHeader (see api/router.go) so c.IP()
		// is the real client behind Fly/Railway LB, not the LB itself.
		KeyGenerator: func(c *fiber.Ctx) string {
			if uid, _ := c.Locals("pbUserId").(string); uid != "" {
				return "u:" + uid
			}
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).SendString(message)
		},
	})
}
