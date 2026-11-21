package render

import "strings"

func ProgressStage(message string) string {
	switch {
	case strings.HasPrefix(message, "Rendering scene "):
		return "scene-rendering"
	case strings.Contains(message, "finalizing"), strings.HasPrefix(message, "encoding "):
		return "encoding"
	case strings.HasPrefix(message, "compositing "):
		return "compositing"
	case strings.Contains(message, "text"), strings.Contains(message, "caption"):
		return "captions"
	case strings.Contains(message, "audio"), strings.Contains(message, "silence"):
		return "audio"
	case strings.Contains(message, "video"), strings.Contains(message, "transition"):
		return "video"
	default:
		return "processing"
	}
}
