package ffmpeg

import (
	"context"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/internal/core/editor/render"
)

type Renderer struct {
	Root     string
	Progress func(float64, string)
}

type Output = render.CompositionOutput

func (r Renderer) Render(ctx context.Context, resolved composition.Composition) (Output, error) {
	return render.RenderComposition(ctx, resolved, render.CompositionOptions{Root: r.Root, Progress: r.Progress})
}
