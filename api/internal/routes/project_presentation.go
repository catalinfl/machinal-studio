package routes

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"ffmpeg-go-server/internal/core/projects"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/sessions"
)

func retainEditorRender(task jobqueue.Task) jobqueue.Task {
	return func(ctx context.Context, job jobqueue.Job) jobqueue.Result {
		result := task(ctx, job)
		var output struct {
			File     string `json:"file"`
			Filename string `json:"filename"`
		}
		if result.StatusCode < 200 || result.StatusCode >= 300 || json.Unmarshal(result.Body, &output) != nil {
			return result
		}
		if output.Filename == "" {
			output.Filename = output.File
		}
		if !sessions.IsRenderOutput(output.Filename) {
			return result
		}
		prepared := projects.PreparedComposition{JobID: job.ID, UpdatedAt: time.Now().UTC(), Filename: output.Filename}
		if err := projects.NewPresentationStore().Save(job.Owner, job.Session, prepared); err != nil {
			log.Printf("save editor render presentation job=%q: %v", job.ID, err)
		}
		return result
	}
}
