package compositions

import (
	"fmt"
	"strconv"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/render"
	"ffmpeg-go-server/internal/platform/credits"

	"github.com/gofiber/fiber/v2"
)

func previewQuery(c *fiber.Ctx) (*render.PreviewWindow, error) {
	args := c.Request().URI().QueryArgs()
	startValues, durationValues := args.PeekMulti("previewStart"), args.PeekMulti("previewDuration")
	if len(startValues) == 0 && len(durationValues) == 0 {
		return nil, nil
	}
	if len(startValues) != 1 || len(durationValues) != 1 {
		return nil, fiber.NewError(fiber.StatusBadRequest, "Provide previewStart and previewDuration exactly once.")
	}
	start, startErr := strconv.ParseFloat(string(startValues[0]), 64)
	duration, durationErr := strconv.ParseFloat(string(durationValues[0]), 64)
	window := render.PreviewWindow{Start: start, Duration: duration}
	if startErr != nil || durationErr != nil {
		return nil, fiber.ErrBadRequest
	}
	if err := window.Validate(); err != nil {
		return nil, fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	return &window, nil
}

func validatePreviewPlan(window render.PreviewWindow, result composition.Result) error {
	if HasErrors(result) || result.Composition == nil || len(result.Requirements) > 0 {
		return fmt.Errorf("preview requires a fully resolved, valid composition; generate approved assets separately first")
	}
	plan := result.Composition
	if plan.Output.Format != "mp4" || document.Seconds(window.Start)+document.Seconds(window.Duration) > plan.Duration || document.Seconds(window.Duration) < document.Seconds(1/float64(plan.Output.FPS)) {
		return fmt.Errorf("preview needs MP4 output, at least one frame and an interval inside the complete timeline")
	}
	return nil
}

func MCPPreviewPolicy(c *fiber.Ctx) error {
	window, err := previewQuery(c)
	if err != nil {
		return err
	}
	if window == nil {
		return fiber.NewError(fiber.StatusBadRequest, "Preview requires explicit previewStart and previewDuration.")
	}
	input, parsed, err := ParseProject(c.Body())
	if err != nil {
		return parseError(c, err)
	}
	result := WithPositions(engine.Compile(input), parsed)
	if err := validatePreviewPlan(*window, result); err != nil {
		return fiber.NewError(fiber.StatusUnprocessableEntity, err.Error())
	}
	c.SetUserContext(credits.WithWorkflowPolicy(c.UserContext(), credits.MCPServerRender))
	return c.Next()
}
