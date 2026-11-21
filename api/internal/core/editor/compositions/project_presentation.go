package compositions

import (
	"log"
	"time"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/internal/core/projects"
	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/sessions"
	"github.com/gofiber/fiber/v2"
)

func retainProjectComposition(c *fiber.Ctx, result composition.Result, filename string) {
	owner := auth.UserID(c)
	if owner == "" || result.Document == nil || result.Composition == nil {
		return
	}
	prepared := projects.PreparedComposition{JobID: jobqueue.ID(c.UserContext()), UpdatedAt: time.Now().UTC(),
		Filename: filename, CompositionID: result.Composition.ID, Document: result.Document, Bindings: result.Bindings, Composition: result.Composition}
	if err := projects.NewPresentationStore().Save(owner, sessions.FromRequest(c), prepared); err != nil {
		log.Printf("save project composition job=%q: %v", prepared.JobID, err)
	}
}
