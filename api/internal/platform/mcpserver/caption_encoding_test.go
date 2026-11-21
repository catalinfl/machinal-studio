package mcpserver

import (
	"strings"
	"testing"
)

func TestAIEntryPointsRequireCaptionEncodingRepair(t *testing.T) {
	requireClientLibrary(t)
	for name, content := range map[string]string{
		"initialization": instructions,
		"recipe guide":   recipeGuide,
	} {
		for _, guidance := range []string{
			"UTF-8", "texts[].text", "words[].text", "mojibake",
			"invalid_text_encoding", "U+FFFD", "intact transcript", "never guess lost characters",
			"without changing measured timings", "resultTextIds", "regenerate successful speech/captions",
		} {
			if !strings.Contains(content, guidance) {
				t.Errorf("%s lacks caption repair guidance %q", name, guidance)
			}
		}
	}
	for _, topic := range []string{"audio", "text"} {
		reference, err := clientAuthoringReference(referenceInput{Topic: topic}, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, guidance := range []string{"AI recipe text integrity", "invalid_text_encoding", "texts[].text", "words[].text", "Revalidate the repaired recipe"} {
			if !strings.Contains(reference.Guide, guidance) {
				t.Errorf("%s lacks caption repair guidance %q", topic, guidance)
			}
		}
	}
}
