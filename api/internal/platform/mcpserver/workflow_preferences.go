package mcpserver

import (
	"context"
	"net/http"

	"ffmpeg-go-server/internal/core/preferences"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type workflowPreferenceInput struct {
	Style           *string `json:"style,omitempty" jsonschema:"Named editorial profile, such as documentary or cinematic. Current user briefs override this default."`
	SceneMode       *string `json:"sceneMode,omitempty" jsonschema:"auto, 2d or 3d. 3d requires genuine Three.js scenes, not SVG imitations."`
	ImagePolicy     *string `json:"imagePolicy,omitempty" jsonschema:"auto, prefer-images or procedural-only. Prefer generated/real images inside animated scenes for complex illustrative details, only after generation approval."`
	CaptionMaxWords *int    `json:"captionMaxWords,omitempty" jsonschema:"Preferred words per caption for new caption generation only, 1–12. Default 4, especially for 1080x1920 portrait. Never regroup existing captions to apply this preference."`
	UserApproved    bool    `json:"userApproved" jsonschema:"True only after the user approves saving these non-secret preferences. Does not approve media access or spending."`
}

func registerWorkflowPreferences(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "get_workflow_preferences", Description: "Read per-application-key editing defaults: style, sceneMode, imagePolicy and captionMaxWords. Read before planning; explicit user briefs and existing caption configuration win. captionMaxWords applies to new caption generation only; never regroup or restyle existing captions. These are preferences, not recipe fields or spending approval. Local/hosted URL and API key remain in client configuration/environment, never chat or this tool.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, Output, error) {
			return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: "/v1/preferences/workflow"})
		})
	mcp.AddTool(server, &mcp.Tool{Name: "set_workflow_preferences", Description: "Save only user-approved non-secret editing defaults for this application key. Omitted fields are preserved. Does not change authentication, connect to another API, access media, generate assets or authorize spending. Never pass API keys here.", Annotations: annotations(false, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input workflowPreferenceInput) (*mcp.CallToolResult, Output, error) {
			if err := requireMediaApproval(input.UserApproved); err != nil {
				return nil, Output{}, err
			}
			operation, err := jsonRequest("/v1/preferences/workflow", preferences.WorkflowPatch{
				Style: input.Style, SceneMode: input.SceneMode, ImagePolicy: input.ImagePolicy, CaptionMaxWords: input.CaptionMaxWords,
			})
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, operation)
		})
}
