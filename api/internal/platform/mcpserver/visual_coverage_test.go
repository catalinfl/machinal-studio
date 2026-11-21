package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestVisualCoveragePolicyReachesMCPInitializationAndReferences(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("visual guidance must not access customer data or call providers")
		return Response{}, nil
	})
	_, envelope := rpc(t, handler, "initialize", map[string]any{
		"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "test", "version": "1"},
	})
	var initialized mcp.InitializeResult
	if err := json.Unmarshal(envelope["result"], &initialized); err != nil {
		t.Fatal(err)
	}
	guides := map[string]string{"initialization": initialized.Instructions, "recipe-guide": recipeGuide}
	for _, topic := range []string{"jobs", "scenes", "scene-authoring", "production"} {
		result, output := callTool(t, handler, "get_editing_reference", map[string]any{"topic": topic})
		if result.IsError || output.StatusCode != http.StatusOK {
			t.Fatalf("visual coverage guidance is unavailable: %s", topic)
		}
		guides[topic] = output.Data.(map[string]any)["guide"].(string)
	}
	for name, guide := range guides {
		t.Run(name, func(t *testing.T) {
			for _, required := range []string{
				"overly simplistic", "SVG/CSS", "5–10", "per scene, not per video",
				"geographic context", "period-grounded", "approved budget", "make the video cheap", "procedural-only",
			} {
				if !strings.Contains(strings.ToLower(guide), strings.ToLower(required)) {
					t.Errorf("missing visual coverage instruction %q", required)
				}
			}
		})
	}
}

func TestMCPToolDescriptionsDistinguishArtworkFromSceneCompilation(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("tool discovery must not generate artwork or execute routing")
		return Response{}, nil
	})
	_, envelope := rpc(t, handler, "tools/list", map[string]any{})
	var catalog mcp.ListToolsResult
	if err := json.Unmarshal(envelope["result"], &catalog); err != nil {
		t.Fatal(err)
	}
	wanted := map[string]bool{"generate_assets": false, "compile_scene": false}
	for _, tool := range catalog.Tools {
		if tool.Name == "image.generate" {
			t.Fatal("a YAML job type was advertised as an MCP tool")
		}
		if _, ok := wanted[tool.Name]; !ok {
			continue
		}
		wanted[tool.Name] = true
		for _, required := range []string{"overly simplistic SVG/CSS", "image.generate", "per scene, not per video"} {
			if !strings.Contains(tool.Description, required) {
				t.Errorf("%s is missing image tooling guidance %q", tool.Name, required)
			}
		}
	}
	for name, found := range wanted {
		if !found {
			t.Errorf("missing production tool %s", name)
		}
	}
}
