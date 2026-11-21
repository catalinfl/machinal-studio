package openrouter

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
)

// maxImageResponseBody caps an image response carrying base64 payloads.
// 32 MiB fits a single high-resolution image plus JSON framing without
// letting a misbehaving upstream buffer unbounded data per request.
const maxImageResponseBody int64 = 32 << 20

// ImageURL is an image reference URL.
type ImageURL struct {
	URL string `json:"url"`
}

// ImageInputReference is one edit/reference image.
type ImageInputReference struct {
	Type     string   `json:"type"`
	ImageURL ImageURL `json:"image_url"`
}

// DataURLImageReference wraps a data: URL as an edit reference.
func DataURLImageReference(dataURL string) ImageInputReference {
	return ImageInputReference{
		Type:     "image_url",
		ImageURL: ImageURL{URL: dataURL},
	}
}

// ImageRequest is an image generation call.
type ImageRequest struct {
	Model           string                `json:"model"`
	Prompt          string                `json:"prompt"`
	InputReferences []ImageInputReference `json:"input_references,omitempty"`
	Resolution      string                `json:"resolution,omitempty"`
	AspectRatio     string                `json:"aspect_ratio,omitempty"`
	Quality         string                `json:"quality,omitempty"`
	OutputFormat    string                `json:"output_format,omitempty"`
	Background      string                `json:"background,omitempty"`
}

// ImageData is one generated image.
type ImageData struct {
	B64JSON   string `json:"b64_json"`
	MediaType string `json:"media_type,omitempty"`
}

// ImageError is a provider-side failure.
type ImageError struct {
	Message string `json:"message"`
	Code    any    `json:"code,omitempty"`
}

// ImageResponse is an image generation reply.
type ImageResponse struct {
	Created int64       `json:"created"`
	Data    []ImageData `json:"data"`
	Error   *ImageError `json:"error,omitempty"`
}

// GenerateImage sends an image generation request.
func (c Client) GenerateImage(ctx context.Context, request ImageRequest) (ImageResponse, error) {
	var result ImageResponse
	body, err := json.Marshal(request)
	if err != nil {
		return result, fmt.Errorf("encode OpenRouter image request: %w", err)
	}
	if c.Debug {
		log.Printf(
			"[AI DEBUG] OpenRouter image request model=%q prompt_bytes=%d references=%d resolution=%q aspect_ratio=%q quality=%q output_format=%q background=%q",
			request.Model,
			len(request.Prompt),
			len(request.InputReferences),
			request.Resolution,
			request.AspectRatio,
			request.Quality,
			request.OutputFormat,
			request.Background,
		)
	}
	req, err := c.newRequest(ctx, "/images", body)
	if err != nil {
		return result, err
	}
	responseBody, status, _, err := c.do(req, maxImageResponseBody, "OpenRouter image response")
	if err != nil {
		return result, err
	}
	if c.Debug {
		log.Printf("[AI DEBUG] OpenRouter image response status=%d bytes=%d", status, len(responseBody))
	}
	if status < 200 || status >= 300 {
		return result, httpStatusError(status, responseBody)
	}
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return result, fmt.Errorf("decode OpenRouter image response: %w", err)
	}
	if result.Error != nil {
		return result, fmt.Errorf("OpenRouter: %s", result.Error.Message)
	}
	return result, nil
}
