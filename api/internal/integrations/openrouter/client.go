package openrouter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"ffmpeg-go-server/internal/platform/credits"
)

const (
	// DefaultBaseURL is the OpenRouter API root when Client.BaseURL is empty.
	DefaultBaseURL = "https://openrouter.ai/api/v1"

	// maxChatResponseBody bounds a chat-completions payload. Chat responses
	// are JSON (no base64 media), so 2 MiB is generous without letting a
	// misbehaving upstream buffer unbounded data per request.
	maxChatResponseBody int64 = 2 << 20

	// maxChatAttempts bounds transient-error retries for chat completions.
	// The shared OpenRouter pool frequently returns 429 for popular models,
	// so a few backoff retries turn "mereu eroare" into a slow success.
	maxChatAttempts = 4
	// chatRetryBaseDelay is the base for exponential backoff between retries.
	chatRetryBaseDelay = 800 * time.Millisecond
	// chatRetryMaxDelay caps a single backoff sleep.
	chatRetryMaxDelay = 8 * time.Second
)

// Message is one chat turn sent to OpenRouter.
type Message struct {
	Role             string          `json:"role"`
	Content          json.RawMessage `json:"content,omitempty"`
	ToolCallID       string          `json:"tool_call_id,omitempty"`
	ToolCalls        []ToolCall      `json:"tool_calls,omitempty"`
	ReasoningDetails json.RawMessage `json:"reasoning_details,omitempty"`
}

// MessageContentPart is one multimodal content block.
type MessageContentPart struct {
	Type     string           `json:"type"`
	Text     string           `json:"text,omitempty"`
	ImageURL *MessageImageURL `json:"image_url,omitempty"`
}

// MessageImageURL carries an image URL inside a content part.
type MessageImageURL struct {
	URL string `json:"url"`
}

// TextMessage builds a plain-text chat turn.
func TextMessage(role, content string) Message {
	// Infallible: encoding a Go string to JSON never fails.
	encoded, _ := json.Marshal(content)
	return Message{Role: role, Content: encoded}
}

// TextContentPart builds a text block for a multimodal message.
func TextContentPart(text string) MessageContentPart {
	return MessageContentPart{Type: "text", Text: text}
}

// ImageURLContentPart builds an image block for a multimodal message.
func ImageURLContentPart(url string) MessageContentPart {
	return MessageContentPart{Type: "image_url", ImageURL: &MessageImageURL{URL: url}}
}

// ContentPartsMessage builds a multimodal chat turn.
func ContentPartsMessage(role string, parts []MessageContentPart) Message {
	// Infallible: parts are plain structs with no custom marshaling.
	encoded, _ := json.Marshal(parts)
	return Message{Role: role, Content: encoded}
}

// ToolResultMessage builds the tool reply for callID.
func ToolResultMessage(callID, content string) Message {
	message := TextMessage("tool", content)
	message.ToolCallID = callID
	return message
}

// TextContent returns the concatenated text of a chat message.
func (m Message) TextContent() string {
	return textContent(m.Content)
}

// FunctionDefinition describes one callable tool.
type FunctionDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters"`
}

// Tool is one function tool offered to the model.
type Tool struct {
	Type     string             `json:"type"`
	Function FunctionDefinition `json:"function"`
}

// ToolChoice constrains which tool the model must call.
type ToolChoice struct {
	Mode     string `json:"-"`
	Type     string `json:"type"`
	Function struct {
		Name string `json:"name"`
	} `json:"function"`
}

// ProviderPreferences routes the request to specific providers.
type ProviderPreferences struct {
	AllowFallbacks bool     `json:"allow_fallbacks"`
	Only           []string `json:"only,omitempty"`
}

// FunctionToolChoice forces a call to the named function.
func FunctionToolChoice(name string) ToolChoice {
	choice := ToolChoice{Type: "function"}
	choice.Function.Name = name
	return choice
}

// RequiredToolChoice forces the model to call some tool.
func RequiredToolChoice() ToolChoice {
	return ToolChoice{Mode: "required"}
}

func (choice ToolChoice) MarshalJSON() ([]byte, error) {
	if choice.Mode != "" {
		return json.Marshal(choice.Mode)
	}
	type toolChoice ToolChoice
	return json.Marshal(toolChoice(choice))
}

func (choice *ToolChoice) UnmarshalJSON(data []byte) error {
	// OpenRouter sends either a bare mode string ("required") or an object;
	// probing for a string first distinguishes the two encodings.
	var mode string
	if err := json.Unmarshal(data, &mode); err == nil {
		choice.Mode = mode
		choice.Type = ""
		choice.Function.Name = ""
		return nil
	}
	type toolChoice ToolChoice
	var decoded toolChoice
	if err := json.Unmarshal(data, &decoded); err != nil {
		return fmt.Errorf("decode tool choice: %w", err)
	}
	*choice = ToolChoice(decoded)
	return nil
}

// ChatCompletionRequest is a chat-completions call.
type ChatCompletionRequest struct {
	Model             string               `json:"model"`
	Messages          []Message            `json:"messages"`
	Tools             []Tool               `json:"tools,omitempty"`
	ToolChoice        ToolChoice           `json:"tool_choice,omitempty"`
	Provider          *ProviderPreferences `json:"provider,omitempty"`
	ParallelToolCalls bool                 `json:"parallel_tool_calls"`
	Temperature       float64              `json:"temperature"`
	MaxTokens         int                  `json:"max_tokens,omitempty"`
	Reasoning         *ReasoningConfig     `json:"reasoning,omitempty"`
}

type ReasoningConfig struct {
	Enabled *bool  `json:"enabled,omitempty"`
	Effort  string `json:"effort,omitempty"`
}

type CompletionUsage struct {
	PromptTokens            int `json:"prompt_tokens"`
	CompletionTokens        int `json:"completion_tokens"`
	CompletionTokensDetails struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details"`
}

// ToolCall is one function invocation requested by the model.
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// ResponseMessage is one model reply.
type ResponseMessage struct {
	Role             string          `json:"role"`
	Content          json.RawMessage `json:"content"`
	ToolCalls        []ToolCall      `json:"tool_calls"`
	ReasoningDetails json.RawMessage `json:"reasoning_details,omitempty"`
}

// TextContent returns the concatenated text of a model reply.
func (m ResponseMessage) TextContent() string {
	return textContent(m.Content)
}

// RequestMessage converts a model reply back into a request turn.
func (m ResponseMessage) RequestMessage() Message {
	return Message{
		Role:             m.Role,
		Content:          m.Content,
		ToolCalls:        m.ToolCalls,
		ReasoningDetails: m.ReasoningDetails,
	}
}

func textContent(content json.RawMessage) string {
	if len(content) == 0 || bytes.Equal(content, []byte("null")) {
		return ""
	}
	var text string
	if json.Unmarshal(content, &text) == nil {
		return text
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(content, &parts) == nil {
		var result strings.Builder
		for _, part := range parts {
			if part.Type == "text" || part.Type == "output_text" {
				result.WriteString(part.Text)
			}
		}
		return result.String()
	}
	return ""
}

// ChatCompletionResponse is a chat-completions reply.
type ChatCompletionResponse struct {
	ID       string          `json:"id"`
	Model    string          `json:"model"`
	Provider string          `json:"provider"`
	Usage    CompletionUsage `json:"usage"`
	Choices  []struct {
		Index        int             `json:"index"`
		Message      ResponseMessage `json:"message"`
		FinishReason string          `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Code    any    `json:"code"`
	} `json:"error,omitempty"`
}

// Client calls OpenRouter. HTTPClient may be replaced in tests;
// a nil client uses http.DefaultClient.
type Client struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
	Referer    string
	Title      string
	Debug      bool
	// MaxAttempts overrides the default transient-error retry budget.
	// Values <= 0 use maxChatAttempts. Tests set 1 for single-attempt asserts.
	MaxAttempts int
}

func (c Client) baseURL() string {
	if base := strings.TrimRight(c.BaseURL, "/"); base != "" {
		return base
	}
	return DefaultBaseURL
}

func (c Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	// Never return http.DefaultClient (no Timeout): hung upstream would block
	// goroutines indefinitely (was DoS + SSRF redirect chain).
	return defaultOpenRouterClient
}

var defaultOpenRouterClient = &http.Client{
	Timeout: 30 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 2 {
			return http.ErrUseLastResponse
		}
		if len(via) > 0 && req.URL.Host != via[0].URL.Host {
			req.Header.Del("Authorization")
		}
		return nil
	},
}

func (c Client) newRequest(ctx context.Context, path string, body []byte) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL()+path, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create OpenRouter request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	if c.Referer != "" {
		req.Header.Set("HTTP-Referer", c.Referer)
	}
	if c.Title != "" {
		req.Header.Set("X-Title", c.Title)
	}
	return req, nil
}

func (c Client) do(req *http.Request, limit int64, what string) ([]byte, int, http.Header, error) {
	if strings.HasSuffix(req.URL.Path, "/audio/speech") || strings.HasSuffix(req.URL.Path, "/audio/transcriptions") {
		req = req.WithContext(credits.WithAudioMinimum(req.Context()))
	}
	attempt, err := credits.StartProvider(req.Context())
	if err != nil {
		return nil, 0, nil, err
	}
	response, err := c.httpClient().Do(req)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("call OpenRouter: %w", err)
	}
	defer response.Body.Close()
	data, err := readLimited(response.Body, limit, what)
	if err != nil {
		// A broken audio stream can still be billable; preserve the provider's lookup key.
		if generation := strings.TrimSpace(response.Header.Get("X-Generation-Id")); attempt != "" && generation != "" {
			meter := credits.FromContext(req.Context())
			if noteErr := meter.Store.NoteGeneration(meter.Owner, meter.ID, attempt, generation); noteErr != nil {
				return nil, 0, nil, fmt.Errorf("record interrupted provider usage: %w", noteErr)
			}
		}
		return nil, 0, nil, err
	}
	if err := c.recordUsage(req.Context(), attempt, data, response.StatusCode, response.Header); err != nil {
		return nil, 0, nil, err
	}
	return data, response.StatusCode, response.Header, nil
}

func readLimited(body io.Reader, limit int64, what string) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", what, err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s exceeds %d byte limit", what, limit)
	}
	return data, nil
}

// providerMessage extracts {"error":{"message":...}} or "" when absent.
func providerMessage(body []byte) string {
	var providerError struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	// Best-effort: a non-JSON error body just falls back to the HTTP status.
	if json.Unmarshal(body, &providerError) == nil {
		return providerError.Error.Message
	}
	return ""
}

func httpStatusError(status int, body []byte) error {
	if message := providerMessage(body); message != "" {
		return &HTTPStatusError{Status: status, Message: message}
	}
	return &HTTPStatusError{Status: status}
}

// HTTPStatusError carries the upstream HTTP status so callers can distinguish
// rate limits (429) from other failures and decide to retry or to surface a
// friendly message instead of a raw provider dump.
type HTTPStatusError struct {
	Status  int
	Message string
}

func (e *HTTPStatusError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("OpenRouter HTTP %d: %s", e.Status, e.Message)
	}
	return fmt.Sprintf("OpenRouter HTTP %d", e.Status)
}

// Retryable reports whether the request is worth retrying with backoff
// (rate limits and transient upstream 5xx).
func (e *HTTPStatusError) Retryable() bool {
	return e.Status == http.StatusTooManyRequests ||
		e.Status == http.StatusBadGateway ||
		e.Status == http.StatusServiceUnavailable ||
		e.Status == http.StatusGatewayTimeout
}

// IsRateLimited reports whether err is an upstream 429.
func IsRateLimited(err error) bool {
	var statusErr *HTTPStatusError
	if errors.As(err, &statusErr) {
		return statusErr.Status == http.StatusTooManyRequests
	}
	return false
}

// IsRetryable reports whether err is a transient upstream failure.
func IsRetryable(err error) bool {
	var statusErr *HTTPStatusError
	if errors.As(err, &statusErr) {
		return statusErr.Retryable()
	}
	return false
}

// RateLimitedError returns a user-actionable error for upstream 429s. It keeps
// the original message for logs while telling the user to retry shortly or to
// add their own provider key (the remedy OpenRouter itself suggests for shared
// pool limits).
func RateLimitedError(operation string) error {
	return fmt.Errorf("%s: AI provider is temporarily rate-limited (shared pool). Please retry in ~30s. If it persists, add your own provider key in OpenRouter integrations or pick another model", operation)
}

// maxLoggedBodyBytes caps debug-logged payloads. Vision requests embed
// base64 JPEGs (megabytes); logging them whole fills disks and slows the
// server without adding debuggable information.
const maxLoggedBodyBytes = 8 << 10

var dataURLPattern = regexp.MustCompile(`data:image/[A-Za-z0-9+.-]+;base64,[A-Za-z0-9+/=]+`)

// redactForLog replaces embedded base64 media with a size placeholder and
// truncates overlong bodies so [AI DEBUG] stays readable.
func redactForLog(body []byte) string {
	redacted := dataURLPattern.ReplaceAllFunc(body, func(match []byte) []byte {
		return []byte(fmt.Sprintf(`"data:image/...<%d bytes base64>"`, len(match)))
	})
	if len(redacted) > maxLoggedBodyBytes {
		return string(redacted[:maxLoggedBodyBytes]) + fmt.Sprintf("...<%d more bytes>", len(redacted)-maxLoggedBodyBytes)
	}
	return string(redacted)
}

// ChatCompletion sends a chat-completions request, retrying transient upstream
// failures (429/502/503/504) with exponential backoff. A fresh HTTP request is
// built per attempt because the body reader is consumed by each round trip.
func (c Client) ChatCompletion(ctx context.Context, request ChatCompletionRequest) (ChatCompletionResponse, error) {
	var result ChatCompletionResponse
	body, err := json.Marshal(request)
	if err != nil {
		return result, fmt.Errorf("encode OpenRouter request: %w", err)
	}
	if c.Debug {
		log.Printf("[AI DEBUG] OpenRouter request: %s", redactForLog(body))
	}
	attempts := c.maxAttempts()
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		req, err := c.newRequest(ctx, "/chat/completions", body)
		if err != nil {
			return result, err
		}
		raw, status, header, err := c.do(req, maxChatResponseBody, "OpenRouter response")
		if err != nil {
			lastErr = err
		} else {
			if c.Debug {
				log.Printf("[AI DEBUG] OpenRouter response status=%d body=%s", status, redactForLog(raw))
			}
			if status >= 200 && status < 300 {
				if err := json.Unmarshal(raw, &result); err != nil {
					return result, fmt.Errorf("decode OpenRouter response: %w", err)
				}
				if result.Error != nil {
					return result, fmt.Errorf("OpenRouter: %s", result.Error.Message)
				}
				return result, nil
			}
			lastErr = httpStatusError(status, raw)
			if !IsRetryable(lastErr) || attempt == attempts {
				return result, lastErr
			}
			if wait, ok := retryAfter(header); ok {
				if !sleepContext(ctx, wait) {
					return result, ctx.Err()
				}
				continue
			}
		}
		if attempt < attempts {
			if !IsRetryable(lastErr) {
				return result, lastErr
			}
			if !sleepContext(ctx, backoffDelay(attempt)) {
				return result, ctx.Err()
			}
		}
	}
	if lastErr != nil {
		return result, lastErr
	}
	return result, fmt.Errorf("OpenRouter request failed")
}

func (c Client) maxAttempts() int {
	if c.MaxAttempts > 0 {
		return c.MaxAttempts
	}
	return maxChatAttempts
}

// backoffDelay returns exponential backoff with jitter for the 1-based attempt.
func backoffDelay(attempt int) time.Duration {
	delay := chatRetryBaseDelay << (attempt - 1)
	if delay > chatRetryMaxDelay {
		delay = chatRetryMaxDelay
	}
	// Full jitter keeps concurrent AI requests from retrying in lockstep.
	return time.Duration(rand.Int63n(int64(delay) + 1))
}

// retryAfter honors an upstream Retry-After hint (seconds or HTTP date).
func retryAfter(header http.Header) (time.Duration, bool) {
	value := strings.TrimSpace(header.Get("Retry-After"))
	if value == "" {
		return 0, false
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		if seconds > int(chatRetryMaxDelay.Seconds()) {
			return chatRetryMaxDelay, true
		}
		return time.Duration(seconds) * time.Second, true
	}
	if when, err := http.ParseTime(value); err == nil {
		delay := time.Until(when)
		if delay < 0 {
			delay = 0
		}
		if delay > chatRetryMaxDelay {
			delay = chatRetryMaxDelay
		}
		return delay, true
	}
	return 0, false
}

func sleepContext(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		return true
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
