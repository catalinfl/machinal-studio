package speech

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"slices"
)

const (
	GeminiFlashModel = "google/gemini-3.8-flash-tts"
	GeminiLiteModel  = "google/gemini-3.8-flash-lite-tts"
	KokoroModel      = "hexgrad/kokoro-82m"
)

type Model struct {
	ID             string       `json:"id"`
	Label          string       `json:"label"`
	Detail         string       `json:"detail"`
	Family         string       `json:"family"`
	Tier           string       `json:"tier"`
	Legacy         bool         `json:"legacy"`
	Cloning        bool         `json:"cloning"`
	Instructions   bool         `json:"instructions"`
	ResponseFormat speechFormat `json:"responseFormat"`
	DefaultVoice   string       `json:"defaultVoice,omitempty"`
	VoiceSet       string       `json:"voiceSet,omitempty"`
	Voices         []string     `json:"voices"`
	Languages      []string     `json:"languages"`
}

//go:embed catalog.json
var catalogJSON []byte

type modelCatalog struct {
	Version   string              `json:"version"`
	Source    string              `json:"source"`
	VoiceSets map[string][]string `json:"voiceSets"`
	Models    []Model             `json:"models"`
}

var bundledCatalog = loadCatalog()
var speechModels = bundledCatalog.Models

func loadCatalog() modelCatalog {
	var data modelCatalog
	if err := json.Unmarshal(catalogJSON, &data); err != nil {
		panic(fmt.Errorf("decode bundled speech catalog: %w", err))
	}
	for i := range data.Models {
		model := &data.Models[i]
		if model.VoiceSet != "" {
			model.Voices = data.VoiceSets[model.VoiceSet]
			if len(model.Voices) == 0 {
				panic("missing bundled speech voice set: " + model.VoiceSet)
			}
		}
	}
	return data
}

func CatalogVersion() string { return bundledCatalog.Version }

func CatalogSource() string { return bundledCatalog.Source }

func Models(lang string, includeLegacy bool) []Model {
	models := make([]Model, 0, len(speechModels))
	for _, model := range speechModels {
		if model.Legacy && !includeLegacy || lang != "" && !slices.Contains(model.Languages, lang) {
			continue
		}
		model.Voices = slices.Clone(model.Voices)
		model.Languages = slices.Clone(model.Languages)
		models = append(models, model)
	}
	return models
}

func PresetModels() []Model {
	models := Models("", true)
	return slices.DeleteFunc(models, func(model Model) bool { return len(model.Voices) == 0 })
}
