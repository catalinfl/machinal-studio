package speech

import (
	"context"
	"encoding/json"
)

// GeneratedSpeech describes provider audio saved to the data directory.
type GeneratedSpeech struct {
	ID           string
	Name         string
	GenerationID string
	Language     string
}

func ValidateRequest(options Request) error {
	body, err := json.Marshal(options)
	if err != nil {
		return err
	}
	request, err := parseRequest(body)
	if err != nil {
		return err
	}
	_, err = resolveModel(request)
	return err
}

// GenerateSpeechAudio runs the full TTS provider flow without an HTTP context
// so the composition orchestrator can execute speech.generate jobs from YAML.
func GenerateSpeechAudio(ctx context.Context, dataDir string, safeJoin safeJoinFunc, options Request) (GeneratedSpeech, error) {
	body, err := json.Marshal(options)
	if err != nil {
		return GeneratedSpeech{}, err
	}
	request, err := parseRequest(body)
	if err != nil {
		return GeneratedSpeech{}, err
	}
	resolved, err := resolveModel(request)
	if err != nil {
		return GeneratedSpeech{}, err
	}
	providerRequest, err := buildSpeechProviderRequest(request, resolved, safeJoin)
	if err != nil {
		return GeneratedSpeech{}, err
	}
	config, err := loadOpenRouterConfig()
	if err != nil {
		return GeneratedSpeech{}, err
	}
	audio, generationID, err := fetchProviderAudio(ctx, config, providerRequest, dataDir)
	if err != nil {
		return GeneratedSpeech{}, err
	}
	id, name, err := saveGeneratedSpeech(dataDir, safeJoin, audio, request.Input)
	if err != nil {
		return GeneratedSpeech{}, err
	}
	return GeneratedSpeech{ID: id, Name: name, GenerationID: generationID, Language: request.Language}, nil
}
