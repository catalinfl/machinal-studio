package api

import (
	"bytes"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ffmpeg-go-server/internal/core/settings"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/localaccess"
	"ffmpeg-go-server/internal/platform/mcpserver"
	"ffmpeg-go-server/internal/platform/storage"
	"ffmpeg-go-server/internal/routes"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/valyala/fasthttp"
)

// maxBodyBytes caps request bodies at 2 GiB so large media uploads succeed
// while a malformed Content-Length cannot force unbounded buffering.
// JSON handlers enforce much smaller per-route caps before unmarshal.
const maxBodyBytes = 2 << 30

// ReadTimeout covers the entire request body, not just idle periods. Large
// uploads need longer than the 10-second deadline used for ordinary requests.
const uploadReadTimeout = 30 * time.Minute

// NewApp builds the HTTP transport and connects each route to its domain
// handler. Domain packages do not need to know how the application is wired.
func NewApp() (*fiber.App, error) {
	if err := storage.EnsureDataDir(); err != nil {
		return nil, fmt.Errorf("ensure data dir: %w", err)
	}
	if err := settings.ConfigureModelDefaults(); err != nil {
		return nil, err
	}
	queue, err := jobqueue.OpenLocal(filepath.Join(storage.DataDir, ".jobs.db"), time.Now)
	if err != nil {
		return nil, err
	}
	openRouter, err := settings.New(storage.DataDir, settings.VerifyKey)
	if err != nil {
		queue.Close()
		return nil, fmt.Errorf("configure local OpenRouter: %w", err)
	}
	proxies, err := trustedProxies(os.Getenv("TRUSTED_PROXY_CIDRS"))
	if err != nil {
		queue.Close()
		return nil, err
	}

	app := fiber.New(fiber.Config{
		BodyLimit:               maxBodyBytes,
		ProxyHeader:             fiber.HeaderXForwardedFor,
		EnableTrustedProxyCheck: true,
		TrustedProxies:          proxies,
		ReadTimeout:             10 * time.Second,
		WriteTimeout:            30 * time.Second,
		IdleTimeout:             60 * time.Second,
	})
	app.Server().HeaderReceived = uploadRequestConfig
	configureCORS(app)
	app.Use(securityHeaders)
	app.Use(localaccess.Protect(parseAllowedOrigins(envOrDefault("CORS_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"))))
	routes.RegisterLocal(app, openRouter, queue)
	return app, nil
}

func uploadRequestConfig(header *fasthttp.RequestHeader) fasthttp.RequestConfig {
	path, _, _ := bytes.Cut(header.RequestURI(), []byte("?"))
	path = bytes.ToLower(bytes.TrimRight(path, "/"))
	if bytes.EqualFold(bytes.TrimRight(path, "/"), []byte("/mcp")) {
		return fasthttp.RequestConfig{MaxRequestBodySize: mcpserver.MaxRequestBytes, WriteTimeout: jobqueue.MaxCompletionWait + 15*time.Second}
	}
	if bytes.Equal(header.Method(), []byte(fiber.MethodGet)) && bytes.HasPrefix(path, []byte("/v1/projects/")) && bytes.Contains(path, []byte("/jobs/")) {
		return fasthttp.RequestConfig{MaxRequestBodySize: jobqueue.MaxInputBytes, WriteTimeout: jobqueue.MaxCompletionWait + 15*time.Second}
	}
	if bytes.Equal(header.Method(), []byte(fiber.MethodPost)) && (bytes.Equal(path, []byte("/upload")) || bytes.HasPrefix(path, []byte("/v1/projects/")) && bytes.HasSuffix(path, []byte("/upload"))) {
		return fasthttp.RequestConfig{ReadTimeout: uploadReadTimeout}
	}
	if bytes.HasPrefix(path, []byte("/billing/")) {
		limit := 4096
		if bytes.Equal(path, []byte("/billing/paypal/webhook")) {
			limit = 1 << 20
		}
		return fasthttp.RequestConfig{MaxRequestBodySize: limit}
	}
	return fasthttp.RequestConfig{MaxRequestBodySize: jobqueue.MaxInputBytes}
}

func trustedProxies(raw string) ([]string, error) {
	proxies := []string{}
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if net.ParseIP(value) == nil {
			_, network, err := net.ParseCIDR(value)
			if err != nil {
				return nil, fmt.Errorf("TRUSTED_PROXY_CIDRS must contain explicit IP addresses or CIDRs")
			}
			if bits, _ := network.Mask.Size(); bits == 0 {
				return nil, fmt.Errorf("TRUSTED_PROXY_CIDRS must not trust every address")
			}
		}
		proxies = append(proxies, value)
	}
	return proxies, nil
}

func configureCORS(app *fiber.App) {
	// Never allow "*" in production: parse env as allowlist, drop empties and
	// wildcards unless explicitly enabled for local dev.
	origins := parseAllowedOrigins(envOrDefault("CORS_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"))
	app.Use(cors.New(cors.Config{
		AllowOrigins:  strings.Join(origins, ","),
		AllowMethods:  "GET,POST,DELETE,HEAD,OPTIONS",
		AllowHeaders:  "Origin,Content-Type,Range,X-Session-Id,Idempotency-Key,MCP-Protocol-Version,MCP-Session-Id,Last-Event-ID",
		ExposeHeaders: "Content-Length,Content-Range,Content-Disposition,Accept-Ranges,Location,Retry-After,MCP-Session-Id,MCP-Protocol-Version,WWW-Authenticate",
	}))
}

func parseAllowedOrigins(raw string) []string {
	var out []string
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		// Reject wildcard unless explicitly allowed via CORS_ALLOW_WILDCARD=1
		// (local dev only). Production must list explicit origins.
		if o == "*" {
			if strings.TrimSpace(os.Getenv("CORS_ALLOW_WILDCARD")) == "1" {
				out = append(out, o)
			}
			continue
		}
		out = append(out, o)
	}
	if len(out) == 0 {
		return []string{"http://localhost:5173"}
	}
	return out
}

// securityHeaders adds hardening headers to every response, notably nosniff so
// browsers never sniff uploaded content into an executable type.
func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Referrer-Policy", "no-referrer")
	c.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	c.Set("Cross-Origin-Opener-Policy", "same-origin")
	// Media bytes are intentionally loaded cross-origin via <img>/<video>/<audio>
	// tags (frontend :5173, API :8080). CORP "same-origin" makes the browser
	// block every such subresource ("blocked due to CORP"), so thumbnails never
	// load, <img onerror> clears thumbnailUrl, and the bin falls back to the
	// generic "Preview" placeholder for all server videos. Serve those paths as
	// cross-origin; JSON fetch (CORS mode) is unaffected either way.
	if isCrossOriginAssetPath(c.Path()) {
		c.Set("Cross-Origin-Resource-Policy", "cross-origin")
	} else {
		c.Set("Cross-Origin-Resource-Policy", "same-origin")
	}
	// Served user files go through SendAsset/SendFile with explicit
	// Content-Type + nosniff; keep a restrictive default CSP. Sandbox is set
	// per-asset where needed to avoid breaking the API JSON surface.
	c.Set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'")
	// HSTS only matters behind TLS; harmless locally, enforced in prod.
	c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	// Never cache bearer URLs by default; handlers override for ETag assets.
	if c.Get("X-Session-Id") != "" || c.Query("session") != "" {
		c.Set("Cache-Control", "no-store")
	}
	return c.Next()
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

// isCrossOriginAssetPath reports whether path serves bytes consumed as
// cross-origin subresources (<img>/<video>/<audio> tags, no-cors mode).
// Those responses must carry CORP "cross-origin"; everything else keeps the
// restrictive "same-origin".
func isCrossOriginAssetPath(path string) bool {
	switch {
	case strings.HasPrefix(path, "/thumbnail"),
		strings.HasPrefix(path, "/download"),
		strings.HasPrefix(path, "/scrub-proxy"),
		strings.HasPrefix(path, "/audio-preview"):
		return true
	default:
		return false
	}
}
