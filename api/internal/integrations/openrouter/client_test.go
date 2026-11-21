package openrouter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatCompletionSendsOpenRouterHeadersAndDecodesToolCall(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("authorization = %q", got)
		}
		if got := r.Header.Get("HTTP-Referer"); got != "https://example.test" {
			t.Fatalf("referer = %q", got)
		}
		if got := r.Header.Get("X-Title"); got != "machinal" {
			t.Fatalf("title = %q", got)
		}
		var request ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.Model != "small/model" || request.ToolChoice.Function.Name != "edit_timeline" || request.Messages[0].TextContent() != "edit" {
			t.Fatalf("unexpected request: %+v", request)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"response","choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call","type":"function","function":{"name":"edit_timeline","arguments":"{\"summary\":\"Cut\",\"operations\":[]}"}}]},"finish_reason":"tool_calls"}]}`))
	}))
	defer server.Close()

	client := Client{
		APIKey:     "secret",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
		Referer:    "https://example.test",
		Title:      "machinal",
	}
	response, err := client.ChatCompletion(context.Background(), ChatCompletionRequest{
		Model:      "small/model",
		Messages:   []Message{TextMessage("user", "edit")},
		ToolChoice: FunctionToolChoice("edit_timeline"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := response.Choices[0].Message.ToolCalls[0].Function.Name; got != "edit_timeline" {
		t.Fatalf("tool name = %q", got)
	}
}

func TestChatCompletionSendsAssistantToolCallAndToolResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		messages := body["messages"].([]any)
		assistant := messages[1].(map[string]any)
		toolResult := messages[2].(map[string]any)
		if assistant["role"] != "assistant" || assistant["content"] != nil || len(assistant["tool_calls"].([]any)) != 1 {
			t.Fatalf("assistant message = %#v", assistant)
		}
		if toolResult["role"] != "tool" || toolResult["tool_call_id"] != "inspect-1" || toolResult["content"] != `{"sources":[]}` {
			t.Fatalf("tool result = %#v", toolResult)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`))
	}))
	defer server.Close()

	call := ToolCall{ID: "inspect-1", Type: "function"}
	call.Function.Name = "inspect_editor"
	call.Function.Arguments = `{}`
	assistant := ResponseMessage{
		Role:             "assistant",
		Content:          json.RawMessage("null"),
		ToolCalls:        []ToolCall{call},
		ReasoningDetails: json.RawMessage(`[{"type":"reasoning.text","text":"inspect"}]`),
	}
	_, err := (Client{APIKey: "secret", BaseURL: server.URL, HTTPClient: server.Client()}).ChatCompletion(
		context.Background(),
		ChatCompletionRequest{
			Model: "small/model",
			Messages: []Message{
				TextMessage("user", "edit"),
				assistant.RequestMessage(),
				ToolResultMessage("inspect-1", `{"sources":[]}`),
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
}

func TestRequiredToolChoiceUsesOpenAIStringForm(t *testing.T) {
	encoded, err := json.Marshal(ChatCompletionRequest{ToolChoice: RequiredToolChoice()})
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &body); err != nil {
		t.Fatal(err)
	}
	if string(body["tool_choice"]) != `"required"` {
		t.Fatalf("tool_choice = %s", body["tool_choice"])
	}
}

func TestChatCompletionReturnsProviderMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"rate limited"}}`))
	}))
	defer server.Close()

	_, err := (Client{APIKey: "secret", BaseURL: server.URL, HTTPClient: server.Client(), MaxAttempts: 1}).ChatCompletion(
		context.Background(),
		ChatCompletionRequest{Model: "small/model"},
	)
	if err == nil || err.Error() != "OpenRouter HTTP 429: rate limited" {
		t.Fatalf("error = %v", err)
	}
	if !IsRateLimited(err) || !IsRetryable(err) {
		t.Fatalf("429 must be rate-limited and retryable: %v", err)
	}
}

func TestChatCompletionRetriesRateLimitThenSucceeds(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"Provider returned error"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`))
	}))
	defer server.Close()

	response, err := (Client{APIKey: "secret", BaseURL: server.URL, HTTPClient: server.Client(), MaxAttempts: 4}).ChatCompletion(
		context.Background(),
		ChatCompletionRequest{Model: "small/model"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("calls = %d, want 3", calls)
	}
	if got := response.Choices[0].Message.TextContent(); got != "ok" {
		t.Fatalf("content = %q", got)
	}
}

func TestChatCompletionDoesNotRetryBadRequest(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"bad request"}}`))
	}))
	defer server.Close()

	_, err := (Client{APIKey: "secret", BaseURL: server.URL, HTTPClient: server.Client()}).ChatCompletion(
		context.Background(),
		ChatCompletionRequest{Model: "small/model"},
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 (no retry on 400)", calls)
	}
	if IsRetryable(err) {
		t.Fatalf("400 must not be retryable: %v", err)
	}
}

func TestContentPartsMessageEncodesTextAndImage(t *testing.T) {
	message := ContentPartsMessage("user", []MessageContentPart{
		TextContentPart("Frame 0"),
		ImageURLContentPart("data:image/jpeg;base64,abc"),
	})
	var parts []MessageContentPart
	if err := json.Unmarshal(message.Content, &parts); err != nil {
		t.Fatal(err)
	}
	if message.Role != "user" || len(parts) != 2 || parts[0].Text != "Frame 0" || parts[1].ImageURL == nil || parts[1].ImageURL.URL != "data:image/jpeg;base64,abc" {
		t.Fatalf("message = %+v parts = %+v", message, parts)
	}
}

func TestRedactForLogStripsBase64AndTruncates(t *testing.T) {
	payload := []byte(`{"url":"data:image/jpeg;base64,` + strings.Repeat("A", 5000) + `"}`)
	redacted := redactForLog(payload)
	if strings.Contains(redacted, strings.Repeat("A", 100)) {
		t.Fatal("base64 payload must not survive redaction")
	}
	if !strings.Contains(redacted, "bytes base64") {
		t.Fatalf("redacted = %s", redacted)
	}
	long := []byte(`{"text":"` + strings.Repeat("x", maxLoggedBodyBytes+100) + `"}`)
	if got := redactForLog(long); !strings.HasSuffix(got, "more bytes>") {
		t.Fatalf("long body must be truncated, got %d chars", len(got))
	}
}
