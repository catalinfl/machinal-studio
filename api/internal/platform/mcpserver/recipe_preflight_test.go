package mcpserver

import (
	"strings"
	"testing"
)

func TestRecipeEntryPointsRequireTypeAndTimelinePreflight(t *testing.T) {
	for name, content := range map[string]string{
		"initialization": instructions,
		"recipe guide":   recipeGuide,
	} {
		for _, guidance := range []string{
			"after every edit", "no error diagnostics or unresolved requirements",
			"outPoint = inPoint + timelineDuration * playbackRate",
			"catalogVersion/compilerVersion", "quoted strings", "never numeric 1",
			"ad-hoc", "Never use paid rendering",
		} {
			if !strings.Contains(content, guidance) {
				t.Errorf("%s lacks %q", name, guidance)
			}
		}
	}
	guide, err := bundledGuides.ReadFile("guides/yaml.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, guidance := range []string{
		"Optional **string** compatibility pins", "unlike numeric `version`",
		"outPoint = inPoint + D * playbackRate", "integer microseconds",
		"ad-hoc JSON-to-YAML emitter", "`validate_recipe` after every edit",
		"Pending requirements mean geometry is not yet fully checked",
		"Any edit invalidates the previous check",
	} {
		if !strings.Contains(string(guide), guidance) {
			t.Errorf("YAML guide lacks %q", guidance)
		}
	}
}
