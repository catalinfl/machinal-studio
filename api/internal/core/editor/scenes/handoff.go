package scenes

import (
	"context"
	"encoding/json"
	"fmt"

	"ffmpeg-go-server/internal/core/media"
	"github.com/gofiber/fiber/v2"
)

type SceneHandoff struct {
	SourceFile    string            `json:"sourceFile"`
	SourceVersion string            `json:"sourceVersion"`
	Frame         int               `json:"frame"`
	Objects       map[string]string `json:"objects"`
}

func (handoff SceneHandoff) Validate() error {
	if !IsSource(handoff.SourceFile) || !sourceVersionPattern.MatchString(handoff.SourceVersion) || handoff.Frame < 0 || handoff.Frame >= maxSceneSeconds*60 {
		return fmt.Errorf("handoff requires an outgoing scene, its exact sourceVersion and a valid source frame index")
	}
	if len(handoff.Objects) < 1 || len(handoff.Objects) > maxParameterObjects {
		return fmt.Errorf("map between 1 and %d incoming-to-outgoing object IDs", maxParameterObjects)
	}
	for target, source := range handoff.Objects {
		if !parameterIDPattern.MatchString(target) || !parameterIDPattern.MatchString(source) {
			return fmt.Errorf("handoff object IDs must be valid parameter identities")
		}
	}
	return nil
}

func stateHandoffPatch(ctx context.Context, session, root string, target LiveSource, handoff SceneHandoff) (SceneParameters, error) {
	for id := range handoff.Objects {
		if _, ok := target.Parameters[id]; !ok {
			return nil, &componentError{diagnostic: "Handoff destination object is not exposed by the incoming scene: " + id}
		}
	}
	media.WarmSession(ctx, session, root, handoff.SourceFile)
	outgoing, version, err := readSourceVersion(root, handoff.SourceFile)
	if err != nil {
		return nil, err
	}
	if version != handoff.SourceVersion {
		return nil, fiber.NewError(fiber.StatusConflict, "Outgoing scene changed; refresh its sourceVersion before handoff.")
	}
	if handoff.Frame >= outgoing.Config.Frames || target.Config.Width != outgoing.Config.Width || target.Config.Height != outgoing.Config.Height || target.VisualMode != outgoing.VisualMode {
		return nil, &componentError{diagnostic: "Handoff needs an existing source frame and matching canvas dimensions/visualMode; coordinate/camera conversion is not inferred."}
	}
	ctx, cancel := context.WithTimeout(ctx, inspectionTimeout)
	defer cancel()
	evidence, err := inspectRemote(ctx, outgoing, []int{handoff.Frame})
	if err != nil {
		return nil, fmt.Errorf("inspect outgoing object state: %w", err)
	}
	var result struct {
		Frames []struct {
			Frame  int             `json:"frame"`
			States SceneParameters `json:"states"`
		} `json:"frames"`
	}
	if err := json.Unmarshal(evidence, &result); err != nil {
		return nil, fmt.Errorf("decode outgoing object state: %w", err)
	}
	if len(result.Frames) != 1 || result.Frames[0].Frame != handoff.Frame {
		return nil, fmt.Errorf("scene inspector returned the wrong handoff frame")
	}
	if err := result.Frames[0].States.Validate(); err != nil {
		return nil, err
	}
	return mappedHandoffStates(result.Frames[0].States, handoff.Objects)
}

func mappedHandoffStates(states SceneParameters, mapping map[string]string) (SceneParameters, error) {
	patch := make(SceneParameters, len(mapping))
	for target, source := range mapping {
		state, exists := states[source]
		if !exists {
			return nil, &componentError{diagnostic: "Outgoing component did not register a semantic state for object: " + source}
		}
		state.Delay, state.Duration = nil, nil
		if state.X == nil && state.Y == nil && state.Z == nil && state.Rotation == nil && state.ScaleX == nil && state.ScaleY == nil && state.Opacity == nil && state.Color == nil {
			return nil, &componentError{diagnostic: "Outgoing object state contains no transferable pose/appearance: " + source}
		}
		patch[target] = state
	}
	return patch, nil
}
