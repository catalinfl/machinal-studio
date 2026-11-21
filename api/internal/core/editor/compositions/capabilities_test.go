package compositions

import (
	"slices"
	"testing"
)

func TestCaptionCapabilitiesExposeConfiguredModelWithoutProviderSecrets(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "not-a-real-key")
	t.Setenv("OPENROUTER_STT_MODEL", " openai/whisper-large-v3 ")
	t.Setenv("OPENROUTER_STT_PROVIDER", " groq ")
	captions := generationCapabilities()["captions"].(map[string]any)
	if captions["model"] != "openai/whisper-large-v3" || captions["provider"] != "groq" || captions["responseFormat"] != "verbose_json" {
		t.Fatal(captions)
	}
	if captions["configured"] != true || captions["configurationOnly"] != true || !slices.Equal(captions["requestedTimestampGranularities"].([]string), []string{"word", "segment"}) {
		t.Fatal("configuration must not imply provider compatibility or health", captions)
	}
	if _, exists := captions["apiKey"]; exists {
		t.Fatal("exposed a credential")
	}
	t.Setenv("OPENROUTER_STT_MODEL", "")
	if generationCapabilities()["captions"].(map[string]any)["configured"] != false {
		t.Fatal("missing model was reported as configured")
	}
}

func TestClientModelAndHandoffCapabilitiesDescribeSubsetNotProviderHealth(t *testing.T) {
	t.Setenv("SCENE_SERVICE_URL", "")
	capabilities := generationCapabilities()
	client := capabilities["clientScene"].(map[string]any)
	models := client["models"].(map[string]any)
	if client["configured"] != false || client["configurationOnly"] != true || client["asyncThreeSetup"] != true || client["handoffTool"] != "handoff_scene" || client["automaticTimelineReplacement"] != false {
		t.Fatal(client)
	}
	if models["maxAttachments"] != 2 || models["maxBytesEach"] != 4<<20 || models["maxScenes"] != 1 || models["externalURIs"] != false || models["importedAnimations"] != false {
		t.Fatal(models)
	}
	inspection := capabilities["sceneInspection"].(map[string]any)
	if inspection["registeredSemanticStates"] != true || inspection["motionVerified"] != false {
		t.Fatal(inspection)
	}
}
