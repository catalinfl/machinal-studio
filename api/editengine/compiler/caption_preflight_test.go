package compiler

import (
	"encoding/json"
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestCaptionStyleErrorsAreReportedBeforeTranscription(t *testing.T) {
	for _, style := range []string{`{"fontSize":900}`, `{"fontFamily":"not-a-font"}`, `{"font-size":48}`, `{"highlightMode":"invented"}`} {
		input := Input{Document: document.Document{Version: 2, Mode: "assemble", After: []document.Job{{ID: "captions", Type: "captions.generate", Style: json.RawMessage(style)}}}}
		if result := New().Validate(input); len(result.Diagnostics) == 0 {
			t.Fatalf("invalid caption style passed free validation: %s", style)
		}
	}
}
