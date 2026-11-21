package speech

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

func TestGeminiFamilyPreservesChosenModelAndPCMContract(t *testing.T) {
	for _, id := range []string{GeminiFlashModel, GeminiLiteModel, "google/gemini-3.1-flash-tts-preview"} {
		t.Run(id, func(t *testing.T) {
			calls := 0
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var request openrouter.SpeechRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				if request.Model != id || request.ResponseFormat != "pcm" || request.Voice != "Kore" {
					t.Errorf("changed model/format/voice: %+v", request)
				}
				if request.Input != "Salut, aceasta este povestea." || !strings.Contains(request.Instructions, "calm") || !strings.Contains(request.Instructions, "Romanian") {
					t.Errorf("speech/instructions: %+v", request)
				}
				config, err := json.Marshal(request.Provider)
				if err != nil || !strings.Contains(string(config), `"languageCode":"ro-RO"`) || !strings.Contains(string(config), `"voiceName":"Kore"`) {
					t.Errorf("language/voice config: %s, %v", config, err)
				}
				w.Header().Set("Content-Type", "audio/mpeg")
				_, _ = w.Write(testMP3)
			}))
			defer provider.Close()
			app, _ := speechTestApp(t, provider.URL)
			body, err := json.Marshal(Request{Input: "Salut, aceasta este povestea.", Language: "ro", Model: id, Instructions: "calm"})
			if err != nil {
				t.Fatal(err)
			}
			response := speechRequest(t, app, string(body))
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK || calls != 1 {
				t.Fatalf("status=%d calls=%d body=%s", response.StatusCode, calls, readSpeechBody(t, response))
			}
		})
	}
}

func TestSpeechFailureDoesNotFallbackToAnotherModel(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"message":"unavailable"}}`))
	}))
	defer provider.Close()
	app, _ := speechTestApp(t, provider.URL)
	response := speechRequest(t, app, `{"input":"Hello world","language":"en","model":"google/gemini-3.8-flash-tts","voice":"Kore"}`)
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadGateway || calls != 1 {
		t.Fatalf("status=%d calls=%d; must not retry with another model", response.StatusCode, calls)
	}
}

func TestCatalogLanguageAndVoiceValidation(t *testing.T) {
	for _, test := range []struct{ lang, voice string }{
		{"en", "af_heart"}, {"en", "bm_george"}, {"hi", "hf_alpha"}, {"it", "if_sara"},
	} {
		if err := ValidateRequest(Request{Input: "Catalog test", Language: test.lang, Model: KokoroModel, Voice: test.voice}); err != nil {
			t.Errorf("compatible Kokoro voice %s/%s: %v", test.lang, test.voice, err)
		}
	}
	for _, request := range []Request{
		{Input: "Salut", Language: "ro", Model: KokoroModel, Voice: "af_heart"},
		{Input: "Hello", Language: "en", Model: KokoroModel, Voice: "if_sara"},
		{Input: "Hello", Language: "hi", Model: KokoroModel, Voice: "af_heart"},
		{Input: "Hello", Language: "en", Model: GeminiFlashModel, Voice: "af_heart"},
		{Input: "Hello", Language: "en", Model: "google/gemini-9-tts", Voice: "Kore"},
	} {
		if err := ValidateRequest(request); err == nil {
			t.Errorf("accepted incompatible model/language/voice: %+v", request)
		}
	}
}

func TestSharedCatalogIsCompleteAndIsolated(t *testing.T) {
	seen := map[string]bool{}
	for _, model := range Models("", true) {
		if seen[model.ID] || model.Label == "" || len(model.Languages) == 0 || len(model.Voices) == 0 && !model.Cloning {
			t.Fatalf("invalid or duplicate model: %+v", model)
		}
		seen[model.ID] = true
		if model.DefaultVoice != "" && !slices.Contains(model.Voices, model.DefaultVoice) {
			t.Fatalf("invalid default voice: %+v", model)
		}
	}
	for _, model := range Models("ro", false) {
		if model.ID == KokoroModel || model.Legacy {
			t.Fatalf("incompatible or legacy Romanian recommendation: %+v", model)
		}
	}
	models := Models("en", false)
	models[0].Voices[0] = "mutated"
	if Models("en", false)[0].Voices[0] == "mutated" {
		t.Fatal("catalog exposes mutable global slices")
	}
}
