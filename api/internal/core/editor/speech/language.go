package speech

import (
	"fmt"
	"slices"
	"strings"
	"unicode"

	"ffmpeg-go-server/internal/integrations/openrouter"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/text/language"
)

const (
	geminiSpeechModel       = GeminiFlashModel
	minimumRomanianEvidence = 2
)

func speechLanguage(text, requested string) (string, error) {
	requested = strings.ToLower(strings.TrimSpace(requested))
	if requested == "" || requested == "auto" {
		return detectSpeechLanguage(text), nil
	}
	tag, err := language.Parse(strings.ReplaceAll(requested, "_", "-"))
	if err != nil {
		return "", requestError(fiber.StatusBadRequest, "language must be a valid language code such as ro, ro-RO, en or auto")
	}
	base, _ := tag.Base()
	if base.String() == "und" {
		return "", requestError(fiber.StatusBadRequest, "language must identify a spoken language")
	}
	return base.String(), nil
}

func detectSpeechLanguage(text string) string {
	words := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool { return !unicode.IsLetter(r) })
	ro, en := 0, 0
	for _, word := range words {
		if strings.ContainsAny(word, "ășțşţ") {
			ro += 3
		}
		switch word {
		case "buna", "bună", "salut", "ziua", "este", "sunt", "aceasta", "acesta", "pentru", "care", "poetul", "copilaria", "romana", "română", "în", "între", "codrul", "poezia":
			ro++
		case "hello", "welcome", "the", "this", "that", "with", "and", "is", "are", "from", "world", "english":
			en++
		}
	}
	// A single shared word such as "care" or "salut" is not language evidence.
	if ro > en && ro >= minimumRomanianEvidence {
		return "ro"
	}
	if en > ro && en > 0 {
		return "en"
	}
	return ""
}

func validateSpeechLanguage(request generateRequest, model speechModel) error {
	lang := request.Language
	if lang == "" {
		return nil
	}
	if !slices.Contains(model.Languages, lang) {
		return requestError(fiber.StatusBadRequest, fmt.Sprintf("model %s does not support language %s; choose a compatible speech model", model.ID, lang))
	}
	voiceLanguage := ""
	if model.ID == voxtralSpeechModel {
		voiceLanguage = strings.Split(request.Voice, "_")[0]
		if voiceLanguage == "gb" {
			voiceLanguage = "en"
		}
	} else if model.ID == "microsoft/mai-voice-2" && len(request.Voice) >= 2 {
		voiceLanguage = request.Voice[:2]
	} else if model.ID == "hexgrad/kokoro-82m" && len(request.Voice) > 0 {
		switch request.Voice[0] {
		case 'a', 'b':
			voiceLanguage = "en"
		case 'f':
			voiceLanguage = "fr"
		case 'e':
			voiceLanguage = "es"
		case 'h':
			voiceLanguage = "hi"
		case 'i':
			voiceLanguage = "it"
		case 'j':
			voiceLanguage = "ja"
		case 'p':
			voiceLanguage = "pt"
		case 'z':
			voiceLanguage = "zh"
		}
	}
	if voiceLanguage != "" && voiceLanguage != lang {
		return requestError(fiber.StatusBadRequest, "the selected voice's language does not match the narration language")
	}
	return nil
}

func speechInstructions(request generateRequest) string {
	direction := "Read the input verbatim in its original language, with native pronunciation. Do not translate or read these instructions aloud."
	if request.Language != "" {
		tag := language.Make(request.Language)
		name := tag.String()
		if name == "ro" {
			name = "Romanian (română), with a native Romanian accent and correct ă, â, î, ș, ț pronunciation, not an Italian, Spanish or French accent"
		} else if name == "en" {
			name = "English, with a native English accent"
		}
		direction = "Narration language: " + name + ". " + direction
	}
	if request.Instructions != "" {
		direction += " Delivery: " + request.Instructions
	}
	return direction
}

func geminiLanguageProvider(lang, voice string) *openrouter.SpeechProvider {
	if lang == "" {
		return nil
	}
	locale := lang
	if lang == "ro" {
		locale = "ro-RO"
	} else if lang == "en" {
		locale = "en-US"
	}
	return &openrouter.SpeechProvider{Options: map[string]any{
		"google-ai-studio": map[string]any{"speechConfig": map[string]any{
			"languageCode": locale,
			"voiceConfig":  map[string]any{"prebuiltVoiceConfig": map[string]any{"voiceName": voice}},
		}},
	}}
}
