package render

import (
	"fmt"

	"ffmpeg-go-server/editengine/document"
)

func videoFitFilter(w, h int, fit document.VideoFit, padColor string) string {
	if fit == document.VideoFitCover {
		return fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=increase:force_divisible_by=2,crop=%d:%d:(iw-ow)/2:(ih-oh)/2,setsar=1", w, h, w, h)
	}
	color := ""
	if padColor != "" {
		color = ":color=" + padColor
	}
	return fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2%s,setsar=1", w, h, w, h, color)
}
