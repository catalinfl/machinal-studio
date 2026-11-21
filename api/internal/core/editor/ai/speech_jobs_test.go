package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEditToolExposesDeferredSpeechJobs(t *testing.T) {
	parameters, err := json.Marshal(editTool(project{}).Function.Parameters)
	if err != nil {
		t.Fatal(err)
	}
	schema := string(parameters)
	for _, expected := range []string{`"speechJobs"`, `"google/gemini-3.8-flash-tts"`, `"google/gemini-3.8-flash-lite-tts"`, `"hexgrad/kokoro-82m"`, `"google/gemini-3.1-flash-tts-preview"`, `"Kore"`, `"volume"`} {
		if !strings.Contains(schema, expected) {
			t.Fatalf("speech job schema is missing %s", expected)
		}
	}
}

func TestValidateSpeechJobAllowsBuiltInVoice(t *testing.T) {
	volume := 90.0
	plan := editPlan{
		Mode:    planModeRecommend,
		Summary: "Recommend a voice-over",
		SpeechJobs: []speechJob{{
			ID: "intro", Input: "Welcome to the show", Model: "google/gemini-3.1-flash-tts-preview",
			Voice: "Kore", Start: 2, Volume: &volume,
		}},
		Operations: []editOperation{},
	}

	if err := validatePlan(plan, project{}); err != nil {
		t.Fatal(err)
	}
}

func TestValidateSpeechJobRejectsVoiceFromAnotherModel(t *testing.T) {
	plan := editPlan{
		Mode:    planModeEdit,
		Summary: "Add a voice-over",
		SpeechJobs: []speechJob{{
			ID: "intro", Input: "Welcome to the show", Model: "x-ai/grok-voice-tts-1.0",
			Voice: "Kore", Start: 0,
		}},
		Operations: []editOperation{},
	}

	if err := validatePlan(plan, project{}); err == nil || !strings.Contains(err.Error(), "voice is not available") {
		t.Fatalf("validatePlan error = %v, want voice/model rejection", err)
	}
}

func TestBestEffortPlanKeepsValidSpeechJobs(t *testing.T) {
	plan := editPlan{
		Mode:    planModeEdit,
		Summary: "Add narration",
		SpeechJobs: []speechJob{{
			ID: "intro", Input: "Welcome", Model: "x-ai/grok-voice-tts-1.0", Voice: "eve", Start: 0,
		}},
		Operations: []editOperation{},
	}

	result := buildBestEffortPlan(
		plan,
		func(candidate editPlan) error { return validatePlan(candidate, project{}) },
		func(editPlan) error { return nil },
	)
	if len(result.SpeechJobs) != 1 || len(result.Operations) != 0 {
		t.Fatalf("valid speech job was not retained: %+v", result)
	}
}
