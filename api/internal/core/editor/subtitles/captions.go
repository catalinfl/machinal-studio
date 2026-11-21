package subtitles

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

func buildSRT(transcription transcriptionResponse) (string, int) {
	return buildSRTFromCues(buildCaptionCues(transcription))
}

func buildSRTFromCues(cues []captionCue) (string, int) {
	cues = append([]captionCue(nil), cues...)
	sort.SliceStable(cues, func(i, j int) bool { return cues[i].Start < cues[j].Start })

	var output strings.Builder
	cueIndex := 0

	for _, cue := range cues {
		if !validNumber(cue.Start) || !validNumber(cue.End) {
			continue
		}

		text := strings.Join(strings.Fields(cue.Text), " ")
		if text == "" || cue.End <= cue.Start {
			continue
		}

		startMS := int64(math.Round(math.Max(0, cue.Start) * 1000))
		endMS := int64(math.Round(math.Max(0, cue.End) * 1000))
		if endMS <= startMS {
			endMS = startMS + 1
		}

		cueIndex++
		fmt.Fprintf(&output, "%d\n%s --> %s\n%s\n\n", cueIndex, srtTimestamp(startMS), srtTimestamp(endMS), text)
	}

	return output.String(), cueIndex
}

func buildCaptionCues(transcription transcriptionResponse) []captionCue {
	cues := cuesFromText(transcription.Segments)
	if wordCues := cuesFromWords(transcription.Words); len(wordCues) > 0 {
		cues = wordCues
	}
	sort.SliceStable(cues, func(i, j int) bool { return cues[i].Start < cues[j].Start })
	return cues
}

func cuesFromText(segments []transcriptionSegment) []captionCue {
	cues := make([]captionCue, 0, len(segments))

	for _, segment := range segments {
		words := strings.Fields(segment.Text)
		if len(words) == 0 || !validNumber(segment.Start) || !validNumber(segment.End) || segment.End <= segment.Start {
			continue
		}

		cues = append(cues, captionCue{Start: segment.Start, End: segment.End, Text: strings.Join(words, " "), Words: []captionWord{}})
	}

	return cues
}

func cuesFromWords(words []transcriptionWord) []captionCue {
	words = append([]transcriptionWord(nil), words...)
	sort.SliceStable(words, func(i, j int) bool {
		return words[i].Start < words[j].Start
	})

	cues := make([]captionCue, 0, len(words)/maxCaptionWords+1)
	captionWords := make([]captionWord, 0, maxCaptionWords)
	var captionStart float64
	var captionEnd float64

	flush := func() {
		if len(captionWords) == 0 {
			return
		}
		timedWords := append([]captionWord(nil), captionWords...)
		for _, word := range captionWords {
			if len(strings.Fields(word.Text)) != 1 {
				timedWords = []captionWord{}
				break
			}
		}

		cues = append(cues, captionCue{
			Start: captionStart,
			End:   captionEnd,
			Text:  captionText(captionWords),
			Words: timedWords,
		})
		captionWords = captionWords[:0]
	}

	for _, word := range words {
		text := strings.TrimSpace(word.Word)
		if text == "" || !validNumber(word.Start) || !validNumber(word.End) || word.End <= word.Start {
			continue
		}

		if len(captionWords) > 0 {
			gap := time.Duration((word.Start - captionEnd) * float64(time.Second))
			duration := time.Duration((word.End - captionStart) * float64(time.Second))
			if len(captionWords) >= maxCaptionWords || gap >= captionPause || duration > maxCaptionDuration || endsSentence(captionWords[len(captionWords)-1].Text) {
				flush()
			}
		}

		if len(captionWords) == 0 {
			captionStart = word.Start
		}
		captionWords = append(captionWords, captionWord{Start: word.Start, End: word.End, Text: text})
		captionEnd = word.End
	}

	flush()
	return cues
}

func endsSentence(word string) bool {
	return strings.HasSuffix(word, ".") || strings.HasSuffix(word, "?") || strings.HasSuffix(word, "!")
}

func captionText(words []captionWord) string {
	text := make([]string, 0, len(words))
	for _, word := range words {
		text = append(text, word.Text)
	}
	return strings.Join(text, " ")
}

func srtTimestamp(ms int64) string {
	hours := ms / 3_600_000
	minutes := ms / 60_000 % 60
	seconds := ms / 1_000 % 60
	millis := ms % 1_000

	return fmt.Sprintf("%02d:%02d:%02d,%03d", hours, minutes, seconds, millis)
}
