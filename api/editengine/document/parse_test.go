package document

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestParseRejectsAmbiguousYAML(t *testing.T) {
	for name, source := range map[string]string{
		"duplicate":          "version: 1\nversion: 1\nmode: assemble",
		"unknown":            "version: 1\nmode: assemble\nsequence: {use: shots, mystery: true}",
		"alias":              "version: 1\ninputs: &x {shots: {kind: video}}\nmode: assemble",
		"multiple documents": "version: 1\n---\nversion: 1",
		"wrong type":         "version: nope\nmode: assemble",
		"null":               "version: 1\nmode: null",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse([]byte(source)); err == nil {
				t.Fatal("invalid YAML accepted")
			}
		})
	}
}

func TestCaptionStylePatchHasObjectSchemaAndStrictYAMLFields(t *testing.T) {
	parsed, err := Parse([]byte("version: 2\nmode: assemble\nafter:\n  - id: captions\n    type: captions.generate\n    style: {fontFamily: montserrat, fontSize: 58, highlightMode: word}\n"))
	if err != nil {
		t.Fatal(err)
	}
	var patch map[string]any
	if err := json.Unmarshal(parsed.Document.After[0].Style, &patch); err != nil || patch["fontSize"] != float64(58) || len(patch) != 3 {
		t.Fatal("caption patch lost explicit fields or filled omitted defaults", patch, err)
	}
	jobSchema := Schema()["properties"].(map[string]any)["after"].(map[string]any)["items"].(map[string]any)
	style := jobSchema["properties"].(map[string]any)["style"].(map[string]any)
	if style["type"] != "object" || style["additionalProperties"] != false {
		t.Fatal("caption style must advertise its real object shape", style)
	}
	for _, source := range []string{
		"style: {preset: active-word}", "style: {css: {fontSize: 58}}", "style: active-word", "style: [58]",
	} {
		if _, err := Parse([]byte("version: 2\nmode: assemble\nafter:\n  - id: captions\n    type: captions.generate\n    " + source + "\n")); err == nil {
			t.Fatal("unsupported caption style accepted", source)
		}
	}
}

func TestUnknownFieldHasDocumentPosition(t *testing.T) {
	_, err := Parse([]byte("version: 1\nmode: assemble\nsequence:\n  use: shots\n  between:\n    invalid: 1s\n"))
	var diagnostic Diagnostic
	if !errors.As(err, &diagnostic) {
		t.Fatalf("expected positioned diagnostic: %v", err)
	}
	if diagnostic.Path != "sequence.between.invalid" || diagnostic.Line != 6 {
		t.Fatalf("wrong position: %+v", diagnostic)
	}
}

func TestCompatibilityPinsRequireQuotedStrings(t *testing.T) {
	for _, field := range []string{"catalogVersion", "compilerVersion"} {
		t.Run(field, func(t *testing.T) {
			_, err := Parse([]byte("version: 2\nmode: assemble\n" + field + ": 1\n"))
			var diagnostic Diagnostic
			if !errors.As(err, &diagnostic) {
				t.Fatalf("expected actionable diagnostic, got %v", err)
			}
			if diagnostic.Path != field || diagnostic.Line != 3 || diagnostic.Column != len(field)+3 {
				t.Fatalf("wrong field position: %+v", diagnostic)
			}
			if !strings.Contains(diagnostic.Message, `quote the value as "1"`) {
				t.Fatalf("missing string fix: %+v", diagnostic)
			}
		})
	}
	for _, pins := range []string{"", "catalogVersion: '1'\ncompilerVersion: \"1\"\n"} {
		parsed, err := Parse([]byte("version: 2\nmode: assemble\n" + pins))
		if err != nil || parsed.Document.Version != 2 {
			t.Fatalf("valid version fields rejected: %+v, %v", parsed.Document, err)
		}
		if pins != "" && (parsed.Document.CatalogVersion != "1" || parsed.Document.CompilerVersion != "1") {
			t.Fatalf("quoted pins were changed: %+v", parsed.Document)
		}
	}
}

func TestListFieldsRejectMissingSequenceMarkers(t *testing.T) {
	for _, source := range []string{
		"tracks: {id: main, type: video}",
		"tracks: [{id: main, type: video, clips: {id: shot}}]",
		"texts: {id: title, text: Hello}",
		"transitions: {id: dissolve}",
	} {
		t.Run(source, func(t *testing.T) {
			_, err := Parse([]byte("version: 2\nmode: assemble\n" + source))
			var diagnostic Diagnostic
			if !errors.As(err, &diagnostic) || !strings.Contains(diagnostic.Message, "expected a sequence (YAML list)") {
				t.Fatalf("missing list diagnostic: %v", err)
			}
		})
	}
}

func TestSchemaExplainsCompatibilityPinTypesAndSourceTimes(t *testing.T) {
	properties := Schema()["properties"].(map[string]any)
	for _, field := range []string{"catalogVersion", "compilerVersion"} {
		property := properties[field].(map[string]any)
		description, _ := property["description"].(string)
		if property["type"] != "string" || !strings.Contains(description, "not a number") {
			t.Fatalf("pin schema lacks string guidance: %s=%+v", field, property)
		}
	}
	track := properties["tracks"].(map[string]any)["items"].(map[string]any)
	clip := track["properties"].(map[string]any)["clips"].(map[string]any)["items"].(map[string]any)
	outPoint := clip["properties"].(map[string]any)["outPoint"].(map[string]any)
	description, _ := outPoint["description"].(string)
	if !strings.Contains(description, "not the timeline end") {
		t.Fatalf("outPoint schema lacks source-time guidance: %+v", outPoint)
	}
}
