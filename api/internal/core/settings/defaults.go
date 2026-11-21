package settings

import (
	"fmt"
	"os"
	"strings"
)

const defaultTranscriptionModel = "openai/whisper-large-v3"

var localModelDefaults = map[string]string{
	"OPENROUTER_MODEL":        "deepseek/deepseek-v4.1-flash",
	"OPENROUTER_VISION_MODEL": "qwen/qwen3.7-flash",
	"OPENROUTER_STT_MODEL":    defaultTranscriptionModel,
	"OPENROUTER_IMAGE_MODEL":  "openai/gpt-image-2.6-sunburst",
	"OPENROUTER_SPEECH_MODEL": "fish-audio/s2.1-pro",
	"OPENROUTER_JEV_MODEL":    "typesafe/jev-1.13",
}

func ConfigureModelDefaults() error {
	for name, model := range localModelDefaults {
		if err := setIfBlank(name, model); err != nil {
			return err
		}
	}
	if strings.TrimSpace(os.Getenv("OPENROUTER_STT_MODEL")) == defaultTranscriptionModel {
		return setIfBlank("OPENROUTER_STT_PROVIDER", "groq")
	}
	return nil
}

func setIfBlank(name, value string) error {
	if strings.TrimSpace(os.Getenv(name)) != "" {
		return nil
	}
	if err := os.Setenv(name, value); err != nil {
		return fmt.Errorf("configure local model default %s: %w", name, err)
	}
	return nil
}
