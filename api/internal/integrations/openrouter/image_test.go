package openrouter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGenerateImageSendsOptionsAndDecodesImage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/images" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
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

		var request ImageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.Model != "image/model" || request.Prompt != "paint a lake" {
			t.Fatalf("request = %+v", request)
		}
		if request.Resolution != "1K" || request.AspectRatio != "16:9" || request.Quality != "high" || request.OutputFormat != "png" || request.Background != "transparent" {
			t.Fatalf("options = %+v", request)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"created":123,"data":[{"b64_json":"aW1hZ2U=","media_type":"image/png"}]}`))
	}))
	defer server.Close()

	response, err := (Client{
		APIKey:     "secret",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
		Referer:    "https://example.test",
		Title:      "machinal",
	}).GenerateImage(context.Background(), ImageRequest{
		Model:        "image/model",
		Prompt:       "paint a lake",
		Resolution:   "1K",
		AspectRatio:  "16:9",
		Quality:      "high",
		OutputFormat: "png",
		Background:   "transparent",
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Created != 123 || len(response.Data) != 1 || response.Data[0].B64JSON != "aW1hZ2U=" || response.Data[0].MediaType != "image/png" {
		t.Fatalf("response = %+v", response)
	}
}

func TestGenerateImageSendsDataURLReference(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request ImageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if len(request.InputReferences) != 1 {
			t.Fatalf("references = %+v", request.InputReferences)
		}
		reference := request.InputReferences[0]
		if reference.Type != "image_url" || reference.ImageURL.URL != "data:image/jpeg;base64,aW1hZ2U=" {
			t.Fatalf("reference = %+v", reference)
		}
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"aW1hZ2U=","media_type":"image/jpeg"}]}`))
	}))
	defer server.Close()

	_, err := (Client{
		APIKey:     "secret",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	}).GenerateImage(context.Background(), ImageRequest{
		Model:  "edit/model",
		Prompt: "make it warmer",
		InputReferences: []ImageInputReference{
			DataURLImageReference("data:image/jpeg;base64,aW1hZ2U="),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestGenerateImageReturnsProviderMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"unsupported aspect ratio"}}`))
	}))
	defer server.Close()

	_, err := (Client{APIKey: "secret", BaseURL: server.URL, HTTPClient: server.Client()}).GenerateImage(
		context.Background(),
		ImageRequest{Model: "image/model", Prompt: "test"},
	)
	if err == nil || err.Error() != "OpenRouter HTTP 400: unsupported aspect ratio" {
		t.Fatalf("error = %v", err)
	}
}
