package scenes

import (
	"context"
	"fmt"
	"sort"

	"ffmpeg-go-server/internal/core/media"
)

func (r *Runner) generateEdit(ctx context.Context, session, root string, request Request, provider Provider, job *Job, progress func(string, string, float64)) error {
	media.WarmSession(ctx, session, root, request.SourceFile)
	base, err := ReadSource(root, request.SourceFile)
	if err != nil {
		return fmt.Errorf("load scene to edit: %w", err)
	}
	request.Width, request.Height, request.FPS = base.Config.Width, base.Config.Height, base.Config.FPS
	request.Transparent = base.Config.Transparent
	request.CaptionSafeArea = request.CaptionSafeArea || base.Config.CaptionSafeBottom > 0
	request.Images = existingImageInputs(base.Images)
	request.Videos = existingVideoInputs(base.Videos)
	request.Text, request.VisualMode = base.Text, base.VisualMode
	title := base.Title
	if title == "" {
		title = defaultSceneTitle(base.Text, base.Explanation, request.Prompt)
	}
	definition := Definition{Title: title, Brief: request.Prompt, End: request.Duration}
	progress("generating", "Editing the current scene component", 0.2)
	scene, err := r.prepareSceneSource(ctx, root, request, provider, job.ID, 0, definition, 0, &base, func() {
		progress("compiling", "Preparing the edited live preview", 0.8)
	})
	if err != nil {
		return err
	}
	if err := r.persistScene(ctx, session, root, request, scene); err != nil {
		return err
	}
	job.Scenes = append(job.Scenes, scene)
	return nil
}

func existingVideoInputs(videos map[string]string) []SceneVideo {
	inputs := make([]SceneVideo, 0, len(videos))
	for id := range videos {
		inputs = append(inputs, SceneVideo{ID: id, Name: id, Description: "Existing scene video: keep its ID and use unless the edit requests a change."})
	}
	sort.Slice(inputs, func(i, j int) bool { return inputs[i].ID < inputs[j].ID })
	return inputs
}

func existingImageInputs(images map[string]string) []SceneImage {
	inputs := make([]SceneImage, 0, len(images))
	for id := range images {
		inputs = append(inputs, SceneImage{ID: id, Name: id, Description: "Existing scene image: keep its ID and use unless the edit requests a change."})
	}
	sort.Slice(inputs, func(i, j int) bool { return inputs[i].ID < inputs[j].ID })
	return inputs
}
