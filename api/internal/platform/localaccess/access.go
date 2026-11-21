package localaccess

import (
	"net"
	"strings"

	"ffmpeg-go-server/internal/platform/sessions"
	"github.com/gofiber/fiber/v2"
)

const Owner = "local"
const DefaultSession = "u_local"

// A local installation has no account boundary. Host/Origin validation is still
// required: an unrelated website must not spend the user's provider key or read media.
func Protect(origins []string) fiber.Handler {
	allowed := make(map[string]bool, len(origins))
	for _, origin := range origins {
		if origin != "*" {
			allowed[origin] = true
		}
	}
	return func(c *fiber.Ctx) error {
		host := strings.ToLower(c.Hostname())
		if parsed, _, err := net.SplitHostPort(host); err == nil {
			host = parsed
		}
		if host != "localhost" && host != "127.0.0.1" && host != "::1" && host != "[::1]" {
			return fiber.NewError(fiber.StatusForbidden, "This installation accepts loopback hosts only.")
		}
		if origin := c.Get(fiber.HeaderOrigin); origin != "" && !allowed[origin] {
			return fiber.NewError(fiber.StatusForbidden, "This website cannot access your local installation.")
		}
		c.Locals("pbUserId", Owner)
		// A stable preference namespace, not an issued or accepted credential.
		c.Locals("machinalAPIKey", "local")
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.Next()
	}
}

func ProjectSession(c *fiber.Ctx) error {
	id := sessions.FromRequest(c)
	if id == "" {
		if c.Get("X-Session-Id") != "" || c.Query("session") != "" {
			return fiber.ErrBadRequest
		}
		id = DefaultSession
	}
	if id != DefaultSession {
		owner, ok := sessions.OwnerOf(id)
		if !ok || owner != Owner {
			return fiber.ErrNotFound
		}
	}
	if _, err := sessions.TouchOwned(id, Owner); err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Cannot open the local project volume.")
	}
	c.Request().Header.Set("X-Session-Id", id)
	return c.Next()
}
