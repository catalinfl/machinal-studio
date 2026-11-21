package mcpserver

import (
	"context"
	"errors"

	"ffmpeg-go-server/internal/core/editor/scenes"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type sceneHandoffInput struct {
	ProjectID      string              `json:"projectId"`
	File           string              `json:"file" jsonschema:"Incoming scene to edit; its component must explicitly read the exposed parameters"`
	SourceVersion  string              `json:"sourceVersion" jsonschema:"Exact incoming source version"`
	Handoff        scenes.SceneHandoff `json:"handoff" jsonschema:"Outgoing source/version/frame and a mapping of incoming parameter IDs to outgoing registered semantic state IDs"`
	IdempotencyKey string              `json:"idempotencyKey"`
	UserApproved   bool                `json:"userApproved" jsonschema:"True only after permission to inspect the named outgoing scene and edit the named incoming scene, reusing their embedded media. Listing consent is insufficient."`
}

func registerSceneHandoffTools(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "handoff_scene", Annotations: annotations(false, false, true), Description: "Transfer declared semantic pose/appearance from an approved outgoing scene at an exact source frame to an incoming scene's exposed parameters, creating a new immutable compiled asset. Both source versions are checked; same canvas dimensions/visualMode required. Components must register deterministic scene.objects readers and use matching parameter semantics. No inferred pixel positions, AST rewriting, camera/unit conversion, automatic timeline replacement or caption edits. Timing controls stay on the incoming scene. Uses bounded diagnostic inspection plus free compilation, no provider or video encoding; actual rendering remains billed. Wait for the existing scene-compile job. This is not proof of visual continuity or aesthetic approval."}, func(ctx context.Context, req *mcp.CallToolRequest, input sceneHandoffInput) (*mcp.CallToolResult, Output, error) {
		if err := requireMediaApproval(input.UserApproved); err != nil {
			return nil, Output{}, err
		}
		if err := validateIdempotencyKey(input.IdempotencyKey); err != nil {
			return nil, Output{}, err
		}
		if !scenes.IsSource(input.File) || !contractVersionPattern(input.SourceVersion) {
			return nil, Output{}, errors.New("Provide the incoming scene filename and exact sourceVersion.")
		}
		if err := input.Handoff.Validate(); err != nil {
			return nil, Output{}, err
		}
		path, err := projectPath(input.ProjectID, "/scenes/compile")
		if err != nil {
			return nil, Output{}, err
		}
		operation, err := jsonRequest(path, scenes.CompileRequest{SourceFile: input.File, SourceVersion: input.SourceVersion, Handoff: &input.Handoff})
		if err != nil {
			return nil, Output{}, err
		}
		operation.IdempotencyKey = input.IdempotencyKey
		return invoke(ctx, req, call, operation)
	})
}
