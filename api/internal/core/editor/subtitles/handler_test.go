package subtitles

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRequestTranscriptionRequestsWordTimestampsFromPinnedProvider(t *testing.T) {
	audio := []byte("audio bytes")
	audioPath := filepath.Join(t.TempDir(), "audio.mp3")
	if err := os.WriteFile(audioPath, audio, 0600); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("unexpected authorization header: %q", request.Header.Get("Authorization"))
		}

		var payload transcriptionRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if payload.Model != "openai/whisper-large-v3" || payload.Language != "ro" {
			t.Errorf("unexpected model or language: %#v", payload)
		}
		if payload.InputAudio.Data != base64.StdEncoding.EncodeToString(audio) || payload.InputAudio.Format != "mp3" {
			t.Errorf("unexpected audio payload: %#v", payload.InputAudio)
		}
		if payload.ResponseFormat != "verbose_json" || strings.Join(payload.TimestampGranularities, ",") != "word,segment" {
			t.Errorf("unexpected timestamp options: %#v", payload)
		}
		if payload.Provider == nil || strings.Join(payload.Provider.Only, ",") != "groq" || payload.Provider.AllowFallbacks {
			t.Errorf("unexpected provider routing: %#v", payload.Provider)
		}

		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"text":"salut","words":[{"word":"salut","start":0.1,"end":0.5}]}`))
	}))
	defer server.Close()
	t.Setenv("OPENROUTER_BASE_URL", server.URL)

	result, err := requestTranscription(
		context.Background(),
		audioPath,
		"test-key",
		"openai/whisper-large-v3",
		"groq",
		"ro",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Words) != 1 || result.Words[0].Word != "salut" {
		t.Fatalf("unexpected response: %#v", result)
	}
}

func TestBuildSRTUsesWordTimestampsAndPreservesPauses(t *testing.T) {
	transcription := transcriptionResponse{
		Segments: []transcriptionSegment{{Start: 0, End: 6, Text: "fallback segment"}},
		Words: []transcriptionWord{
			{Start: 0.1, End: 0.4, Word: "one"},
			{Start: 0.5, End: 0.8, Word: "two"},
			{Start: 0.9, End: 1.2, Word: "three"},
			{Start: 1.3, End: 1.6, Word: "four"},
			{Start: 3.2, End: 3.5, Word: "five"},
			{Start: 3.6, End: 3.9, Word: "six"},
		},
	}

	srt, cueCount := buildSRT(transcription)
	expected := "1\n00:00:00,100 --> 00:00:01,600\none two three four\n\n" +
		"2\n00:00:03,200 --> 00:00:03,900\nfive six\n\n"

	if cueCount != 2 {
		t.Fatalf("expected 2 cues, got %d", cueCount)
	}
	if srt != expected {
		t.Fatalf("unexpected SRT:\n%s", srt)
	}
	if strings.Contains(srt, "fallback segment") {
		t.Fatal("expected word timestamps to take precedence over segments")
	}
	cues := buildCaptionCues(transcription)
	if len(cues) != 2 || len(cues[0].Words) != 4 {
		t.Fatalf("expected grouped cues to retain word timestamps: %#v", cues)
	}
	if cues[0].Words[2].Text != "three" || cues[0].Words[2].Start != 0.9 || cues[0].Words[2].End != 1.2 {
		t.Fatalf("unexpected retained word: %#v", cues[0].Words[2])
	}
}

func TestBuildSRTFallsBackToModelSegments(t *testing.T) {
	srt, cueCount := buildSRT(transcriptionResponse{
		Segments: []transcriptionSegment{{Start: 2, End: 4, Text: "model segment"}},
	})

	if cueCount != 1 {
		t.Fatalf("expected 1 cue, got %d", cueCount)
	}
	if srt != "1\n00:00:02,000 --> 00:00:04,000\nmodel segment\n\n" {
		t.Fatalf("unexpected SRT:\n%s", srt)
	}
	cues := buildCaptionCues(transcriptionResponse{
		Segments: []transcriptionSegment{{Start: 2, End: 4, Text: "model segment"}},
	})
	if len(cues) != 1 || len(cues[0].Words) != 0 || cues[0].Start != 2 || cues[0].End != 4 {
		t.Fatalf("segment timing must not be presented as measured word timing: %#v", cues)
	}
}

func TestPhraseInsideProviderWordIsNotPresentedAsIndividualWordAlignment(t *testing.T) {
	cues := buildCaptionCues(transcriptionResponse{Words: []transcriptionWord{
		{Start: 0, End: 0.8, Word: "își petrece"},
		{Start: 0.8, End: 1.3, Word: "copilăria"},
	}})
	if len(cues) != 1 || len(cues[0].Words) != 0 || cues[0].Text != "își petrece copilăria" || cues[0].End != 1.3 {
		t.Fatalf("a provider phrase was treated as a measured word: %+v", cues)
	}
}

func TestBuildSRTPreservesMeasuredSegmentsWithoutInventingSplitTimes(t *testing.T) {
	srt, cueCount := buildSRT(transcriptionResponse{
		Segments: []transcriptionSegment{{
			Start: 10,
			End:   18,
			Text:  "one two three four five six seven eight",
		}},
	})
	expected := "1\n00:00:10,000 --> 00:00:18,000\none two three four five six seven eight\n\n"

	if cueCount != 1 {
		t.Fatalf("expected one measured cue, got %d", cueCount)
	}
	if srt != expected {
		t.Fatalf("unexpected SRT:\n%s", srt)
	}
}

func TestResolveTranscriptionLanguagePrefersRequestThenEnv(t *testing.T) {
	t.Setenv("OPENROUTER_STT_LANGUAGE", "ro")
	if got := resolveTranscriptionLanguage("en"); got != "en" {
		t.Fatalf("expected explicit request language to win, got %q", got)
	}
	if got := resolveTranscriptionLanguage(""); got != "ro" {
		t.Fatalf("expected env fallback, got %q", got)
	}
	t.Setenv("OPENROUTER_STT_LANGUAGE", "")
	if got := resolveTranscriptionLanguage(""); got != "" {
		t.Fatalf("expected empty for auto-detect, got %q", got)
	}
}
