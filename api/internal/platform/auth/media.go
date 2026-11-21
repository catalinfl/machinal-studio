package auth

import (
	"strings"

	"ffmpeg-go-server/internal/platform/sessions"
	"github.com/gofiber/fiber/v2"
)

func OptionalPBAuth(c *fiber.Ctx) error {
	if c.Get(fiber.HeaderAuthorization) != "" {
		return RequirePBAuth(c)
	}
	return c.Next()
}

func RequireMediaRead(c *fiber.Ctx) error {
	if UserID(c) != "" {
		return RequireOwnedSession(c)
	}
	id := sessions.FromRequest(c)
	if id == "" {
		return fiber.ErrUnauthorized
	}
	if sessions.IsLegacySession(id) && !sessions.ValidMediaToken(id, c.Query("mediaToken")) {
		return fiber.ErrUnauthorized
	}
	if _, _, ok := sessions.ResolveExistingRoot(c); !ok {
		return fiber.ErrNotFound
	}
	return c.Next()
}

func RequireOwnedSessionPath(c *fiber.Ctx) error {
	id := c.Params("id")
	if !sessions.Valid(id) {
		return fiber.ErrBadRequest
	}
	for _, supplied := range []string{c.Get("X-Session-Id"), c.Query("session")} {
		if supplied != "" && strings.TrimSpace(supplied) != id {
			return fiber.ErrForbidden
		}
	}
	c.Request().Header.Set("X-Session-Id", id)
	return RequireOwnedSession(c)
}
