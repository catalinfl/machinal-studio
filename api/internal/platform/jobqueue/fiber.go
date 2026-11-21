package jobqueue

import (
	"context"
	"encoding/json"
	"strings"

	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"
)

// FiberTask reuses the existing synchronous handlers without persisting user
// tokens or retaining a pooled request context after its HTTP response.
func FiberTask(handler fiber.Handler) Task {
	app := fiber.New()
	return func(ctx context.Context, job Job) Result {
		body, err := loadPayload(job.Input)
		if err != nil {
			return failure(500, "The saved job input is unavailable or damaged. Restore the API volume before retrying.")
		}
		if _, err := sessions.TouchOwned(job.Session, job.Owner); err != nil {
			return failure(500, "The job workspace is unavailable.")
		}
		var request fasthttp.Request
		request.Header.SetMethod(fiber.MethodPost)
		request.SetRequestURI("/execute?" + job.Input.Query)
		request.Header.SetContentType(job.Input.ContentType)
		request.Header.Set(fiber.HeaderAccept, job.Input.Accept)
		request.Header.Set("X-Session-Id", job.Session)
		request.SetBody(body)
		var requestCtx fasthttp.RequestCtx
		requestCtx.Init(&request, nil, nil)
		c := app.AcquireCtx(&requestCtx)
		defer app.ReleaseCtx(c)
		c.SetUserContext(ctx)
		c.Locals("pbUserId", job.Owner)
		if err := handler(c); err != nil {
			if writeErr := fiber.DefaultErrorHandler(c, err); writeErr != nil {
				return failure(500, "Processing failed.")
			}
		}
		if c.Response().IsBodyStream() {
			return failure(500, "Job handlers must return a saved result, not a response stream.")
		}
		body = append([]byte(nil), c.Response().Body()...)
		contentType := string(c.Response().Header.ContentType())
		if !strings.Contains(contentType, "application/json") || !json.Valid(body) {
			body, _ = json.Marshal(string(body))
		}
		return Result{StatusCode: c.Response().StatusCode(), ContentType: contentType, Body: body}
	}
}
