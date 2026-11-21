package render

import (
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

func TestVideoFitFilters(t *testing.T) {
	for _, fit := range []document.VideoFit{"", document.VideoFitContain, document.VideoFitCover} {
		t.Run(string(fit), func(t *testing.T) {
			filter := videoFitFilter(1080, 1920, fit, "")
			mask := videoMaskFilter(clip{OutPoint: 2}, 1080, 1920, 30, fit)
			if fit == document.VideoFitCover {
				for _, value := range []string{filter, mask} {
					if !strings.Contains(value, "force_original_aspect_ratio=increase:force_divisible_by=2,crop=1080:1920:(iw-ow)/2:(ih-oh)/2") || strings.Contains(value, "pad=1080:1920") {
						t.Fatalf("fill must center-crop both footage and alpha: %s", value)
					}
				}
			} else if !strings.Contains(filter, "force_original_aspect_ratio=decrease,pad=1080:1920") || !strings.Contains(mask, "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black") {
				t.Fatalf("legacy whole-image framing changed: video=%s mask=%s", filter, mask)
			}
		})
	}
}

func TestCompositionRequestPreservesVideoFit(t *testing.T) {
	request, err := compositionRequest(composition.Composition{Output: document.Output{
		Aspect: "portrait", Resolution: "1080p", Fit: document.VideoFitCover, FPS: 30, Format: "mp4", Quality: "normal",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if request.Fit != document.VideoFitCover || request.Resolution.W != 1080 || request.Resolution.H != 1920 {
		t.Fatalf("framing lost adapting composition: %+v", request)
	}
}

func TestRenderRejectsUnknownVideoFit(t *testing.T) {
	err := validateRenderRequest(renderRequest{Fit: "stretch"}, renderPlan{})
	if err == nil || !strings.Contains(err.Error(), "invalid fit") {
		t.Fatalf("invalid fit was not rejected: %v", err)
	}
}
