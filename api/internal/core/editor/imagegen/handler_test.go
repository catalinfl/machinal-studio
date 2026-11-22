package imagegen

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"

	"github.com/gofiber/fiber/v2"
)

func TestGenerateTextToImageSavesRasterAndReturnsMetadata(t *testing.T) {
	generated := testPNG(t, 3, 2, false)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/images" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("HTTP-Referer") != "https://direction.al" || r.Header.Get("X-Title") != "machinal" {
			t.Errorf("missing OpenRouter application headers")
		}
		var request openrouter.ImageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if request.Model != "sourceful/riverflow-v2.5-fast" || request.Prompt != "A quiet mountain lake" {
			t.Errorf("request = %+v", request)
		}
		if request.Resolution != "1K" || request.AspectRatio != "16:9" || request.Quality != "" || request.Background != "opaque" || request.OutputFormat != "" {
			t.Errorf("options = %+v", request)
		}
		if len(request.InputReferences) != 0 {
			t.Errorf("unexpected references: %+v", request.InputReferences)
		}
		writeProviderImage(t, w, generated, "image/png")
	}))
	defer provider.Close()

	app, dataDir := testApp(t, provider.URL)
	response := performRequest(t, app, `{"prompt":"A quiet mountain lake","model":"sourceful/riverflow-v2.5-fast","aspect":"16:9","background":"opaque","quality":"high"}`)
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, readBody(t, response))
	}

	var result generateResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if len(result.ID) != 32 || result.Name != "ai_image_"+result.ID+".png" {
		t.Fatalf("identity = %+v", result)
	}
	if result.MediaType != "image/png" || result.Width != 3 || result.Height != 2 || result.SourceMode != "proxy" {
		t.Fatalf("response = %+v", result)
	}
	saved, err := os.ReadFile(filepath.Join(dataDir, result.Name))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(saved, generated) {
		t.Fatal("saved image differs from provider output")
	}
}

func TestGenerateImageUsesStoredReferenceAndLowestCostRiverflowTier(t *testing.T) {
	source := testPNG(t, 2, 2, false)
	generated := testPNG(t, 4, 3, false)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openrouter.ImageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if request.Model != "sourceful/riverflow-v2.5-fast" || request.Resolution != "1K" || request.Quality != "" || len(request.InputReferences) != 1 {
			t.Errorf("request = %+v", request)
		}
		wantDataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(source)
		if got := request.InputReferences[0]; got.Type != "image_url" || got.ImageURL.URL != wantDataURL {
			t.Errorf("reference = %+v", got)
		}
		writeProviderImage(t, w, generated, "image/png")
	}))
	defer provider.Close()

	app, dataDir := testApp(t, provider.URL)
	if err := os.WriteFile(filepath.Join(dataDir, "source.png"), source, 0600); err != nil {
		t.Fatal(err)
	}

	response := performRequest(t, app, `{"prompt":"Make it warmer","sourceName":"source.png","model":"sourceful/riverflow-v2.5-fast","aspect":"4:3","background":"auto","quality":"medium"}`)
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, readBody(t, response))
	}
}

func TestGenerateImageRejectsInvalidSourceAndSVGOutput(t *testing.T) {
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		writeProviderImage(t, w, []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), "image/svg+xml")
	}))
	defer provider.Close()

	app, dataDir := testApp(t, provider.URL)
	if err := os.WriteFile(filepath.Join(dataDir, "notes.txt"), []byte("not an image"), 0600); err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		name       string
		body       string
		wantStatus int
	}{
		{name: "traversal", body: `{"prompt":"edit","sourceName":"../secret.png"}`, wantStatus: fiber.StatusBadRequest},
		{name: "not image", body: `{"prompt":"edit","sourceName":"notes.txt"}`, wantStatus: fiber.StatusUnsupportedMediaType},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := performRequest(t, app, test.body)
			if response.StatusCode != test.wantStatus {
				t.Fatalf("status = %d, body = %s", response.StatusCode, readBody(t, response))
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatalf("provider called %d times for invalid sources", calls.Load())
	}

	response := performRequest(t, app, `{"prompt":"vector logo"}`)
	if response.StatusCode != fiber.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", response.StatusCode, readBody(t, response))
	}
	if body := readBody(t, response); !strings.Contains(body, "only PNG, JPEG, and WebP are allowed") {
		t.Fatalf("body = %q", body)
	}
	if calls.Load() != 1 {
		t.Fatalf("provider calls = %d", calls.Load())
	}
}

func TestGenerateImageKeepsOpaqueTransparentResultWithWarning(t *testing.T) {
	opaque := testPNG(t, 2, 2, false)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openrouter.ImageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request.Model != "openai/gpt-image-2.5-sunburst" || request.Resolution != "" || request.Quality != "low" || request.Background != "transparent" || request.OutputFormat != "" {
			t.Errorf("request = %+v", request)
		}
		writeProviderImage(t, w, opaque, "image/png")
	}))
	defer provider.Close()

	app, dataDir := testApp(t, provider.URL)
	response := performRequest(t, app, `{"prompt":"isolated product","model":"openai/gpt-image-2.5-sunburst","background":"transparent"}`)
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, readBody(t, response))
	}
	var result generateResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Warning, "opaque image") {
		t.Fatalf("warning = %q", result.Warning)
	}
	if _, err := os.Stat(filepath.Join(dataDir, result.Name)); err != nil {
		t.Fatalf("saved image: %v", err)
	}
}

func TestGenerateImageAcceptsTransparentPNG(t *testing.T) {
	transparent := testPNG(t, 2, 2, true)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeProviderImage(t, w, transparent, "image/png")
	}))
	defer provider.Close()

	app, _ := testApp(t, provider.URL)
	response := performRequest(t, app, `{"prompt":"isolated product","model":"openai/gpt-image-2.5-flare","background":"transparent","aspect":"16:9"}`)
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, readBody(t, response))
	}
}

func TestGenerateImageUsesSunburstAsDefault(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openrouter.ImageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request.Model != "openai/gpt-image-2.5-sunburst" || request.Resolution != "" || request.Quality != "low" || len(request.InputReferences) != 1 {
			t.Errorf("request = %+v", request)
		}
		writeProviderImage(t, w, testPNG(t, 1, 1, false), "image/png")
	}))
	defer provider.Close()

	app, dataDir := testApp(t, provider.URL)
	if err := os.WriteFile(filepath.Join(dataDir, "source.png"), testPNG(t, 1, 1, false), 0600); err != nil {
		t.Fatal(err)
	}
	response := performRequest(t, app, `{"prompt":"edit","sourceName":"source.png"}`)
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, readBody(t, response))
	}
}

func TestGenerateImageRejectsUnavailableModelAndUnsupportedOptions(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("provider must not be called for an invalid request")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer provider.Close()

	app, _ := testApp(t, provider.URL)
	for _, test := range []struct {
		name string
		body string
	}{
		{name: "model", body: `{"prompt":"test","model":"untrusted/model"}`},
		{name: "unavailable GPT model", body: `{"prompt":"test","model":"openai/gpt-image-1.5"}`},
		{name: "retired GPT Image 1", body: `{"prompt":"test","model":"openai/gpt-image-1"}`},
		{name: "retired GPT Image Mini", body: `{"prompt":"test","model":"openai/gpt-image-1-mini"}`},
		{name: "pro tier", body: `{"prompt":"test","model":"sourceful/riverflow-v2.5-pro"}`},
		{name: "Riverflow transparency", body: `{"prompt":"test","model":"sourceful/riverflow-v2.5-fast","background":"transparent"}`},
		{name: "aspect", body: `{"prompt":"test","model":"krea/krea-2-medium-turbo","aspect":"21:9"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := performRequest(t, app, test.body)
			if response.StatusCode != fiber.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", response.StatusCode, readBody(t, response))
			}
		})
	}
}

func testApp(t *testing.T, providerURL string) (*fiber.App, string) {
	t.Helper()
	t.Setenv("OPENROUTER_API_KEY", "secret")
	t.Setenv("OPENROUTER_BASE_URL", providerURL)
	t.Setenv("OPENROUTER_HTTP_REFERER", "https://direction.al")
	t.Setenv("OPENROUTER_APP_NAME", "machinal")

	dataDir := t.TempDir()
	safeJoin := func(name string) (string, error) {
		if name == "" || filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
			return "", fmt.Errorf("invalid name")
		}
		return filepath.Join(dataDir, name), nil
	}
	app := fiber.New()
	app.Post("/ai/images", func(c *fiber.Ctx) error {
		return generate(c, dataDir, safeJoin)
	})
	return app, dataDir
}

func performRequest(t *testing.T, app *fiber.App, body string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/ai/images", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request, int(providerTimeout.Milliseconds()))
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func writeProviderImage(t *testing.T, w http.ResponseWriter, data []byte, mediaType string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(openrouter.ImageResponse{
		Data: []openrouter.ImageData{{
			B64JSON:   base64.StdEncoding.EncodeToString(data),
			MediaType: mediaType,
		}},
	}); err != nil {
		t.Errorf("encode provider response: %v", err)
	}
}

func testPNG(t *testing.T, width, height int, transparent bool) []byte {
	t.Helper()
	result := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			result.SetNRGBA(x, y, color.NRGBA{R: 40, G: 80, B: 120, A: 255})
		}
	}
	if transparent {
		result.SetNRGBA(0, 0, color.NRGBA{R: 40, G: 80, B: 120, A: 0})
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, result); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func readBody(t *testing.T, response *http.Response) string {
	t.Helper()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}
