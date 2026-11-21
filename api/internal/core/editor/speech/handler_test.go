package speech

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"

	"github.com/gofiber/fiber/v2"
)

var testMP3 = append([]byte("ID3"), bytes.Repeat([]byte{0x01}, 64)...)
var testWAV = append([]byte("RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\xbb\x00\x00\x00w\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"), 0)

func TestGenerateSpeechClonesStoredMP3VoiceAndSavesMP3(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/audio/speech" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		var request openrouter.SpeechRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request.Model != "fish-audio/s2.1-pro" || request.Input != "Buna ziua" || request.ResponseFormat != "mp3" {
			t.Errorf("request = %+v", request)
		}
		if len(request.InputReferences) != 2 {
			t.Fatalf("references = %+v", request.InputReferences)
		}
		wantAudio := "data:audio/mpeg;base64," + base64.StdEncoding.EncodeToString(testMP3)
		if request.InputReferences[0].InputAudio == nil || request.InputReferences[0].InputAudio.Data != wantAudio {
			t.Errorf("audio reference = %+v", request.InputReferences[0])
		}
		if request.InputReferences[1].Text != "Aceasta este vocea mea." {
			t.Errorf("transcript = %+v", request.InputReferences[1])
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("X-Generation-Id", "generation-1")
		_, _ = w.Write(testMP3)
	}))
	defer provider.Close()

	app, dataDir := speechTestApp(t, provider.URL)
	if err := os.WriteFile(filepath.Join(dataDir, "voice.mp3"), testMP3, 0600); err != nil {
		t.Fatal(err)
	}
	response := speechRequest(t, app, `{"input":"Buna ziua","referenceName":"voice.mp3","referenceTranscript":"Aceasta este vocea mea."}`)
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, readSpeechBody(t, response))
	}
	var result generateResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.MediaType != "audio/mpeg" || result.SourceMode != "proxy" || result.GenerationID != "generation-1" {
		t.Fatalf("result = %+v", result)
	}
	saved, err := os.ReadFile(filepath.Join(dataDir, result.Name))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(saved, testMP3) {
		t.Fatal("saved speech differs from provider output")
	}
}

func TestGenerateSpeechUsesPresetVoice(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openrouter.SpeechRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.Model != voxtralSpeechModel || request.Voice != "en_paul_neutral" || len(request.InputReferences) != 0 {
			t.Errorf("request = %+v", request)
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(testMP3)
	}))
	defer provider.Close()

	app, _ := speechTestApp(t, provider.URL)
	response := speechRequest(t, app, `{"input":"Hello","model":"mistralai/voxtral-mini-tts-2603","voice":"en_paul_neutral"}`)
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, readSpeechBody(t, response))
	}
}

func TestGenerateSpeechRequestsPCMForGemini(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openrouter.SpeechRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.Model != "google/gemini-3.1-flash-tts-preview" || request.Voice != "Kore" || request.ResponseFormat != "pcm" {
			t.Errorf("request = %+v", request)
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(testMP3)
	}))
	defer provider.Close()

	app, _ := speechTestApp(t, provider.URL)
	response := speechRequest(t, app, `{"input":"Buna ziua","model":"google/gemini-3.1-flash-tts-preview","voice":"Kore"}`)
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, body = %s", response.StatusCode, readSpeechBody(t, response))
	}
}

func TestNormalizeSpeechAudioConvertsPCMToMP3(t *testing.T) {
	pcm := bytes.Repeat([]byte{0x01, 0x02}, 24)
	converted, err := normalizeSpeechAudio(context.Background(), t.TempDir(), pcm, "audio/pcm", "pcm", func(_ context.Context, args ...string) error {
		if !slices.Contains(args, "s16le") || !slices.Contains(args, "24000") || !slices.Contains(args, "libmp3lame") {
			t.Errorf("ffmpeg args = %v", args)
		}
		return os.WriteFile(args[len(args)-1], testMP3, 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(converted, testMP3) {
		t.Fatal("converted speech differs from MP3 output")
	}
}

func TestGenerateSpeechRejectsUnknownModelAndInvalidReference(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("provider must not be called")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer provider.Close()
	app, dataDir := speechTestApp(t, provider.URL)
	if err := os.WriteFile(filepath.Join(dataDir, "notes.txt"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "voice.wav"), testWAV, 0600); err != nil {
		t.Fatal(err)
	}

	for _, body := range []string{
		`{"input":"Hello","model":"unknown/model"}`,
		`{"input":"Hello","model":"x-ai/grok-voice-tts-1.0","voice":"eve","referenceName":"voice.wav"}`,
		`{"input":"Hello","referenceName":"notes.txt"}`,
		`{"input":"Hello","referenceName":"voice.wav"}`,
	} {
		response := speechRequest(t, app, body)
		if response.StatusCode < 400 || response.StatusCode >= 500 {
			t.Fatalf("status = %d, body = %s", response.StatusCode, readSpeechBody(t, response))
		}
	}
}

func TestSpeechFileNameUsesFirstTwoWords(t *testing.T) {
	cases := []struct {
		input string
		id    string
		want  string
	}{
		{`Buna ziua lume`, `a1b2c3d4e5f60718293a4b5c6d7e8f90`, `voice_buna_ziua_a1b2c3d4.mp3`},
		{`Hello, World! This is a test.`, `abcdef1234567890abcdef1234567890`, `voice_hello_world_abcdef12.mp3`},
		{`Salut!`, `1234567890abcdef1234567890abcdef`, `voice_salut_12345678.mp3`},
		{`... !!!`, `deadbeefdeadbeefdeadbeefdeadbeef`, `voice_deadbeef.mp3`},
		{``, `cafebabe12345678cafebabe12345678`, `voice_cafebabe.mp3`},
	}
	for _, tc := range cases {
		if got := speechFileName(tc.input, tc.id); got != tc.want {
			t.Errorf("speechFileName(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func speechTestApp(t *testing.T, providerURL string) (*fiber.App, string) {
	t.Helper()
	t.Setenv("OPENROUTER_API_KEY", "secret")
	t.Setenv("OPENROUTER_BASE_URL", providerURL)
	dataDir := t.TempDir()
	safeJoin := func(name string) (string, error) {
		if name == "" || filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
			return "", fmt.Errorf("invalid name")
		}
		return filepath.Join(dataDir, name), nil
	}
	app := fiber.New()
	app.Post("/ai/speech", func(c *fiber.Ctx) error { return generate(c, dataDir, safeJoin) })
	return app, dataDir
}

func speechRequest(t *testing.T, app *fiber.App, body string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/ai/speech", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request, int(providerTimeout.Milliseconds()))
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func readSpeechBody(t *testing.T, response *http.Response) string {
	t.Helper()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}
