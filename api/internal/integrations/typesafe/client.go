package typesafe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

const (
	defaultBaseURL   = "https://openrouter.ai/api"
	maxResponseBytes = 1 << 20
)

var defaultHTTPClient = &http.Client{Timeout: 15 * time.Second}

type Client struct {
	APIKey      string
	BaseURL     string
	HTTPClient  *http.Client
	MaxAttempts int
}

type Question struct {
	Type         string            `json:"type"`
	Instructions string            `json:"instructions"`
	Criteria     map[string]string `json:"criteria,omitempty"`
}

type Request struct {
	Model     string              `json:"model"`
	State     any                 `json:"state"`
	Questions map[string]Question `json:"questions"`
}

type Answer struct {
	Type          string             `json:"type"`
	Noul          *float64           `json:"noul,omitempty"`
	Choice        string             `json:"choice,omitempty"`
	Confidence    *float64           `json:"confidence,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
}

type Response struct {
	Model   string            `json:"model"`
	Answers map[string]Answer `json:"answers"`
}

type StatusError struct {
	Code int
}

func (err *StatusError) Error() string {
	return fmt.Sprintf("OpenRouter Jev returned HTTP %d", err.Code)
}

func (client Client) Evaluate(ctx context.Context, request Request) (Response, error) {
	attempts := client.MaxAttempts
	if attempts < 1 {
		attempts = 1
	}
	if attempts > 4 {
		attempts = 4
	}
	for attempt := 0; attempt < attempts; attempt++ {
		result, err := client.evaluateOnce(ctx, request)
		if err == nil {
			return result, nil
		}
		var status *StatusError
		if !errors.As(err, &status) || status.Code != http.StatusTooManyRequests && status.Code != 529 || attempt == attempts-1 {
			return Response{}, err
		}
		wait := time.NewTimer(time.Duration(250<<attempt) * time.Millisecond)
		select {
		case <-ctx.Done():
			wait.Stop()
			return Response{}, ctx.Err()
		case <-wait.C:
		}
	}
	return Response{}, fmt.Errorf("TypeSafe retry budget exhausted")
}

func (client Client) evaluateOnce(ctx context.Context, request Request) (Response, error) {
	if client.APIKey == "" {
		return Response{}, fmt.Errorf("OpenRouter API key is missing")
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		return Response{}, fmt.Errorf("encode TypeSafe request: %w", err)
	}
	baseURL := strings.TrimRight(client.BaseURL, "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/v1/systemone", bytes.NewReader(encoded))
	if err != nil {
		return Response{}, fmt.Errorf("create TypeSafe request: %w", err)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+client.APIKey)
	httpRequest.Header.Set("Content-Type", "application/json")
	httpClient := client.HTTPClient
	if httpClient == nil {
		httpClient = defaultHTTPClient
	}
	provider := openrouter.Client{APIKey: client.APIKey, BaseURL: baseURL + "/v1", HTTPClient: httpClient}
	raw, status, _, err := provider.Do(httpRequest, maxResponseBytes, "TypeSafe response")
	if err != nil {
		return Response{}, fmt.Errorf("send TypeSafe request: %w", err)
	}
	if status != http.StatusOK {
		return Response{}, &StatusError{Code: status}
	}
	var result Response
	if err := json.Unmarshal(raw, &result); err != nil {
		return Response{}, fmt.Errorf("decode TypeSafe response: %w", err)
	}
	if len(result.Answers) == 0 {
		return Response{}, fmt.Errorf("TypeSafe response has no answers")
	}
	return result, nil
}
