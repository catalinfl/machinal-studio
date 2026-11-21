package subtitles

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"ffmpeg-go-server/internal/integrations/openrouter"

	"github.com/gofiber/fiber/v2"
)

const (
	// STT extraction profile: mono 16kHz MP3 keeps payloads small enough
	// for the provider limit while preserving transcription quality.
	sttChannels   = "1"
	sttSampleRate = "16000"
	sttBitrate    = "64k"

	transcriptionResponseLimit = 16 << 20 // 16MB
)

type ffmpegRunner func(ctx context.Context, args ...string) error

// sharedTranscriptionClient is reused across requests so STT calls share
// one pooled transport instead of building a client per transcription.
var sharedTranscriptionClient = &http.Client{
	Timeout: transcriptionTimeout,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 2 {
			return http.ErrUseLastResponse
		}
		return nil
	},
}

func extractAudio(ctx context.Context, runFFmpeg ffmpegRunner, inputPath string, outputPath string, start float64, duration float64) error {
	args := []string{
		"-hide_banner",
		"-loglevel", "error",
		"-protocol_whitelist", "file,pipe",
		"-i", inputPath,
	}

	if start > 0 {
		args = append(args, "-ss", ffmpegNumber(start))
	}

	if duration > 0 {
		args = append(args, "-t", ffmpegNumber(duration))
	}

	args = append(args,
		"-map", "0:a:0",
		"-vn",
		"-ac", sttChannels,
		"-ar", sttSampleRate,
		"-c:a", "libmp3lame",
		"-b:a", sttBitrate,
		"-y",
		outputPath,
	)

	if err := runFFmpeg(ctx, args...); err != nil {
		return requestErrorf(fiber.StatusUnprocessableEntity, err, "cannot extract audio")
	}

	return nil
}

func requestTranscription(
	ctx context.Context,
	audioPath string,
	apiKey string,
	model string,
	provider string,
	language string,
) (transcriptionResponse, error) {
	var result transcriptionResponse

	audio, err := os.ReadFile(audioPath)
	if err != nil {
		return result, fmt.Errorf("read extracted audio: %w", err)
	}

	payload := buildTranscriptionPayload(audio, model, provider, language)

	body, err := json.Marshal(payload)
	if err != nil {
		return result, fmt.Errorf("encode transcription request: %w", err)
	}

	request, err := newTranscriptionHTTPRequest(ctx, body, apiKey)
	if err != nil {
		return result, err
	}

	client := openrouter.Client{APIKey: apiKey, BaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/"), HTTPClient: sharedTranscriptionClient}
	raw, status, _, err := client.Do(request, transcriptionResponseLimit, "transcription response")
	if err != nil {
		return result, fmt.Errorf("call OpenRouter: %w", err)
	}
	return decodeTranscriptionResponse(status, raw)
}

func buildTranscriptionPayload(audio []byte, model, provider, language string) transcriptionRequest {
	payload := transcriptionRequest{
		Model: model,
		InputAudio: transcriptionAudio{
			Data:   base64.StdEncoding.EncodeToString(audio),
			Format: "mp3",
		},
		Language:               language,
		ResponseFormat:         "verbose_json",
		TimestampGranularities: []string{"word", "segment"},
	}
	if provider != "" {
		payload.Provider = &transcriptionProvider{
			Only:           []string{provider},
			AllowFallbacks: false,
		}
	}
	return payload
}

func newTranscriptionHTTPRequest(ctx context.Context, body []byte, apiKey string) (*http.Request, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		baseURL+"/audio/transcriptions",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create OpenRouter request: %w", err)
	}

	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")

	if referer := strings.TrimSpace(os.Getenv("OPENROUTER_HTTP_REFERER")); referer != "" {
		request.Header.Set("HTTP-Referer", referer)
	}
	if title := strings.TrimSpace(os.Getenv("OPENROUTER_APP_NAME")); title != "" {
		request.Header.Set("X-Title", title)
	}
	return request, nil
}

func decodeTranscriptionResponse(status int, responseBody []byte) (transcriptionResponse, error) {
	var result transcriptionResponse
	if status < 200 || status >= 300 {
		return result, transcriptionProviderError(status, responseBody)
	}

	if err := json.Unmarshal(responseBody, &result); err != nil {
		return result, fmt.Errorf("decode OpenRouter response: %w", err)
	}
	if result.Error != nil {
		return result, fmt.Errorf("OpenRouter: %s", result.Error.Message)
	}

	return result, nil
}

func transcriptionProviderError(status int, body []byte) error {
	var providerError struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	// Best-effort: a non-JSON error body just falls through to the status-only error.
	if json.Unmarshal(body, &providerError) == nil && providerError.Error.Message != "" {
		return fmt.Errorf(
			"OpenRouter HTTP %d: %s",
			status,
			providerError.Error.Message,
		)
	}
	return fmt.Errorf("OpenRouter HTTP %d", status)
}
