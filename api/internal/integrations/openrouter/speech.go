package openrouter

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// maxSpeechResponseBody caps a speech payload. 32 MiB fits long-form audio
// in a single response without letting a misbehaving upstream buffer
// unbounded data per request.
const maxSpeechResponseBody int64 = 32 << 20

// SpeechInputAudio is reference audio for voice cloning.
type SpeechInputAudio struct {
	Data string `json:"data"`
}

// SpeechInputReference is one voice/text reference.
type SpeechInputReference struct {
	Type       string            `json:"type"`
	InputAudio *SpeechInputAudio `json:"input_audio,omitempty"`
	Text       string            `json:"text,omitempty"`
}

// SpeechRequest is a text-to-speech call.
type SpeechRequest struct {
	Model           string                 `json:"model"`
	Input           string                 `json:"input"`
	Voice           string                 `json:"voice,omitempty"`
	Instructions    string                 `json:"instructions,omitempty"`
	Provider        *SpeechProvider        `json:"provider,omitempty"`
	ResponseFormat  string                 `json:"response_format"`
	InputReferences []SpeechInputReference `json:"input_references,omitempty"`
}

type SpeechProvider struct {
	Options map[string]any `json:"options"`
}

// SpeechResponse is raw audio plus provider metadata.
type SpeechResponse struct {
	Data         []byte
	MediaType    string
	GenerationID string
}

// GenerateSpeech sends a text-to-speech request.
func (c Client) GenerateSpeech(ctx context.Context, request SpeechRequest) (SpeechResponse, error) {
	var result SpeechResponse
	body, err := json.Marshal(request)
	if err != nil {
		return result, fmt.Errorf("encode OpenRouter speech request: %w", err)
	}
	req, err := c.newRequest(ctx, "/audio/speech", body)
	if err != nil {
		return result, err
	}
	responseBody, status, header, err := c.do(req, maxSpeechResponseBody, "OpenRouter speech response")
	if err != nil {
		return result, err
	}
	if status < 200 || status >= 300 {
		return result, httpStatusError(status, responseBody)
	}
	if len(responseBody) == 0 {
		return result, fmt.Errorf("OpenRouter returned no speech audio")
	}
	result.Data = responseBody
	result.MediaType = strings.TrimSpace(strings.Split(header.Get("Content-Type"), ";")[0])
	result.GenerationID = strings.TrimSpace(header.Get("X-Generation-Id"))
	return result, nil
}
