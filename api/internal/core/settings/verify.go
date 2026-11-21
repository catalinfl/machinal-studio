package settings

import (
	"context"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	keyCheckURL     = "https://openrouter.ai/api/v1/key"
	keyCheckTimeout = 15 * time.Second // Bound onboarding without starting a paid generation.
)

var keyCheckClient = &http.Client{
	Timeout: keyCheckTimeout,
	// Never forward an API key to a redirect destination.
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

func VerifyKey(ctx context.Context, key string) error {
	return verifyKey(ctx, keyCheckClient, keyCheckURL, key)
}

func verifyKey(ctx context.Context, client *http.Client, endpoint, key string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fiber.NewError(fiber.StatusBadGateway, "Could not check the key. Try again.")
	}
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := client.Do(request)
	if err != nil {
		return fiber.NewError(fiber.StatusBadGateway, "Could not reach OpenRouter. Check your connection and try again.")
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusOK:
		return nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return fiber.NewError(fiber.StatusBadRequest, "OpenRouter did not accept this key. Copy an active key from OpenRouter and try again.")
	case http.StatusTooManyRequests:
		return fiber.NewError(fiber.StatusTooManyRequests, "OpenRouter is busy. Wait a moment and try again.")
	default:
		return fiber.NewError(fiber.StatusBadGateway, "OpenRouter could not verify the key. Try again shortly.")
	}
}
