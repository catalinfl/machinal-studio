package render

import "testing"

func TestProgressStagesDistinguishSceneCaptureFromExportPhases(t *testing.T) {
	for message, want := range map[string]string{
		"Rendering scene 6 of 6 for export": "scene-rendering",
		"rendering video clip 6, segment 1": "video",
		"overlaying text chunk 1":           "captions",
		"mixing audio tracks":               "audio",
		"finalizing MP4 video and audio":    "encoding",
	} {
		if actual := ProgressStage(message); actual != want {
			t.Errorf("%q: got %s, want %s", message, actual, want)
		}
	}
}
