package mcpserver

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func decodeSceneTemplate(t *testing.T, entry json.RawMessage) sceneTemplate {
	t.Helper()
	var template sceneTemplate
	if err := json.Unmarshal(entry, &template); err != nil {
		t.Fatal(err)
	}
	return template
}

func TestSceneTemplateDiscoveryIsPaginatedAndSourceIsOptIn(t *testing.T) {
	entries := referenceFixture(t)
	files, err := fs.Glob(bundledGuides, "reference/scene-templates/*.svelte")
	if err != nil || len(files) != len(entries["sceneTemplates"]) {
		t.Fatal("unregistered or missing scene template sources", files, err)
	}
	var ids []string
	for offset := 0; ; {
		page, err := editingReference(referenceInput{Topic: "scene-templates", Limit: 2, Offset: offset}, entries)
		if err != nil || page.Total != len(files) || len(page.Entries) > 2 {
			t.Fatal("invalid template discovery page", page, err)
		}
		for _, raw := range page.Entries {
			template := decodeSceneTemplate(t, raw)
			if template.Component != "" || strings.Contains(string(raw), `"component"`) {
				t.Fatal("discovery must not dump every component", template.ID)
			}
			if slices.Contains(ids, template.ID) || template.URI != "machinal://scene-templates/"+template.ID {
				t.Fatal("invalid or duplicate template identity", template)
			}
			ids = append(ids, template.ID)
			assertSceneTemplateMetadata(t, template)
		}
		if page.NextOffset == nil {
			break
		}
		if *page.NextOffset <= offset {
			t.Fatal("template pagination did not advance")
		}
		offset = *page.NextOffset
	}
	for _, id := range []string{"kinetic-type", "image-reveal", "layered-parallax", "glitch-handoff", "signal-diagram", "lens-assembly-3d"} {
		if !slices.Contains(ids, id) {
			t.Error("missing initial effect component", id)
		}
	}
	page, err := editingReference(referenceInput{Topic: "scene-templates", Query: "PARALLAX"}, entries)
	if err != nil || page.Total != 1 || decodeSceneTemplate(t, page.Entries[0]).ID != "layered-parallax" {
		t.Fatal("template description search failed", page, err)
	}
	page, err = editingReference(referenceInput{Topic: "scene-templates", Offset: len(ids) + 1}, entries)
	if err != nil || len(page.Entries) != 0 || page.NextOffset != nil {
		t.Fatal("out-of-range template offset must return an empty page", page, err)
	}
}

func assertSceneTemplateMetadata(t *testing.T, template sceneTemplate) {
	t.Helper()
	if template.Version == "" || template.Description == "" || len(template.WhenToUse) == 0 || len(template.Avoid) == 0 || len(template.Adaptation) == 0 || len(template.Parameters) == 0 {
		t.Fatal("template lacks selection or adaptation guidance", template.ID)
	}
	if template.VisualMode != "2d" && template.VisualMode != "3d" {
		t.Fatal("template lacks an implemented visual mode", template.ID)
	}
	config := template.Config
	if config.Width < 2 || config.Width > 1920 || config.Width%2 != 0 || config.Height < 2 || config.Height > 1920 || config.Height%2 != 0 || config.FPS < 1 || config.FPS > 60 || config.Duration < 1 || config.Duration > 60 || !config.CaptionSafeArea {
		t.Fatal("template has invalid example output settings", template.ID, config)
	}
	for _, phase := range []string{"reveal", "action", "hold", "exit"} {
		if template.Choreography[phase] == "" {
			t.Error("template lacks motion phase", template.ID, phase)
		}
	}
	source, err := sceneTemplateSource(template.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, parameter := range template.Parameters {
		if !strings.HasPrefix(parameter.Path, "design.") || parameter.Description == "" || !strings.Contains(source, strings.TrimPrefix(parameter.Path, "design.")+":") {
			t.Error("parameter is not a documented source-level setting", template.ID, parameter)
		}
	}
	for _, image := range template.RequiredImages {
		if !slices.Contains([]string{"image_1", "image_2", "image_3", "image_4"}, image.ID) || image.Role == "" || !strings.Contains(source, "images."+image.ID) {
			t.Error("template attachment does not match source", template.ID, image)
		}
	}
}

func TestSceneTemplateToolAndResourcesReturnExactBundledSourceWithoutAPIWork(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("template lookups must not access projects, providers or billing")
		return Response{}, nil
	})
	for _, entry := range referenceFixture(t)["sceneTemplates"] {
		template := decodeSceneTemplate(t, entry)
		result, output := callTool(t, handler, "get_editing_reference", map[string]any{"topic": "scene-templates", "id": template.ID})
		if result.IsError || output.StatusCode != http.StatusOK {
			t.Fatal("template source lookup failed", template.ID, result, output)
		}
		data := output.Data.(map[string]any)
		got := data["entries"].([]any)[0].(map[string]any)["component"].(string)
		want, err := sceneTemplateSource(template.ID)
		if err != nil || got != want {
			t.Fatal("tool changed the template source", template.ID, err)
		}
		_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": template.URI})
		var resource mcp.ReadResourceResult
		if err := json.Unmarshal(envelope["result"], &resource); err != nil {
			t.Fatal(err)
		}
		if len(resource.Contents) != 1 || resource.Contents[0].Text != want {
			t.Fatal("source resource differs from exact-ID lookup", template.ID)
		}
	}
	for _, id := range []string{"../scene-authoring", "unknown-effect", "image-reveal.svelte"} {
		result, _ := callTool(t, handler, "get_editing_reference", map[string]any{"topic": "scene-templates", "id": id})
		if !result.IsError {
			t.Error("accepted an unregistered template or path", id)
		}
	}
	for _, id := range []string{"../secret", "foo/bar", "", "foo.svelte"} {
		if _, err := sceneTemplateSource(id); err == nil {
			t.Error("template source reader accepted a path", id)
		}
	}
}

func TestSceneTemplateSelectionIsTaughtWithoutInventedInstantiationOrTraining(t *testing.T) {
	for _, content := range []string{instructions, recipeGuide} {
		for _, guidance := range []string{"get_editing_reference(topic=scene-templates)", "source-level parameters", "not YAML presets", "no model training", "compile_scene"} {
			if !strings.Contains(content, guidance) {
				t.Error("host instructions lack template guidance", guidance)
			}
		}
	}
}
