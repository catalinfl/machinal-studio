package render

import (
	"fmt"
	"os"
)

func exportEncoding() (string, string, error) {
	encoder := os.Getenv("RENDER_VIDEO_ENCODER")
	if encoder == "" {
		encoder = "libx264"
	}
	if encoder != "libx264" && encoder != "h264_nvenc" {
		return "", "", fmt.Errorf("RENDER_VIDEO_ENCODER must be libx264 or h264_nvenc")
	}
	preset := os.Getenv("RENDER_X264_PRESET")
	if preset == "" {
		preset = "faster"
	}
	switch preset {
	case "ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow":
		return encoder, preset, nil
	default:
		return "", "", fmt.Errorf("invalid RENDER_X264_PRESET")
	}
}
