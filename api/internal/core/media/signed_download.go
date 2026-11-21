package media

import (
	"context"
	"time"

	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const downloadURLLifetime = 15 * time.Minute

type downloadStore interface {
	Enabled() bool
	Head(context.Context, string) (objectstore.Object, error)
	PresignDownload(string, time.Duration) (string, error)
}

func SignedDownload(c *fiber.Ctx) error {
	return signedDownload(c, objectstore.Shared(), time.Now)
}

func signedDownload(c *fiber.Ctx, store downloadStore, now func() time.Time) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	name := c.Query("file")
	if _, err := validateDeleteName(root, name); err != nil {
		return sendFileError(c, err)
	}
	if !store.Enabled() {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Cloud downloads are not configured. No API-proxy fallback was used.")
	}
	object, err := findPreviewObject(c.UserContext(), name, sessions.S3Prefixes(session), store)
	if err != nil {
		return AssetError(c, err)
	}
	link, err := store.PresignDownload(object.Key, downloadURLLifetime)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Could not issue a cloud download URL.")
	}
	return c.JSON(fiber.Map{
		"filename": name, "method": "GET", "url": link, "storage": "s3",
		"expiresAt":      now().UTC().Add(downloadURLLifetime).Format(time.RFC3339),
		"authentication": "none; the signed URL is a temporary bearer credential. Do not attach the application API key.",
		"public":         false, "bearerUrl": true,
	})
}
