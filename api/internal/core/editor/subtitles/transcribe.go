package subtitles

import (
	"context"
	"strings"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/utils"
)

// CueWord is a timestamped word inside a caption cue. Times are seconds
// relative to the requested window start.
type CueWord struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

// Cue is a readable caption group. Times are seconds relative to the
// requested window start.
type Cue struct {
	Start float64   `json:"start"`
	End   float64   `json:"end"`
	Text  string    `json:"text"`
	Words []CueWord `json:"words"`
}

// TranscribeWindow extracts audio for file[start:start+duration] under root,
// transcribes it and returns caption cues relative to the window start.
// Language is an ISO-639-1 code; "" or "auto" leaves detection to the
// provider configuration. Callers warm the session beforehand when the file
// lives in a session volume.
func TranscribeWindow(ctx context.Context, root, file string, start, duration float64, language string) ([]Cue, error) {
	normalized := strings.ToLower(strings.TrimSpace(language))
	if normalized == "auto" {
		normalized = ""
	}
	request := generateRequest{File: file, Start: start, Duration: duration, Language: normalized}
	if err := request.validateSubtitlesRequest(); err != nil {
		return nil, err
	}
	transcription, err := fetchTranscription(ctx, root, request, utils.RunFFmpegContext)
	if err != nil {
		return nil, err
	}
	raw := buildCaptionCues(transcription)
	cues := make([]Cue, 0, len(raw))
	for _, cue := range raw {
		words := make([]CueWord, 0, len(cue.Words))
		for _, word := range cue.Words {
			words = append(words, CueWord{Start: word.Start, End: word.End, Text: word.Text})
		}
		cues = append(cues, Cue{Start: cue.Start, End: cue.End, Text: cue.Text, Words: words})
	}
	return cues, nil
}

// WarmFile ensures a session-scoped file is materialized under root.
func WarmFile(ctx context.Context, session, root, file string) {
	media.WarmSession(ctx, session, root, file)
}
