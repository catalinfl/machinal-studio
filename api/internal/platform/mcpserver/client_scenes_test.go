package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestClientSceneGuideIsAvailableWithoutProvidersOrInstalledSkills(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("scene authoring discovery accessed customer data or a provider")
		return Response{}, nil
	})
	result, output := callTool(t, handler, "get_editing_reference", map[string]any{"topic": "scene-authoring"})
	if result.IsError || output.StatusCode != http.StatusOK {
		t.Fatal("client authoring guide missing", result, output)
	}
	guide := output.Data.(map[string]any)["guide"].(string)
	clientGuide := clientAuthoringGuide(t, "scene-authoring")
	for _, content := range []string{"compile_scene", "get_scene_source", "current client", "zero machinal credits", "sourceFile", "64000", "no automatic server-model fallback", "measured"} {
		if !strings.Contains(clientGuide, content) {
			t.Errorf("client authoring contract is missing %q", content)
		}
	}
	_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": "machinal://reference/scene-authoring"})
	var resource mcp.ReadResourceResult
	if err := json.Unmarshal(envelope["result"], &resource); err != nil {
		t.Fatal(err)
	}
	if len(resource.Contents) != 1 || resource.Contents[0].Text != guide {
		t.Fatal("reference resource differs from the tool's authoring guide")
	}
}
