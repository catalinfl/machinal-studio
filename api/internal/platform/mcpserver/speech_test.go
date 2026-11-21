package mcpserver

import (
	"encoding/json"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/core/editor/speech"
)

func TestSpeechCatalogIsFreeFilteredAndDoesNotRecommendLegacy(t *testing.T) {
	handler := briefHandler(t)
	for _, lang := range []string{"ro", "en-US"} {
		result, output := callTool(t, handler, "list_speech_models", map[string]any{"language": lang})
		if result.IsError || output.StatusCode != 200 {
			t.Fatal(result, output)
		}
		encoded, err := json.Marshal(output.Data)
		if err != nil {
			t.Fatal(err)
		}
		body := string(encoded)
		for _, id := range []string{speech.GeminiFlashModel, speech.GeminiLiteModel} {
			if !strings.Contains(body, id) {
				t.Errorf("%s lacks %s", lang, id)
			}
		}
		models := output.Data.(map[string]any)["models"].([]any)
		kokoro := false
		for _, entry := range models {
			model := entry.(map[string]any)
			if model["legacy"] == true || model["voices"] != nil {
				t.Fatal("default discovery must be compact and nonlegacy", model)
			}
			kokoro = kokoro || model["id"] == speech.KokoroModel
		}
		if kokoro != (lang == "en-US") {
			t.Fatalf("wrong economical option for %s: %s", lang, body)
		}
	}
}

func TestSpeechModelLookupPreservesIDAndFiltersVoiceLanguage(t *testing.T) {
	handler := briefHandler(t)
	for _, test := range []struct {
		id, lang string
		count    int
	}{
		{speech.GeminiFlashModel, "ro", 30},
		{speech.GeminiLiteModel, "en", 30},
		{"google/gemini-3.1-flash-tts-preview", "ro", 30},
		{speech.KokoroModel, "it", 2},
	} {
		result, output := callTool(t, handler, "get_speech_model", map[string]any{"model": test.id, "language": test.lang})
		if result.IsError || output.StatusCode != 200 {
			t.Fatal(test, result, output)
		}
		model := output.Data.(map[string]any)["model"].(map[string]any)
		if model["id"] != test.id || len(model["voices"].([]any)) != test.count {
			t.Fatal("model/voice mismatch", test, model)
		}
	}
	for _, args := range []map[string]any{
		{"model": speech.KokoroModel, "language": "ro"},
		{"model": "unknown/model", "language": "en"},
		{"model": speech.GeminiFlashModel, "language": "not-a-language"},
	} {
		result, _ := callTool(t, handler, "get_speech_model", args)
		if !result.IsError {
			t.Fatal("accepted unsupported choice", args)
		}
	}
}

func TestInstructionsRequireModelChoiceAndBoundSceneRepairs(t *testing.T) {
	for _, source := range []string{instructions, recipeGuide} {
		for _, expected := range []string{
			"list_speech_models", "SAME native brief form", "For English ASK", speech.GeminiFlashModel,
			speech.GeminiLiteModel, speech.KokoroModel, "never silently substitute", "two targeted repairs",
			"fetch independent required references concurrently", "exact opaque download URL",
		} {
			if !strings.Contains(source, expected) {
				t.Errorf("workflow lacks %q", expected)
			}
		}
	}
}
