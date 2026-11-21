package routes

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/core/projects"
	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/mcpserver"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
	"github.com/valyala/fasthttp"
)

const mcpClientIPHeader = "X-Direction-MCP-Client-IP"
const mcpOriginHeader = "X-Direction-MCP-Origin"

func registerMCPRoutes(app *fiber.App, keys *auth.APIKeys) {
	transport := mcpserver.NewHandler(internalAPICaller(app))
	origins := strings.Split(os.Getenv("MCP_ALLOWED_ORIGINS"), ",")
	app.All("/mcp", protectMCPRequest(origins),
		requestLimiter(300, rateWindow, "MCP authentication rate limit exceeded"),
		mcpAuthentication(keys), requestLimiter(120, rateWindow, "MCP rate limit exceeded"),
		func(c *fiber.Ctx) error {
			// Reuse REST's resolved client IP, not a caller-supplied bridge header.
			c.Request().Header.Set(mcpClientIPHeader, c.IP())
			c.Request().Header.Set(mcpOriginHeader, c.BaseURL())
			ctx := c.UserContext()
			return adaptor.HTTPHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				transport.ServeHTTP(w, r.WithContext(ctx))
			}))(c)
		})
}

func registerLocalMCP(app *fiber.App) {
	handler := adaptor.HTTPHandler(mcpserver.NewLocalHandler(internalAPICaller(app, true)))
	app.All("/mcp", requestLimiter(120, rateWindow, "MCP rate limit exceeded"), func(c *fiber.Ctx) error {
		c.Request().Header.Set(mcpClientIPHeader, c.IP())
		c.Request().Header.Set(mcpOriginHeader, c.BaseURL())
		return handler(c)
	})
}

func protectMCPRequest(origins []string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Set(fiber.HeaderCacheControl, "no-store")
		if len(c.Body()) > mcpserver.MaxRequestBytes {
			return fiber.ErrRequestEntityTooLarge
		}
		if origin := c.Get(fiber.HeaderOrigin); origin != "" {
			for _, allowed := range origins {
				if allowed = strings.TrimSpace(allowed); allowed != "" && allowed != "*" && origin == allowed {
					return c.Next()
				}
			}
			return fiber.NewError(fiber.StatusForbidden, "This Origin is not allowed to access MCP.")
		}
		return c.Next()
	}
}

func mcpAuthentication(keys *auth.APIKeys) fiber.Handler {
	return func(c *fiber.Ctx) error {
		err := keys.Require(c)
		var failure *fiber.Error
		if errors.As(err, &failure) && failure.Code == fiber.StatusUnauthorized {
			c.Set(fiber.HeaderWWWAuthenticate, `Bearer realm="machinal"`)
			return fiber.NewError(fiber.StatusUnauthorized, "A valid machinal API key is required. Sign in on the website with PocketBase, create a key at /api-keys, and configure Authorization: Bearer through your MCP client's environment. Do not paste credentials into chat.")
		}
		return err
	}
}

func internalAPICaller(app *fiber.App, local ...bool) mcpserver.Caller {
	handler := sync.OnceValue(app.Handler)
	return func(ctx context.Context, headers http.Header, operation mcpserver.Request) (mcpserver.Response, error) {
		if err := ctx.Err(); err != nil {
			return mcpserver.Response{}, err
		}
		if !strings.HasPrefix(operation.Path, "/v1/") {
			return mcpserver.Response{}, errors.New("MCP can only call the versioned API")
		}
		var request fasthttp.Request
		defer request.Reset()
		request.Header.SetMethod(operation.Method)
		request.SetRequestURI(operation.Path)
		request.Header.SetHost("127.0.0.1")
		if !bytes.HasPrefix(request.URI().Path(), []byte("/v1/")) {
			return mcpserver.Response{}, errors.New("MCP cannot escape the versioned API")
		}
		request.SetBody(operation.Body)
		request.Header.SetContentType(operation.ContentType)
		request.Header.Set(fiber.HeaderAuthorization, headers.Get(fiber.HeaderAuthorization))
		request.Header.Set("Idempotency-Key", operation.IdempotencyKey)
		ip := net.ParseIP(headers.Get(mcpClientIPHeader))
		request.Header.Set(fiber.HeaderXForwardedFor, ip.String())
		var nested fasthttp.RequestCtx
		nested.Init(&request, &net.TCPAddr{IP: ip}, nil)
		defer nested.Request.Reset()
		defer nested.Response.Reset()
		bridge := app.AcquireCtx(&nested)
		ctx = credits.WithWorkflowPolicy(ctx, credits.MCPMediaOnly)
		if len(local) > 0 && local[0] {
			ctx = credits.WithLocalExecution(ctx)
		}
		bridge.SetUserContext(media.WithDeliveryOrigin(ctx, headers.Get(mcpOriginHeader)))
		app.ReleaseCtx(bridge)

		// Dispatch through the real /v1 middleware, including key revocation,
		// ownership, shared rate limits, pricing and persistent job admission.
		handler()(&nested)
		body, err := internalAPIResponseBody(&nested.Response, operation)
		if err != nil {
			return mcpserver.Response{}, err
		}
		response := mcpserver.Response{StatusCode: nested.Response.StatusCode(), Header: make(http.Header), Body: body}
		nested.Response.Header.VisitAll(func(key, value []byte) { response.Header.Add(string(key), string(value)) })
		return response, nil
	}
}

func internalAPIResponseBody(response *fasthttp.Response, operation mcpserver.Request) ([]byte, error) {
	if !response.IsBodyStream() {
		body := response.Body()
		if len(body) > mcpserver.MaxResultBytes {
			return nil, mcpserver.ErrResultTooLarge
		}
		return bytes.Clone(body), nil
	}
	path, _, _ := strings.Cut(operation.Path, "?")
	id, projectRead := strings.CutPrefix(strings.TrimRight(path, "/"), "/v1/projects/")
	if operation.Method != http.MethodGet || !projectRead || !projects.ValidID(id) ||
		!bytes.HasPrefix(response.Header.ContentType(), []byte(fiber.MIMEApplicationJSON)) ||
		response.Header.ContentLength() > mcpserver.MaxResultBytes {
		return nil, mcpserver.ErrResultTooLarge
	}
	// MCP needs bounded structured JSON, never an unbounded media stream.
	body, err := io.ReadAll(io.LimitReader(response.BodyStream(), mcpserver.MaxResultBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read internal project response: %w", err)
	}
	if len(body) > mcpserver.MaxResultBytes {
		return nil, mcpserver.ErrResultTooLarge
	}
	return body, nil
}
