package render

import (
	"context"
	"fmt"
	"math"
	"strings"

	"ffmpeg-go-server/editengine/document"
)

const MaxPreviewSeconds = 15

type PreviewWindow struct {
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
}

func (window PreviewWindow) Validate() error {
	if math.IsNaN(window.Start) || math.IsInf(window.Start, 0) || window.Start < 0 || window.Start > document.MaxTime.Seconds() || math.IsNaN(window.Duration) || math.IsInf(window.Duration, 0) || window.Duration <= 0 || window.Duration > MaxPreviewSeconds {
		return fmt.Errorf("preview needs a finite nonnegative start and duration greater than zero, at most %d seconds", MaxPreviewSeconds)
	}
	return nil
}

type previewContextKey struct{}

func WithPreviewWindow(ctx context.Context, window PreviewWindow) context.Context {
	return context.WithValue(ctx, previewContextKey{}, window)
}

func PreviewFromContext(ctx context.Context) (PreviewWindow, bool) {
	if ctx == nil {
		return PreviewWindow{}, false
	}
	window, ok := ctx.Value(previewContextKey{}).(PreviewWindow)
	return window, ok
}

func validatePreviewComposition(ctx context.Context, duration float64, format string) error {
	window, present := PreviewFromContext(ctx)
	if !present {
		return nil
	}
	if err := window.Validate(); err != nil {
		return err
	}
	if format != "mp4" || document.Seconds(window.Start)+document.Seconds(window.Duration) > document.Seconds(duration) {
		return fmt.Errorf("preview requires an MP4 composition and an interval covered by its complete timeline")
	}
	return nil
}

func previewEncodingArgs(window PreviewWindow, videoFile, audioFile, outputPath string, output outputSettings) []string {
	args := []string{"-i", videoFile}
	if audioFile != "" {
		args = append(args, "-i", audioFile)
	}
	args = append(args, "-ss", ff(window.Start), "-t", ff(window.Duration), "-map", "0:v:0")
	if audioFile != "" {
		args = append(args, "-map", "1:a:0")
	}
	args = append(args, output.videoEncodingArgs()...)
	if audioFile != "" {
		args = append(args, output.audioEncodingArgs()...)
	}
	return append(args, "-movflags", "+faststart", "-y", outputPath)
}

func writePreviewOutput(window PreviewWindow, plan renderPlan, videoFile, audioFile, outputPath string, progress *renderProgress) error {
	if !plan.hasVideo || plan.output.format != "mp4" {
		return fmt.Errorf("video preview requires MP4 output with a visible video track")
	}
	args := previewEncodingArgs(window, videoFile, audioFile, outputPath, plan.output)
	if err := progress.runFFmpeg(window.Duration, window.Duration, "encoding final-composition preview "+strings.ToUpper(plan.output.format), args...); err != nil {
		return fmt.Errorf("encode composition preview: %w", err)
	}
	return nil
}
