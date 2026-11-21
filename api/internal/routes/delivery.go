package routes

import (
	"errors"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/core/projects"
	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/delivery"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

func registerDeliveryRoutes(app *fiber.App, project fiber.Router, store *projects.Store, keys *auth.APIKeys) {
	links := media.NewDeliveryLinks(delivery.NewStore(), func(c *fiber.Ctx, record delivery.Record) error {
		if err := keys.DeliveryAccess(c.UserContext(), record.Owner, record.KeyID); err != nil {
			return err
		}
		owned, err := store.Get(record.Owner, record.ProjectID)
		if errors.Is(err, projects.ErrNotFound) {
			return fiber.ErrNotFound
		}
		if err != nil {
			return fiber.NewError(fiber.StatusServiceUnavailable, "Project verification is unavailable.")
		}
		if err := sessions.BindProject(owned.SessionID, record.Owner); err != nil {
			return fiber.ErrNotFound
		}
		c.Locals("pbUserId", record.Owner)
		c.Request().Header.Set("X-Session-Id", owned.SessionID)
		return nil
	})
	project.Post("/media/delivery-links", requestLimiter(30, rateWindow, "Download link limit exceeded"), links.Create)
	project.Delete("/media/delivery-links/:linkID", links.Revoke)
	app.Get("/deliveries/:token", requestLimiter(120, rateWindow, "Download rate limit exceeded"), links.Download)
}
