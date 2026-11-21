package mcpserver

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/catalog"
	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/internal/core/editor/compositions"
)

func referenceFixture(t *testing.T) map[string][]json.RawMessage {
	t.Helper()
	entries, err := loadReferenceEntries()
	if err != nil {
		t.Fatal(err)
	}
	return entries
}

func TestFilteredReferenceOmitsRepeatedGuideUnlessRequested(t *testing.T) {
	entries := referenceFixture(t)
	include := true
	exclude := false
	for _, input := range []referenceInput{
		{Topic: "effects", ID: "vignette"}, {Topic: "effects", Query: "blur"}, {Topic: "effects", Offset: 8},
		{Topic: "production", IncludeGuide: &exclude},
	} {
		result, err := editingReference(input, entries)
		if err != nil || result.Guide != "" || result.GuideURI == "" {
			t.Fatal("targeted lookup repeated the whole guide", input, err)
		}
	}
	for _, input := range []referenceInput{{Topic: "effects"}, {Topic: "effects", ID: "vignette", IncludeGuide: &include}, {Topic: "production"}} {
		result, err := editingReference(input, entries)
		if err != nil || result.Guide == "" {
			t.Fatal("guide unavailable", input, err)
		}
	}
}

func TestReferenceRetainsEveryCatalogEntryAndParameter(t *testing.T) {
	entries := referenceFixture(t)
	var original map[string]json.RawMessage
	if err := json.Unmarshal(catalog.JSON(), &original); err != nil {
		t.Fatal(err)
	}
	for _, topic := range referenceTopics {
		if _, exists := original[topic.Category]; !exists {
			continue
		}
		var expected []json.RawMessage
		if err := json.Unmarshal(original[topic.Category], &expected); err != nil {
			t.Fatal(err)
		}
		var collected []json.RawMessage
		offset := 0
		for {
			page, err := editingReference(referenceInput{Topic: topic.ID, Limit: 7, Offset: offset}, entries)
			if err != nil || page.Total != len(expected) {
				t.Fatalf("topic=%s total=%d error=%v", topic.ID, page.Total, err)
			}
			collected = append(collected, page.Entries...)
			if page.NextOffset == nil {
				break
			}
			if *page.NextOffset <= offset {
				t.Fatal("pagination did not advance")
			}
			offset = *page.NextOffset
		}
		if !reflect.DeepEqual(collected, expected) {
			t.Fatalf("catalog fields/parameters were lost in %s", topic.ID)
		}
	}
}

func TestReferenceLookupUsesDescriptionsAndRejectsInventedPresets(t *testing.T) {
	entries := referenceFixture(t)
	result, err := editingReference(referenceInput{Topic: "effects", ID: "vignette"}, entries)
	if err != nil || result.Total != 1 || !strings.Contains(string(result.Entries[0]), `"parameters": []`) {
		t.Fatal("parameterless effect must retain its actual empty parameters", result, err)
	}
	result, err = editingReference(referenceInput{Topic: "transitions", ID: "whip-pan-left"}, entries)
	if err != nil || !strings.Contains(string(result.Entries[0]), "xfadeExpr") || !strings.Contains(string(result.Entries[0]), "bright, narrow directional band") {
		t.Fatal("renderer algorithm was replaced by guessed name semantics", result, err)
	}
	result, err = editingReference(referenceInput{Topic: "effects", Query: "LUMA RADIUS"}, entries)
	if err != nil || result.Total != 0 {
		t.Fatal("search should not silently search undocumented parameter fields", result, err)
	}
	result, err = editingReference(referenceInput{Topic: "effects", Query: "adjustable blur"}, entries)
	if err != nil || result.Total == 0 {
		t.Fatal("description search failed", result, err)
	}
	for _, input := range []referenceInput{{Topic: "styles", ID: "imaginary-style"}, {Topic: "effects", ID: "cinematic"}, {Topic: "yaml", ID: "../secrets"}, {Topic: "../secrets"}, {Topic: "effects", Limit: 26}} {
		if _, err := editingReference(input, entries); err == nil {
			t.Fatalf("accepted unsupported input %+v", input)
		}
	}
}

func TestNamedStylesOnlyRecommendExistingCatalogIDs(t *testing.T) {
	entries := referenceFixture(t)
	groups := map[string]string{"looks": "looks", "motions": "motions", "transitions": "transitions", "textPresets": "textPresets", "effects": "effects"}
	known := make(map[string]map[string]bool)
	for field, category := range groups {
		known[field] = make(map[string]bool)
		for _, raw := range entries[category] {
			var item struct{ ID string }
			if err := json.Unmarshal(raw, &item); err != nil {
				t.Fatal(err)
			}
			known[field][item.ID] = true
		}
	}
	seen := make(map[string]bool)
	for _, raw := range entries["styles"] {
		var style map[string]json.RawMessage
		if err := json.Unmarshal(raw, &style); err != nil {
			t.Fatal(err)
		}
		var id string
		if err := json.Unmarshal(style["id"], &id); err != nil || id == "" || seen[id] {
			t.Fatal("style IDs must be unique and nonempty")
		}
		seen[id] = true
		for field := range groups {
			var ids []string
			if err := json.Unmarshal(style[field], &ids); err != nil {
				t.Fatal(err)
			}
			for _, preset := range ids {
				if !known[field][preset] {
					t.Fatalf("style %s recommends nonexistent %s preset %s", id, field, preset)
				}
			}
		}
	}
	if len(seen) < 13 {
		t.Fatal("named editorial profiles are missing")
	}
}

func TestReferenceExamplesUseStrictAPIParserAndActualCompiler(t *testing.T) {
	files, err := fs.Glob(bundledGuides, "reference/examples/*.yaml")
	if err != nil || len(files) != len(referenceExamples) {
		t.Fatal("unregistered or missing recipe examples", files, err)
	}
	for _, example := range referenceExamples {
		t.Run(example.ID, func(t *testing.T) {
			source, err := bundledGuides.ReadFile("reference/examples/" + example.ID + ".yaml")
			if err != nil {
				t.Fatal(err)
			}
			input, _, err := compositions.ParseProject(source)
			if err != nil {
				t.Fatal("example is not accepted by the actual YAML parser", err)
			}
			result := compiler.New().Compile(input)
			if compositions.HasErrors(result) || len(result.Requirements) != example.Requirements {
				t.Fatalf("invalid example: diagnostics=%+v requirements=%+v", result.Diagnostics, result.Requirements)
			}
			if (result.Composition == nil) != (example.Requirements > 0) {
				t.Fatal("pending work was advertised as a finished composition", result)
			}
			if example.ID == "cinematic-sequence" && result.Composition.Duration.Seconds() != 7.4 {
				t.Fatal("transition duration was not budgeted")
			}
		})
	}
}

func TestReferenceToolAndExampleResourcesNeverInvokePaidOrUserAPI(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("reference lookups must not invoke account/provider operations")
		return Response{}, nil
	})
	for _, args := range []map[string]any{{"topic": "overview"}, {"topic": "styles", "id": "cinematic"}, {"topic": "effects", "id": "gaussian-blur"}, {"topic": "examples", "id": "scene-generation"}} {
		result, output := callTool(t, handler, "get_editing_reference", args)
		if result.IsError || output.StatusCode != 200 {
			t.Fatal("reference lookup failed", result, output)
		}
	}
	for _, args := range []map[string]any{{"topic": "arbitrary"}, {"topic": "effects", "limit": 100}, {"topic": "yaml", "apiKey": "never-accept-secrets"}, {"topic": "effects", "offset": -1}} {
		result, _ := callTool(t, handler, "get_editing_reference", args)
		if !result.IsError {
			t.Fatal("reference schema accepted unsupported arguments", args)
		}
	}
	for _, example := range referenceExamples {
		_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": "machinal://examples/" + example.ID})
		if !strings.Contains(string(envelope["result"]), "document:") {
			t.Fatal("recipe example resource is unavailable", example.ID)
		}
	}
	for _, topic := range referenceTopics {
		result, err := editingReference(referenceInput{Topic: topic.ID}, referenceFixture(t))
		if err != nil || !slices.Contains(referenceTopicNames(), result.Topic) {
			t.Fatal("reference topic is not registered", topic.ID, err)
		}
		_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": result.GuideURI})
		if envelope["error"] != nil {
			t.Fatal("reference tool returned a missing guide URI", result.GuideURI)
		}
	}
}

func TestReferenceWorkflowRejectsCommonInventedYAMLFields(t *testing.T) {
	for _, body := range []string{
		"document: {version: 2, mode: assemble, styles: cinematic}",
		"document: {version: 2, mode: assemble, texts: [{id: title, text: Example, start: 0, duration: 2, style: {fontSize: 40}}]}",
		"document: {version: 2, mode: assemble, before: [{id: scene, type: scene.generate, prompt: Diagram, duration: 3, scenePreset: space-3d}]}",
		"document: {version: 2, mode: assemble, sequence: {use: shots, between: {preset: cross-dissolve, duration: 0.3, params: {strength: 1}}}}",
	} {
		if _, _, err := compositions.ParseProject([]byte(body)); err == nil {
			t.Fatal("unsupported invented YAML field was accepted", body)
		}
	}
	input, _, err := compositions.ParseProject([]byte("document: {version: 2, mode: assemble, effects: [{id: corners, trackId: main, preset: vignette, start: 0, duration: 1, params: {strength: 0.5}}]}"))
	if err != nil {
		t.Fatal(err)
	}
	if !compositions.HasErrors(compiler.New().Validate(input)) {
		t.Fatal("an invented effect parameter was accepted")
	}
}
