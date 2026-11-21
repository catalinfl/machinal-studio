package ai

import (
	"strings"

	"ffmpeg-go-server/editengine/composition"
	"github.com/gofiber/fiber/v2"
)

func EditComposition(c *fiber.Ctx) error { return editRecipe(c) }

func compositionDiagnosticSummary(result composition.Result) string {
	parts := make([]string, 0, len(result.Diagnostics)+len(result.Requirements))
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Severity != "error" { continue }
		parts = append(parts, diagnostic.Code+" at "+diagnostic.Path+": "+diagnostic.Message)
		if len(parts) >= 3 { break }
	}
	for _, requirement := range result.Requirements {
		parts = append(parts, requirement.Path+": "+requirement.Message)
		if len(parts) >= 3 { break }
	}
	return strings.Join(parts, "; ")
}
