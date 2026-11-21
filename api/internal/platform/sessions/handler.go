package sessions

import (
	"context"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
)

func Create(c *fiber.Ctx) error {
	// Stable per-user sessions: authed callers get "u_<uid>" (same volume +
	// S3 prefix as before, so existing bins keep working — no 404 after
	// upgrade). Fixation-safe because the id is derived server-side from the
	// verified PB uid, never from client input. Anonymous callers (no PB
	// auth, e.g. migration) get a fresh random UUID.
	// Client-supplied {"id":...} is always ignored.
	uid, _ := c.Locals("pbUserId").(string)
	id := NewID()
	if uid != "" {
		id = "u_" + uid
		if len(id) > 64 {
			id = id[:64]
		}
	}
	if _, err := TouchOwned(id, uid); err != nil {
		log.Printf("sessions: create: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("cannot create session")
	}
	return sessionResponse(c, id, fiber.StatusCreated)
}

func Heartbeat(c *fiber.Ctx) error {
	id := c.Params("id")
	if !Valid(id) {
		return c.Status(fiber.StatusBadRequest).SendString("invalid session")
	}
	// No auto-provision for unknown ids: POST /sessions must come first.
	// This prevents unauthenticated disk flooding via /heartbeat/<arbitrary>.
	if !Exists(id) {
		// Migration: legacy u_ ids owned by the caller may re-provision after
		// GC eviction so S3 re-hydration keeps working. Random unknown ids 404.
		if IsLegacySession(id) || isPersistentProject(id) {
			if _, err := Touch(id); err != nil {
				log.Printf("sessions: heartbeat touch %q: %v", id, err)
				return c.Status(fiber.StatusInternalServerError).SendString("cannot touch session")
			}
			return sessionResponse(c, id, fiber.StatusOK)
		}
		return c.Status(fiber.StatusNotFound).SendString("unknown session")
	}
	if !RefreshExisting(id) {
		return c.Status(fiber.StatusNotFound).SendString("unknown session")
	}
	return sessionResponse(c, id, fiber.StatusOK)
}

func sessionResponse(c *fiber.Ctx, id string, status int) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	result := fiber.Map{"id": id, "ok": true}
	if IsLegacySession(id) {
		token, err := MediaToken(id)
		if err != nil {
			log.Printf("sessions: issue media access: %v", err)
			return fiber.NewError(fiber.StatusServiceUnavailable, "Media access is temporarily unavailable.")
		}
		result["mediaToken"] = token
	}
	return c.Status(status).JSON(result)
}

// StartGCFromEnv launches the TTL + disk-pressure collector using
// SESSION_TTL (default 10m), SESSION_GC_INTERVAL (default 1m) and
// SESSION_DISK_MAX (default 0.8).
func StartGCFromEnv() context.CancelFunc {
	ttl := parseDuration(os.Getenv("SESSION_TTL"), DefaultTTL)
	interval := parseDuration(os.Getenv("SESSION_GC_INTERVAL"), DefaultGCInterval)
	maxFrac := parseFraction(os.Getenv("SESSION_DISK_MAX"), DefaultDiskMaxFrac)
	ctx, cancel := context.WithCancel(context.Background())
	go StartGC(ctx, interval, ttl, maxFrac)
	return cancel
}

func parseDuration(raw string, fallback time.Duration) time.Duration {
	if raw == "" {
		return fallback
	}
	if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
		return parsed
	}
	return fallback
}

func parseFraction(raw string, fallback float64) float64 {
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || value <= 0 || value >= 1 {
		return fallback
	}
	return value
}
