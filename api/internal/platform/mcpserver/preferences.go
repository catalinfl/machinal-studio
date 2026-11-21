package mcpserver

import (
	"context"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type downloadPreferenceInput struct {
	Directory    string `json:"directory" jsonschema:"User-chosen local download directory on this client's computer. Empty clears the preference. This is data, never a server path or shell command."`
	UserApproved bool   `json:"userApproved" jsonschema:"True only after the user explicitly chooses/approves this local directory."`
}

func registerDownloadPreferences(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "get_download_preferences", Description: "Read the preferred local download directory saved for this application key before delivery. If directory is empty or belongs to another machine, ask the user; offer approved set_download_preferences to remember their choice. The remote server never writes there: the host's local tools download without overwriting files. Full workflow: get_editing_reference(topic=media).", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, Output, error) {
			return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: "/v1/preferences/downloads"})
		})
	mcp.AddTool(server, &mcp.Tool{Name: "set_download_preferences", Description: "Save or clear the user's preferred LOCAL download directory for this application key. Ask the user first. Does not download, create folders, run commands or grant media access. Prefer one API key per device.", Annotations: annotations(false, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input downloadPreferenceInput) (*mcp.CallToolResult, Output, error) {
			if err := requireMediaApproval(input.UserApproved); err != nil {
				return nil, Output{}, err
			}
			operation, err := jsonRequest("/v1/preferences/downloads", struct {
				Directory string `json:"directory"`
			}{input.Directory})
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, operation)
		})
}
