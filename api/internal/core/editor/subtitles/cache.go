package subtitles

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
)

const maxTranscriptCacheEntries = 64
const maxCachedTranscriptWords = 100000
const transcriptCacheTTL = 30 * time.Minute

type cachedTranscript struct {
	identity        string
	start, duration float64
	response        transcriptionResponse
	accessed        time.Time
}

var transcriptCache = struct {
	sync.Mutex
	entries []cachedTranscript
}{}

func transcriptIdentity(path string, config openRouterConfig, language string) string {
	info, err := os.Stat(path)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s:%d:%d:%s:%s:%s:%s", path, info.Size(), info.ModTime().UnixNano(), config.Model, config.Provider, language, os.Getenv("OPENROUTER_BASE_URL"))
}

func cachedTranscription(identity string, start, duration float64) (transcriptionResponse, bool) {
	if identity == "" || duration <= 0 {
		return transcriptionResponse{}, false
	}
	transcriptCache.Lock()
	defer transcriptCache.Unlock()
	for index := range transcriptCache.entries {
		entry := &transcriptCache.entries[index]
		if entry.identity != identity || time.Since(entry.accessed) > transcriptCacheTTL || start < entry.start || start+duration > entry.start+entry.duration+0.000001 {
			continue
		}
		entry.accessed = time.Now()
		return sliceTranscription(entry.response, start-entry.start, duration), true
	}
	return transcriptionResponse{}, false
}

func sliceTranscription(source transcriptionResponse, from, duration float64) transcriptionResponse {
	result := transcriptionResponse{}
	var text []string
	for _, segment := range source.Segments {
		if segment.Start < from || segment.End > from+duration {
			continue
		}
		segment.Start -= from
		segment.End -= from
		result.Segments = append(result.Segments, segment)
		text = append(text, segment.Text)
	}
	for _, word := range source.Words {
		if word.Start < from || word.End > from+duration {
			continue
		}
		word.Start -= from
		word.End -= from
		result.Words = append(result.Words, word)
	}
	result.Text = strings.Join(text, " ")
	return result
}

func storeTranscription(identity string, start, duration float64, response transcriptionResponse) {
	if identity == "" || duration <= 0 || len(response.Words) == 0 || len(response.Words) > maxCachedTranscriptWords {
		return
	}
	transcriptCache.Lock()
	defer transcriptCache.Unlock()
	transcriptCache.entries = slices.DeleteFunc(transcriptCache.entries, func(entry cachedTranscript) bool {
		return time.Since(entry.accessed) > transcriptCacheTTL || entry.identity == identity && entry.start >= start && entry.start+entry.duration <= start+duration
	})
	words := len(response.Words)
	for _, entry := range transcriptCache.entries {
		words += len(entry.response.Words)
	}
	for len(transcriptCache.entries) >= maxTranscriptCacheEntries || words > maxCachedTranscriptWords {
		oldest := 0
		for i, entry := range transcriptCache.entries {
			if entry.accessed.Before(transcriptCache.entries[oldest].accessed) {
				oldest = i
			}
		}
		words -= len(transcriptCache.entries[oldest].response.Words)
		transcriptCache.entries = slices.Delete(transcriptCache.entries, oldest, oldest+1)
	}
	response.Segments, response.Words = slices.Clone(response.Segments), slices.Clone(response.Words)
	transcriptCache.entries = append(transcriptCache.entries, cachedTranscript{identity, start, duration, response, time.Now()})
}
