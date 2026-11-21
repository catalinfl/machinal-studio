package mcpserver

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"

	"ffmpeg-go-server/internal/core/editor/scenes"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type inspectSceneInput struct {
	ProjectID    string `json:"projectId"`
	UserApproved bool   `json:"userApproved" jsonschema:"True only after permission to inspect this named scene and return its sampled images to the current client; listing consent is insufficient"`
	scenes.InspectRequest
}

func registerSceneInspectionTools(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "inspect_scene", Annotations: annotations(true, false, true),
		Description: "Inspect 1-6 explicit frame indices of an approved compiled live scene. Read get_scene_source for sourceVersion/config first. Returns actual bounded JPEG thumbnails as MCP images, timestamped layout diagnostics and optional data-scene-object DOM bounds. Rejects stale sourceVersion. No provider, final video encoding or machinal credit charge; bounded diagnostic browser work only. Does NOT inspect the final composition, prove pixel visibility of annotated objects, motion smoothness, audio sync or aesthetic quality. Inspect only frames needed by the production contract; never start an automatic review loop.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input inspectSceneInput) (*mcp.CallToolResult, Output, error) {
		if err := requireMediaApproval(input.UserApproved); err != nil {
			return nil, Output{}, err
		}
		if err := input.InspectRequest.Validate(); err != nil {
			return nil, Output{}, err
		}
		path, err := projectPath(input.ProjectID, "/scenes/inspect")
		if err != nil {
			return nil, Output{}, err
		}
		operation, err := jsonRequest(path, input.InspectRequest)
		if err != nil {
			return nil, Output{}, err
		}
		result, output, err := invoke(ctx, req, call, operation)
		if err != nil || output.StatusCode != 200 {
			return result, output, err
		}
		images, err := sceneEvidenceImages(output.Data)
		if err != nil {
			return nil, Output{}, err
		}
		result.Content = images
		return result, output, nil
	})
}

func sceneEvidenceImages(data any) ([]mcp.Content, error) {
	fields, ok := data.(map[string]any)
	if !ok {
		return nil, errors.New("Scene inspection returned invalid evidence.")
	}
	evidence, ok := fields["evidence"].(map[string]any)
	if !ok {
		return nil, errors.New("Scene inspection returned invalid evidence.")
	}
	frames, ok := evidence["frames"].([]any)
	if !ok || len(frames) < 1 || len(frames) > scenes.MaxInspectionFrames {
		return nil, errors.New("Scene inspection returned invalid frames.")
	}
	contents := make([]mcp.Content, 0, len(frames)*2)
	for _, item := range frames {
		frame, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("Scene inspection returned invalid frame metadata.")
		}
		encoded, ok := frame["data"].(string)
		if !ok || frame["mimeType"] != "image/jpeg" {
			return nil, errors.New("Scene inspection returned invalid image content.")
		}
		image, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(image) == 0 {
			return nil, errors.New("Scene inspection returned invalid image encoding.")
		}
		contents = append(contents, &mcp.TextContent{Text: fmt.Sprintf("Scene %v, source %v, frame %v at %v seconds. Sample only; motion/audio unverified.", fields["file"], fields["sourceVersion"], frame["frame"], frame["time"])}, &mcp.ImageContent{MIMEType: "image/jpeg", Data: image})
		delete(frame, "data")
	}
	return contents, nil
}
