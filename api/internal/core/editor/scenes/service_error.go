package scenes

import (
	"errors"
	"net/http"
)

type serviceError struct{ code string }

func (err *serviceError) Error() string {
	switch err.code {
	case "scene_renderer_permission_denied":
		return "Scene renderer cannot execute scene-render (EACCES). Rebuild the scene-renderer image with execute permissions. Changing Svelte source cannot fix this; existing assets were kept."
	case "scene_renderer_unavailable":
		return "Scene native renderer is unavailable. Check and rebuild the scene-renderer installation; existing assets were kept."
	case "scene_browser_unavailable":
		return "Scene browser is unavailable. Check the Chromium installation in scene-renderer; existing assets were kept."
	case "scene_ffmpeg_unavailable":
		return "Scene FFmpeg is unavailable. Check the FFmpeg installation in scene-renderer; existing assets were kept."
	default:
		return "Scene rendering infrastructure is unavailable; existing assets were kept."
	}
}

func rendererServiceError(response *http.Response) error {
	if response.StatusCode != http.StatusServiceUnavailable {
		return nil
	}
	switch code := response.Header.Get("X-Scene-Error-Code"); code {
	case "scene_renderer_permission_denied", "scene_renderer_unavailable", "scene_browser_unavailable", "scene_ffmpeg_unavailable":
		return &serviceError{code: code}
	default:
		return nil
	}
}

func PublicServiceDiagnostic(err error) string {
	var unavailable *serviceError
	if errors.As(err, &unavailable) {
		return unavailable.Error()
	}
	return ""
}
