package auth

import (
	"context"

	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

// DeliveryAccess rechecks a link's issuing key without storing the API secret in the link.
func (keys *APIKeys) DeliveryAccess(ctx context.Context, owner, keyID string) error {
	if !storage.ValidUserID(owner) || !storage.ValidUserID(keyID) {
		return fiber.ErrNotFound
	}
	items, err := keys.store().List(ctx, owner)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Delivery access verification is unavailable.")
	}
	for _, key := range items {
		if key.ID != keyID || key.Owner != owner || key.Revoked {
			continue
		}
		_, paid, err := keys.access(ctx, owner)
		if err != nil {
			return fiber.NewError(fiber.StatusServiceUnavailable, "Delivery access verification is unavailable.")
		}
		if !paid {
			return fiber.ErrNotFound
		}
		return nil
	}
	return fiber.ErrNotFound
}
