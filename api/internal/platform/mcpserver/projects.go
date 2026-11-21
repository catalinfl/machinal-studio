package mcpserver

import (
	"context"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type emptyInput struct{}

type projectInput struct {
	ProjectID string `json:"projectId" jsonschema:"ID of an owned project returned by list_projects or create_project"`
}

type createProjectInput struct {
	Name string `json:"name" jsonschema:"Project name, 1–120 characters"`
}

type saveProjectInput struct {
	ProjectID string         `json:"projectId"`
	Name      string         `json:"name" jsonschema:"Project name, 1–120 characters"`
	Version   int            `json:"version" jsonschema:"Current version from get_project; conflicts return 409, never overwrite automatically"`
	State     map[string]any `json:"state" jsonschema:"Complete saved editor state with schemaVersion 1, timeline and media. Preserve existing fields. This is not a YAML recipe."`
}

func registerProjectTools(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "list_projects", Description: "List projects belonging to the API-key owner.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, Output, error) {
			return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: "/v1/projects"})
		})
	mcp.AddTool(server, &mcp.Tool{Name: "create_project", Description: "Create a named project in the authenticated account.", Annotations: annotations(false, false, false)},
		func(ctx context.Context, req *mcp.CallToolRequest, input createProjectInput) (*mcp.CallToolResult, Output, error) {
			operation, err := jsonRequest("/v1/projects", input)
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, operation)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "get_project", Description: "Read the saved editor state and current version of an owned project.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input projectInput) (*mcp.CallToolResult, Output, error) {
			path, err := projectPath(input.ProjectID, "")
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: path})
		})
	mcp.AddTool(server, &mcp.Tool{Name: "save_project", Description: "Replace an owned project's saved editor state using optimistic version checking. Read it first, preserve unrelated fields, and ask before discarding edits. Does not render or store arbitrary recipe files.", Annotations: annotations(false, true, false)},
		func(ctx context.Context, req *mcp.CallToolRequest, input saveProjectInput) (*mcp.CallToolResult, Output, error) {
			path, err := projectPath(input.ProjectID, "")
			if err != nil {
				return nil, Output{}, err
			}
			operation, err := jsonRequest(path, struct {
				Name    string         `json:"name"`
				Version int            `json:"version"`
				State   map[string]any `json:"state"`
			}{input.Name, input.Version, input.State})
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, operation)
		})
}
