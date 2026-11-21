package routes

import (
	"context"
	"sync"
	"time"

	"ffmpeg-go-server/internal/platform/jobqueue"
	"github.com/gofiber/fiber/v2"
)

const readinessCacheDuration = 15 * time.Second

func registerReadinessRoute(app *fiber.App, jobs *jobqueue.Service) {
	var mu sync.Mutex
	var checked time.Time
	var ready bool
	app.Get("/health/ready", requestLimiter(30, rateWindow, "health check limit exceeded"), func(c *fiber.Ctx) error {
		mu.Lock()
		defer mu.Unlock()
		if time.Since(checked) >= readinessCacheDuration {
			ready = false
			if checker, ok := jobs.Store.(interface{ Check(context.Context) error }); ok {
				ctx, cancel := context.WithTimeout(c.UserContext(), 3*time.Second)
				ready = checker.Check(ctx) == nil
				cancel()
			}
			checked = time.Now()
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		if !ready {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "not_ready", "queueSchema": "unavailable_or_incompatible"})
		}
		return c.JSON(fiber.Map{"status": "ready", "queueSchemaVersion": 1})
	})
}
