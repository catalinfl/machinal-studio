package mcpserver

import (
	"context"
	"errors"

	"ffmpeg-go-server/internal/core/editor/scenes"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type sceneParameterInput struct {
	ProjectID      string                 `json:"projectId"`
	File           string                 `json:"file"`
	SourceVersion  string                 `json:"sourceVersion" jsonschema:"Exact current fingerprint from get_scene_source"`
	Patch          scenes.SceneParameters `json:"patch" jsonschema:"Partial values for existing exposed object IDs only; positions, rotation in radians, scale, opacity, delay/duration in seconds and hex color. Never arbitrary code or caption text."`
	IdempotencyKey string                 `json:"idempotencyKey"`
	UserApproved   bool                   `json:"userApproved" jsonschema:"True only after permission to modify this named scene's exposed parameters and reuse its embedded attachments"`
}

func registerSceneParameterTools(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "edit_scene_parameters", Annotations: annotations(false, false, true), Description: "Create an immutable edited scene by patching existing exposed object parameters, without rewriting Svelte or calling a server model. Read get_scene_source for parameters and sourceVersion first. Only components explicitly reading the parameters prop support meaningful edits; never pretend arbitrary scenes do. Preserves exact component/config/media/narration; validates layout using patched values. Same free scene-compile queue, asynchronous job; wait and read get_job_result for the new asset. Full scene/video rendering remains billed. Stale sourceVersion fails instead of overwriting or guessing."}, func(ctx context.Context, req *mcp.CallToolRequest, input sceneParameterInput) (*mcp.CallToolResult, Output, error) {
		if err := requireMediaApproval(input.UserApproved); err != nil {
			return nil, Output{}, err
		}
		if err := validateIdempotencyKey(input.IdempotencyKey); err != nil {
			return nil, Output{}, err
		}
		if !scenes.IsSource(input.File) || !contractVersionPattern(input.SourceVersion) {
			return nil, Output{}, errors.New("Provide an existing scene filename and its exact sourceVersion.")
		}
		if len(input.Patch) == 0 {
			return nil, Output{}, errors.New("Provide at least one existing object to patch.")
		}
		if err := input.Patch.Validate(); err != nil {
			return nil, Output{}, err
		}
		path, err := projectPath(input.ProjectID, "/scenes/compile")
		if err != nil {
			return nil, Output{}, err
		}
		operation, err := jsonRequest(path, scenes.CompileRequest{SourceFile: input.File, SourceVersion: input.SourceVersion, ParameterPatch: input.Patch})
		if err != nil {
			return nil, Output{}, err
		}
		operation.IdempotencyKey = input.IdempotencyKey
		return invoke(ctx, req, call, operation)
	})
}
