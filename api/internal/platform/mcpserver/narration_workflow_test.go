package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/compositions"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestNarrationWorkflowExposesTimingCheckpointBeforeVisualGeneration(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("timing guidance must not call providers or customer APIs")
		return Response{}, nil
	})
	_, envelope := rpc(t, handler, "initialize", map[string]any{
		"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "test", "version": "1"},
	})
	var initialized mcp.InitializeResult
	if err := json.Unmarshal(envelope["result"], &initialized); err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{
		"timing-first", "separate submissions", "requested captions.generate only", "do not include image.generate",
		"get_job_result", "resultTextIds", "Three.js", "sourceJobId", "before jobs all run before after captions",
		"If captions were not requested", "If TTS was not requested", "failed timing pass stops dependent visual generation",
	} {
		if !strings.Contains(initialized.Instructions, content) {
			t.Errorf("initialization is missing timing instruction %q", content)
		}
	}
	for _, topic := range []string{"overview", "yaml", "jobs", "scenes", "audio", "text"} {
		result, output := callTool(t, handler, "get_editing_reference", map[string]any{"topic": topic})
		if result.IsError || output.StatusCode != http.StatusOK {
			t.Fatalf("timing guide is unavailable: %s", topic)
		}
		guide := strings.ToLower(output.Data.(map[string]any)["guide"].(string))
		for _, content := range []string{"timing-first", "narration-timing", "narrated-documentary", "get_job_result"} {
			if !strings.Contains(guide, content) {
				t.Errorf("%s guide is missing %q", topic, content)
			}
		}
	}
}

func TestNarrationOverrunKeepsSuccessfulAudioAndExtendsVideo(t *testing.T) {
	guides := map[string]string{
		"initialization": instructions,
		"recipe-guide":   recipeGuide,
	}
	for _, topic := range []string{"brief", "overview", "jobs", "scenes", "audio", "text", "scene-authoring"} {
		reference, err := editingReference(referenceInput{Topic: topic}, nil)
		if err != nil {
			t.Fatalf("read %s guidance: %v", topic, err)
		}
		guides[topic] = reference.Guide
	}

	for name, guide := range guides {
		t.Run(name, func(t *testing.T) {
			content := strings.ToLower(guide)
			for _, instruction := range []string{
				"30-second", "38–40 seconds", "extend the video",
				"do not regenerate, truncate or speed up", "hard duration cap",
				"without reconfirmation", "spending limit",
			} {
				if !strings.Contains(content, instruction) {
					t.Errorf("missing narration-overrun instruction %q", instruction)
				}
			}
		})
	}
}

func TestNarrationExamplesSeparateTimingFromPendingVisuals(t *testing.T) {
	for _, example := range []struct {
		id    string
		kinds []string
	}{
		{"narration-timing", []string{"captions.generate", "speech.generate"}},
		{"narrated-documentary", []string{"image.generate", "scene.generate"}},
	} {
		t.Run(example.id, func(t *testing.T) {
			source, err := bundledGuides.ReadFile("reference/examples/" + example.id + ".yaml")
			if err != nil {
				t.Fatal(err)
			}
			input, _, err := compositions.ParseProject(source)
			if err != nil {
				t.Fatal(err)
			}
			result := compiler.New().Compile(input)
			if compositions.HasErrors(result) || result.Composition != nil {
				t.Fatalf("invalid pending example: %+v", result)
			}
			kinds := make([]string, 0, len(result.Requirements))
			for _, requirement := range result.Requirements {
				kinds = append(kinds, requirement.Kind)
			}
			slices.Sort(kinds)
			if !slices.Equal(kinds, example.kinds) {
				t.Fatalf("timing/visual passes mixed provider work: %v", kinds)
			}
			if example.id == "narrated-documentary" {
				assertNarrationVisualExampleReusesTiming(t, input)
			}
		})
	}
}

func assertNarrationVisualExampleReusesTiming(t *testing.T, input compiler.Input) {
	t.Helper()
	if len(input.Document.Jobs) != 2 || input.Document.Jobs[0].ResultAssetID == "" || len(input.Document.Jobs[1].ResultTextIDs) != 3 {
		t.Fatal("visual pass lost materialized voice/caption results")
	}
	input.Document.Before[0].ResultAssetID = "art"
	input.Document.Before[1].ResultAssetID = "scene"
	input.Assets = append(input.Assets,
		document.Asset{ID: "art", File: "art.png", Version: "synthetic", Kind: "image", Width: 1920, Height: 1080},
		document.Asset{ID: "scene", File: "scene.scene.json", Version: "synthetic", Kind: "video", Duration: document.Seconds(3.8)},
	)
	result := compiler.New().Compile(input)
	if compositions.HasErrors(result) || result.Composition == nil || len(result.Requirements) != 0 {
		t.Fatalf("visual materialization did not reuse timing: %+v", result)
	}
	if result.Composition.Duration != document.Seconds(8.4) || len(result.Composition.TextItems) != 4 {
		t.Fatalf("visual pass changed measured duration or captions: %+v", result.Composition)
	}
}
