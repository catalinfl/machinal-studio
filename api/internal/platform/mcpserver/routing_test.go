package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/core/toolrouting"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestRouterCatalogMatchesTheActualMCPTools(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("catalog discovery called the API/provider")
		return Response{}, nil
	})
	_, envelope := rpc(t, handler, "tools/list", map[string]any{})
	var result mcp.ListToolsResult
	if err := json.Unmarshal(envelope["result"], &result); err != nil {
		t.Fatal(err)
	}
	actual := make(map[string]bool)
	for _, tool := range result.Tools {
		actual[tool.Name] = true
		if strings.Contains(strings.ToLower(tool.Description), "jev") {
			t.Errorf("%s exposes an internal AI supplier in its public description", tool.Name)
		}
	}
	if len(actual) != len(toolrouting.Catalog)+1 {
		t.Fatal("router catalog is stale")
	}
	for _, tool := range toolrouting.Catalog {
		if !actual[tool.Name] || tool.Name == "suggest_tools" {
			t.Fatal("unknown or recursive router candidate", tool.Name)
		}
	}
}

func TestMCPInstructionsAndCreditGuideDoNotExposeInternalAISupplier(t *testing.T) {
	requireClientLibrary(t)
	guide, err := clientReferenceFixtures.ReadFile("guides/credits.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(guide), "owner's OpenRouter key") {
		t.Fatal("local guide must explain user-owned provider billing")
	}
	for _, source := range []string{instructions, recipeGuide} {
		for _, detail := range []string{"openrouter", "jev", "30%", "3.333", "aiProviderBudget"} {
			if strings.Contains(strings.ToLower(source), strings.ToLower(detail)) {
				t.Errorf("customer-facing MCP guidance exposes internal detail %q", detail)
			}
		}
	}
}
