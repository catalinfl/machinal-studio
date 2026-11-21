package scenes

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/sessions"
	"github.com/gofiber/fiber/v2"
)

func (r *Runner) RunQueued(c *fiber.Ctx) error {
	if len(c.Body()) > maxRequestBytes {
		return fiber.ErrRequestEntityTooLarge
	}
	var request Request
	if json.Unmarshal(c.Body(), &request) != nil {
		return fiber.NewError(400, "Invalid scene request")
	}
	request.Prompt = strings.TrimSpace(request.Prompt)
	if err := request.validate(); err != nil {
		return fiber.NewError(400, err.Error())
	}
	provider, err := configuredProvider()
	if err != nil {
		return fiber.NewError(503, err.Error())
	}
	if request.Model != "" {
		provider.Model = request.Model
	}
	if os.Getenv("SCENE_SERVICE_URL") == "" {
		return fiber.NewError(503, "Scene compilation is not configured.")
	}
	if err := rendererReady(c.UserContext()); err != nil {
		return fiber.NewError(503, "The scene compiler is unavailable.")
	}
	ctx, cancel := context.WithTimeout(c.UserContext(), jobTimeout)
	defer cancel()
	root, session := sessions.ResolveRoot(c)
	job := Job{ID: jobqueue.ID(ctx), Scenes: []Scene{}, Status: "running"}
	progress := func(status, message string, ratio float64) {
		job.Status, job.Message, job.Progress = status, message, ratio
		snapshot, err := json.Marshal(job)
		if err != nil {
			log.Printf("encode scene progress: %v", err)
			return
		}
		jobqueue.Report(ctx, jobqueue.Update{Progress: ratio, Message: message, Snapshot: snapshot})
	}
	if err := r.generate(ctx, session, root, request, provider, &job, progress); err != nil {
		return fiber.NewError(502, generationFailure(err))
	}
	job.Status, job.Message, job.Progress = "completed", "Scenes ready to add to your video", 1
	if err := saveJSON(filepath.Join(root, "scene_job_"+job.ID+".json"), job); err != nil {
		log.Printf("save scene provenance: %v", err)
	}
	return c.JSON(job)
}
