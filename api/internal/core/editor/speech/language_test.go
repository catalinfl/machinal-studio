package speech

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSpeechLanguageDetectionAndOverrides(t *testing.T) {
	for _, test := range []struct{ text, requested, want string }{
		{"Mihai Eminescu a schimbat poezia română.", "auto", "ro"},
		{"Buna ziua, aceasta este povestea poetului.", "", "ro"},
		{"Hello, welcome to the documentary.", "auto", "en"},
		{"Salut", "ro-RO", "ro"},
		{"The poet speaks.", "ro", "ro"},
		{"Bonjour le monde", "auto", ""},
		{"Une île au cœur de la forêt", "auto", ""},
		{"Take care.", "auto", ""},
		{"Salut", "auto", ""},
	} {
		got, err := speechLanguage(test.text, test.requested)
		if err != nil || got != test.want {
			t.Errorf("speechLanguage(%q, %q) = %q, %v; want %q", test.text, test.requested, got, err, test.want)
		}
	}
}

func TestRomanianSpeechSelectsNativeLanguageWithoutChangingTheScript(t *testing.T) {
	text := "În copilărie, Eminescu descoperă codrul și lumina lunii."
	body, err := json.Marshal(Request{Input: text, Language: "ro"})
	if err != nil {
		t.Fatal(err)
	}
	request, err := parseRequest(body)
	if err != nil {
		t.Fatal(err)
	}
	model, err := resolveModel(request)
	if err != nil {
		t.Fatal(err)
	}
	provider, err := buildSpeechProviderRequest(request, model, nil)
	if err != nil {
		t.Fatal(err)
	}
	if provider.Model != geminiSpeechModel || provider.Voice != "Kore" || provider.Input != text || !strings.Contains(provider.Instructions, "Romanian") {
		t.Fatalf("provider request: %+v", provider)
	}
	options, err := json.Marshal(provider.Provider)
	if err != nil || !strings.Contains(string(options), `"languageCode":"ro-RO"`) {
		t.Fatalf("native language configuration: %s, %v", options, err)
	}
}

func TestSpeechRejectsIncompatibleLanguageBeforeCallingTheProvider(t *testing.T) {
	for _, request := range []Request{
		{Input: "Salut!", Language: "ro", Model: voxtralSpeechModel, Voice: "fr_marie_neutral"},
		{Input: "Hello!", Language: "en", Model: voxtralSpeechModel, Voice: "fr_marie_neutral"},
		{Input: "Salut!", Language: "ro", Model: "hexgrad/kokoro-82m", Voice: "ff_siwis"},
		{Input: "Hello!", Language: "en", Model: "hexgrad/kokoro-82m", Voice: "ff_siwis"},
	} {
		if _, err := resolveModel(request); err == nil {
			t.Errorf("accepted incompatible speech settings: %+v", request)
		}
	}
}
