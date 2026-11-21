package settings

import (
	"os"
	"testing"
)

func TestLocalModelDefaultsNeedOnlyTheUsersProviderKey(t *testing.T) {
	for name := range localModelDefaults {
		t.Setenv(name, "")
	}
	t.Setenv("OPENROUTER_STT_PROVIDER", "")
	t.Setenv("OPENROUTER_API_KEY", "")
	if err := ConfigureModelDefaults(); err != nil {
		t.Fatal(err)
	}
	for name, model := range localModelDefaults {
		if os.Getenv(name) != model {
			t.Fatalf("missing default %s", name)
		}
	}
	if os.Getenv("OPENROUTER_STT_PROVIDER") != "groq" {
		t.Fatal("missing default timestamped transcription provider")
	}
	if os.Getenv("OPENROUTER_API_KEY") != "" {
		t.Fatal("model defaults must never provide a key")
	}
}

func TestLocalModelDefaultsPreserveOverridesWithoutForcingGroq(t *testing.T) {
	t.Setenv("OPENROUTER_MODEL", "user/chosen-model")
	t.Setenv("OPENROUTER_STT_MODEL", "user/chosen-transcription")
	t.Setenv("OPENROUTER_STT_PROVIDER", "")
	for name := range localModelDefaults {
		if name != "OPENROUTER_MODEL" && name != "OPENROUTER_STT_MODEL" {
			t.Setenv(name, "")
		}
	}
	if err := ConfigureModelDefaults(); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("OPENROUTER_MODEL") != "user/chosen-model" || os.Getenv("OPENROUTER_STT_MODEL") != "user/chosen-transcription" || os.Getenv("OPENROUTER_STT_PROVIDER") != "" {
		t.Fatal("user model routing was overwritten")
	}
}
