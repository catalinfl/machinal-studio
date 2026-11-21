package compiler

import (
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"ffmpeg-go-server/editengine/document"
)

func (s *compilation) validateSceneDesign(job document.Job, path string) {
	if utf8.RuneCountInString(job.Prompt) > document.MaxScenePromptRunes {
		s.fail(path+".prompt", "prompt_too_long", fmt.Sprintf("scene prompts must contain at most %d characters", document.MaxScenePromptRunes))
	}
	if !slices.Contains([]string{"", "auto", "2d", "3d"}, job.VisualMode) {
		s.fail(path+".visualMode", "invalid_visual_mode", "visualMode must be auto, 2d or 3d")
	}
	if job.Type == "scene.edit" && job.VisualMode != "" {
		s.fail(path+".visualMode", "invalid_scene", "scene.edit preserves the existing visual mode")
	}
	if len(job.Images) > document.MaxSceneImages {
		s.fail(path+".images", "too_many_images", fmt.Sprintf("attach at most %d scene images", document.MaxSceneImages))
	}
	seen := make(map[string]bool)
	for index, image := range job.Images {
		imagePath := fmt.Sprintf("%s.images[%d]", path, index)
		if !slices.Contains([]string{"image_1", "image_2", "image_3", "image_4"}, image.ID) || seen[image.ID] {
			s.fail(imagePath+".id", "invalid_image_id", "scene images need unique image_1 through image_4 IDs")
		}
		seen[image.ID] = true
		s.validateSceneImage(job, image, imagePath)
	}
}

func (s *compilation) validateSceneImage(scene document.Job, image document.SceneImage, path string) {
	if strings.TrimSpace(image.Name) == "" || len(image.Name) > 255 || utf8.RuneCountInString(image.Description) > 600 {
		s.fail(path, "invalid_image", "scene images need a name and directions of at most 600 characters")
	}
	if (image.File == "") == (image.Job == "") {
		s.fail(path, "invalid_image_source", "provide exactly one uploaded file or earlier image.generate job")
		return
	}
	if image.File != "" {
		if len(image.File) > 255 || strings.ContainsAny(image.File, `/\`) || image.File == "." || image.File == ".." {
			s.fail(path+".file", "invalid_image_file", "choose a project image filename, not a path or URL")
		}
		return
	}
	sceneIndex := slices.IndexFunc(s.input.Document.Before, func(job document.Job) bool { return job.ID == scene.ID })
	if sceneIndex < 0 {
		s.fail(path+".job", "invalid_image_dependency", "generated image dependencies require a scene in the before stage")
		return
	}
	for _, previous := range s.input.Document.Before[:sceneIndex] {
		if previous.ID == image.Job && previous.Type == "image.generate" {
			return
		}
	}
	s.fail(path+".job", "invalid_image_dependency", "scene image job must reference an earlier before image.generate job")
}

func (s *compilation) validateSceneNarration(scene document.Job, path string) {
	if scene.NarrationFrom < 0 {
		s.fail(path+".narrationFrom", "invalid_narration", "narrationFrom is a nonnegative source-audio time")
	}
	if scene.ResultAssetID != "" {
		return
	}
	index := slices.IndexFunc(s.input.Document.Before, func(job document.Job) bool { return job.ID == scene.ID })
	if index >= 0 {
		for _, previous := range s.input.Document.Before[:index] {
			if previous.ID == scene.NarrationJob && previous.Type == "speech.generate" {
				return
			}
		}
	}
	for _, previous := range s.input.Document.Jobs {
		if previous.ID == scene.NarrationJob && previous.Type == "speech.generate" && previous.ResultAssetID != "" {
			return
		}
	}
	s.fail(path+".narrationJob", "invalid_narration_dependency", "narrationJob must reference an earlier before speech.generate job or a materialized speech job")
}
