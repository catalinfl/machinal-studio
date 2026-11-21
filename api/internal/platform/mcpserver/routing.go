package mcpserver

import (
	"context"
	"fmt"
	"strings"

	"ffmpeg-go-server/internal/core/toolrouting"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type routingInput struct {
	Prompt       string `json:"prompt" jsonschema:"A concise routing intent, at most 6000 bytes. Do not include API keys, signed URLs or private file contents."`
	UserApproved bool   `json:"userApproved,omitempty" jsonschema:"Retained for compatibility; catalog selection is free and grants no media or spending permission"`
}

func registerRoutingTool(server *mcp.Server, _ Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "suggest_tools", Description: "Return the known tool catalog for selection by the CURRENT client AI. No server AI call, credit charge or execution. The client chooses relevant tools using their descriptions and validates schemas, media consent and spending approval. Skip when tools are obvious; never recursively route suggestions.", Annotations: annotations(true, false, true)},
		func(_ context.Context, _ *mcp.CallToolRequest, input routingInput) (*mcp.CallToolResult, Output, error) {
			if strings.TrimSpace(input.Prompt) == "" || len(input.Prompt) > toolrouting.MaxPromptBytes {
				return nil, Output{}, fmt.Errorf("Provide a routing prompt of 1-%d bytes", toolrouting.MaxPromptBytes)
			}
			candidates := make([]map[string]string, 0, len(toolrouting.Catalog))
			for _, tool := range toolrouting.Catalog {
				candidates = append(candidates, map[string]string{"name": tool.Name, "intent": tool.Intent})
			}
			return nil, Output{StatusCode: 200, Data: map[string]any{"candidates": candidates, "selectionBy": "current-client-ai", "executed": false, "cost": map[string]any{"consumed": 0, "pending": false}}}, nil
		})
}
