package scenes

import (
	"context"
	"fmt"

	"ffmpeg-go-server/internal/core/media"

	"github.com/gofiber/fiber/v2"
)

func (input CompileRequest) validateParameterEdit() error {
	if input.ParameterPatch != nil && input.Handoff != nil {
		return fmt.Errorf("provide either a parameter patch or a handoff, not both")
	}
	if !IsSource(input.SourceFile) || !sourceVersionPattern.MatchString(input.SourceVersion) {
		return fmt.Errorf("parameter edits require a live sourceFile and its exact sourceVersion")
	}
	if input.Component != "" || input.Parameters != nil || input.Duration != 0 || input.Width != 0 || input.Height != 0 || input.FPS != 0 || input.Text != "" || input.Explanation != "" || input.Title != "" || input.VisualMode != "" || input.Transparent || input.CaptionSafeArea || len(input.Images) > 0 || len(input.Videos) > 0 || len(input.Models) > 0 {
		return fmt.Errorf("parameter edits preserve source, config, media and narration; provide only sourceFile, sourceVersion and parameterPatch")
	}
	if len(input.ParameterPatch) == 0 {
		if input.Handoff != nil {
			return input.Handoff.Validate()
		}
		return fmt.Errorf("provide at least one object parameter patch")
	}
	return input.ParameterPatch.Validate()
}

func parameterEditSource(ctx context.Context, session, root string, input CompileRequest) (LiveSource, error) {
	media.WarmSession(ctx, session, root, input.SourceFile)
	source, version, err := readSourceVersion(root, input.SourceFile)
	if err != nil {
		return source, err
	}
	if version != input.SourceVersion {
		return source, fiber.NewError(fiber.StatusConflict, "Scene source changed; read its current sourceVersion before editing parameters.")
	}
	patch := input.ParameterPatch
	if input.Handoff != nil {
		patch, err = stateHandoffPatch(ctx, session, root, source, *input.Handoff)
		if err != nil {
			return source, err
		}
	}
	source.Parameters, err = applyParameterPatch(source.Parameters, patch)
	if err != nil {
		return source, &componentError{diagnostic: err.Error()}
	}
	source.Handoff = input.Handoff
	return source, nil
}

func (input CompileRequest) isParameterEdit() bool {
	return input.ParameterPatch != nil || input.Handoff != nil
}
