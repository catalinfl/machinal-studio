package compositions

import (
	"fmt"
	"strings"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/credits"

	"github.com/gofiber/fiber/v2"
)

func MCPRecipePolicy(c *fiber.Ctx) error {
	return mcpSubmissionPolicy(c, false)
}

func MCPRenderPolicy(c *fiber.Ctx) error {
	return mcpSubmissionPolicy(c, true)
}

func mcpSubmissionPolicy(c *fiber.Ctx, render bool) error {
	if !credits.IsMCPWorkflow(c.UserContext()) {
		return c.Next()
	}
	input, _, err := ParseProject(c.Body())
	if err != nil {
		return parseError(c, err)
	}
	paid, err := mcpRecipeUsage(input.Document)
	if err != nil {
		return fiber.NewError(fiber.StatusUnprocessableEntity, err.Error())
	}
	if render {
		c.SetUserContext(credits.WithWorkflowPolicy(c.UserContext(), credits.MCPServerRender))
	} else if !paid {
		c.SetUserContext(credits.WithWorkflowPolicy(c.UserContext(), credits.MCPFree))
	}
	return c.Next()
}

func mcpRecipeUsage(doc document.Document) (bool, error) {
	paid := false
	for _, jobs := range [][]document.Job{doc.Before, doc.Jobs, doc.After} {
		for _, job := range jobs {
			switch job.Type {
			case "scene.generate", "scene.edit":
				if job.ResultAssetID == "" {
					return false, fmt.Errorf("scene %q requires client-authored Svelte: use compile_scene, then place its returned asset in the recipe; MCP never falls back to the server scene model", job.ID)
				}
			case "speech.generate":
				if job.ResultAssetID == "" && strings.TrimSpace(job.Model) == "" {
					return false, fmt.Errorf("speech %q requires an explicit model: read list_speech_models for the narration language and ask the user to choose unless already chosen or delegated; use Gemini 3.8 Flash/Flash-Lite for Romanian and offer economical Kokoro for English", job.ID)
				}
				paid = paid || job.ResultAssetID == ""
			case "image.generate":
				paid = paid || job.ResultAssetID == ""
			case "captions.generate", "analysis.transcribe":
				paid = paid || len(job.ResultTextIDs) == 0
			}
		}
	}
	return paid, nil
}
