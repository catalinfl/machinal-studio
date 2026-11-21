package subtitles

import (
	"context"
	"fmt"

	"ffmpeg-go-server/internal/utils"
)

const transcriptChunkSeconds = 300.0

// AnalyzeWindow covers the entire requested interval, including material beyond
// the old ten-minute analysis limit. Caption jobs reuse its timestamped words.
func AnalyzeWindow(ctx context.Context, root, file string, start, duration float64, language string) ([]TranscriptSegment, error) {
	request := generateRequest{File: file, Start: start, Duration: duration, Language: language}
	if err := request.validateSubtitlesRequest(); err != nil {
		return nil, err
	}
	config, err := loadOpenRouterConfig()
	if err != nil {
		return nil, err
	}
	path, err := request.validatePath(root)
	if err != nil {
		return nil, err
	}
	identity := transcriptIdentity(path, config, resolveTranscriptionLanguage(language))
	combined, cached := cachedTranscription(identity, start, duration)
	if !cached {
		for offset := 0.0; offset < duration; offset += transcriptChunkSeconds {
			window := generateRequest{File: file, Start: start + offset, Duration: min(transcriptChunkSeconds, duration-offset), Language: language}
			part, err := fetchTranscription(ctx, root, window, utils.RunFFmpegContext)
			if err != nil {
				return nil, fmt.Errorf("transcribe source window %.3g–%.3gs: %w", window.Start, window.Start+window.Duration, err)
			}
			for _, segment := range part.Segments {
				segment.Start += offset
				segment.End += offset
				combined.Segments = append(combined.Segments, segment)
			}
			for _, word := range part.Words {
				word.Start += offset
				word.End += offset
				combined.Words = append(combined.Words, word)
			}
		}
		storeTranscription(identity, start, duration, combined)
	}
	segments, err := segmentsFromTranscription(combined)
	for index := range segments {
		segments[index].Start += start
		segments[index].End += start
	}
	return segments, err
}
