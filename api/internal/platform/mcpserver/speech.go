package mcpserver

import (
	"context"
	"errors"
	"strings"

	"ffmpeg-go-server/internal/core/editor/speech"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/text/language"
)

type speechModelsInput struct {
	Language      string `json:"language,omitempty" jsonschema:"Narration language such as ro or en; omit for the curated catalog"`
	IncludeLegacy bool   `json:"includeLegacy,omitempty" jsonschema:"Include older models for compatibility; not recommended for new work"`
}

type speechModelInput struct {
	Model    string `json:"model" jsonschema:"Exact model ID from list_speech_models or an existing recipe"`
	Language string `json:"language,omitempty" jsonschema:"Filter built-in voices to this narration language"`
}

const speechSelectionGuidance = "Ask the user to choose before paid speech unless an explicit model choice or delegation already exists. Preserve explicit choices, including Gemini 3.8 Flash; no automatic model fallback. For English offer Kokoro as an economical option alongside Gemini 3.8 Flash-Lite/Flash; for Romanian offer Gemini 3.8 Flash and Flash-Lite, not Kokoro. Tiers are qualitative catalog guidance, not a live price quote or provider-health test. Languages are a curated supported subset, not the provider's complete language list. Choosing a model is not spending or voice-reference consent."

func registerSpeechTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "list_speech_models", Annotations: annotations(true, false, true),
		Description: "Read the shared supported TTS catalog, filtered by language, without providers, credits or media access. Read once before the brief's model-choice question, unless already chosen. Returns compact model summaries; get_speech_model provides voices. Recommend economical English choices but ask the user; never replace their explicit model.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, input speechModelsInput) (*mcp.CallToolResult, Output, error) {
		lang, err := catalogLanguage(input.Language)
		if err != nil {
			return nil, Output{}, err
		}
		models := speech.Models(lang, input.IncludeLegacy)
		entries := make([]map[string]any, 0, len(models))
		for _, model := range models {
			entries = append(entries, map[string]any{
				"id": model.ID, "label": model.Label, "detail": model.Detail, "tier": model.Tier,
				"languages": model.Languages, "cloning": model.Cloning, "instructions": model.Instructions,
				"legacy": model.Legacy, "voiceCount": len(model.Voices), "defaultVoice": model.DefaultVoice,
			})
		}
		return nil, Output{StatusCode: 200, Data: map[string]any{
			"version": speech.CatalogVersion(), "source": speech.CatalogSource(), "models": entries,
			"selectionGuidance": speechSelectionGuidance,
		}}, nil
	})
	mcp.AddTool(server, &mcp.Tool{
		Name: "get_speech_model", Annotations: annotations(true, false, true),
		Description: "Read an exact supported TTS model's voices, language compatibility, instructions and audio format. Includes legacy IDs only when explicitly requested. No generation, spending, provider-health check or customer media access.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, input speechModelInput) (*mcp.CallToolResult, Output, error) {
		lang, err := catalogLanguage(input.Language)
		if err != nil {
			return nil, Output{}, err
		}
		for _, model := range speech.Models(lang, true) {
			if model.ID != input.Model {
				continue
			}
			if lang != "" {
				voices := make([]string, 0, len(model.Voices))
				for _, voice := range model.Voices {
					if err := speech.ValidateRequest(speech.Request{Input: "Catalog validation", Model: model.ID, Voice: voice, Language: lang}); err == nil {
						voices = append(voices, voice)
					}
				}
				model.Voices = voices
			}
			return nil, Output{StatusCode: 200, Data: map[string]any{
				"model": model, "version": speech.CatalogVersion(), "selectionGuidance": speechSelectionGuidance,
			}}, nil
		}
		return nil, Output{}, errors.New("No supported speech model matches this ID and language. Read list_speech_models; do not substitute a model without the user's choice.")
	})
}

func catalogLanguage(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if len(value) > 35 {
		return "", errors.New("Use a short spoken-language code such as ro or en.")
	}
	tag, err := language.Parse(strings.ReplaceAll(value, "_", "-"))
	if err != nil {
		return "", errors.New("Use a spoken-language code such as ro or en.")
	}
	base, _ := tag.Base()
	if base.String() == "und" {
		return "", errors.New("Identify the narration language before choosing compatible models.")
	}
	return base.String(), nil
}
