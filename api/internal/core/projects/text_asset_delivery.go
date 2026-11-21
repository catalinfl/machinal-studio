package projects

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"
	"os"
	"time"

	"ffmpeg-go-server/internal/platform/objectstore"
	"github.com/gofiber/fiber/v2"
)

const textAssetDownloadLifetime = 15 * time.Minute
const textAssetPublicationTimeout = 2 * time.Minute

type textAssetCloud interface {
	Enabled() bool
	EnsurePublished(context.Context, string, string, string) error
	PresignDownload(string, time.Duration) (string, error)
}

func (s *Store) textAssetCloud() textAssetCloud {
	if s.textCloud != nil {
		return s.textCloud()
	}
	return objectstore.Shared()
}

func cloudTextDeliveryRequired() bool {
	return os.Getenv("MEDIA_DELIVERY_MODE") == "cloud"
}

func textAssetObjectKey(owner, project string, reference textAssetReference) string {
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(reference.Key)))
	return owner + "/projects/" + project + "/text-assets/" + key + "/" + reference.ID + ".json"
}

func redirectTextAsset(c *fiber.Ctx, owner, project string, reference textAssetReference, path string, cloud textAssetCloud) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Set(fiber.HeaderReferrerPolicy, "no-referrer")
	if !cloud.Enabled() {
		return textAssetDeliveryError(nil)
	}
	ctx, cancel := context.WithTimeout(c.UserContext(), textAssetPublicationTimeout)
	defer cancel()
	key := textAssetObjectKey(owner, project, reference)
	if err := cloud.EnsurePublished(ctx, path, key, fiber.MIMEApplicationJSONCharsetUTF8); err != nil {
		return textAssetDeliveryError(err)
	}
	link, err := cloud.PresignDownload(key, textAssetDownloadLifetime)
	if err != nil {
		return textAssetDeliveryError(err)
	}
	c.Set(fiber.HeaderLocation, link)
	return c.SendStatus(fiber.StatusFound)
}

func textAssetDeliveryError(err error) error {
	if err != nil {
		log.Printf("caption cache cloud delivery failed: %v", err)
	}
	return fiber.NewError(fiber.StatusServiceUnavailable, "Saved caption images are unavailable from cloud storage. No API-proxy fallback was used; retry shortly.")
}
