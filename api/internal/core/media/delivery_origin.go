package media

import (
	"context"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type deliveryOriginKey struct{}

func WithDeliveryOrigin(ctx context.Context, origin string) context.Context {
	return context.WithValue(ctx, deliveryOriginKey{}, origin)
}

func deliveryOrigin(c *fiber.Ctx) (string, error) {
	origin := strings.TrimSpace(os.Getenv("PUBLIC_API_URL"))
	configured := origin != ""
	if !configured {
		origin, _ = c.UserContext().Value(deliveryOriginKey{}).(string)
		if origin == "" {
			origin = c.BaseURL()
		}
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.Path != "" && parsed.Path != "/" {
		return "", fiber.NewError(fiber.StatusServiceUnavailable, "Configure PUBLIC_API_URL with the public API origin to enable download links.")
	}
	ip := net.ParseIP(parsed.Hostname())
	loopback := parsed.Hostname() == "localhost" || ip != nil && ip.IsLoopback()
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) || !configured && !loopback {
		return "", fiber.NewError(fiber.StatusServiceUnavailable, "PUBLIC_API_URL must use HTTPS outside loopback development.")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func loopbackDeliveryOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	ip := net.ParseIP(host)
	return host == "localhost" || ip != nil && ip.IsLoopback()
}
