package scenes

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

func GenerateScene(ctx context.Context, session, root string, request Request) (Scene, error) {
	if err := request.validate(); err != nil {
		return Scene{}, err
	}
	if request.AudioFile != "" {
		return Scene{}, fmt.Errorf("DSL scene jobs create one scene from a prompt")
	}
	provider, err := configuredProvider()
	if err != nil {
		return Scene{}, err
	}
	if request.Model != "" {
		provider.Model = request.Model
	}
	if err := rendererReady(ctx); err != nil {
		return Scene{}, fmt.Errorf("scene compiler unavailable: %w", err)
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return Scene{}, fmt.Errorf("allocate scene ID: %w", err)
	}
	job := Job{ID: hex.EncodeToString(random[:])}
	if err := NewRunner().generate(ctx, session, root, request, provider, &job, func(string, string, float64) {}); err != nil {
		return Scene{}, err
	}
	return job.Scenes[0], nil
}
