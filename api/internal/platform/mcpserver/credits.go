package mcpserver

import (
	"context"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func registerCreditTools(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_credits",
		Description: "Read the authenticated account's live API credit balance, monthly/purchased credits, debt, pending usage, next reset and configured pricing. No owner argument or paid work. Credits are charged from actual usage after completion, never reserved for current work. Pending provider costs do not lock the wallet. Before paid work check the balance; below 30 credits give a brief low-balance warning with approximate rendering/scene costs only when supported. Report actual cost at the end, not a fabricated exact advance quote.",
		Annotations: annotations(true, false, true),
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, Output, error) {
		return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: "/v1/billing/credits"})
	})
}
