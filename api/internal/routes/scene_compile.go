package routes

import (
	"encoding/json"
	"strings"

	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"github.com/gofiber/fiber/v2"
)

func compileScene(jobs *jobqueue.Service) fiber.Handler {
	queued := jobs.Submit("scene-compile", false)
	compiler := jobqueue.FiberTask(scenes.NewRunner().CompileSource)
	return func(c *fiber.Ctx) error {
		var input scenes.CompileRequest
		if json.Unmarshal(c.Body(), &input) != nil {
			return fiber.ErrBadRequest
		}
		if input.SourceFile != "" || input.Handoff != nil || strings.Contains(c.Get("Prefer"), "respond-async") {
			return queued(c)
		}
		return jobqueue.InlineCompile(c, compiler)
	}
}
