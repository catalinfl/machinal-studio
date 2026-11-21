package mcpserver

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"

	"ffmpeg-go-server/internal/core/media"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type inspectRenderInput struct {
	jobInput
	UserApproved bool `json:"userApproved" jsonschema:"Permission to inspect this completed output and return sample frames to the client"`
	media.RenderSamples
}

func registerRenderInspection(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "inspect_render", Description: "Sample the actual completed MP4 of an owned render job, including composited captions/effects/transitions. Optional mixed-audio window returns integrated LUFS, true peak dBTP and clipping risk (not source attribution or proof of audible distortion). No new render or credits.", Annotations: annotations(true, false, true)}, func(ctx context.Context, req *mcp.CallToolRequest, input inspectRenderInput) (*mcp.CallToolResult, Output, error) {
		if err := requireMediaApproval(input.UserApproved); err != nil {
			return nil, Output{}, err
		}
		if err := input.RenderSamples.Validate(); err != nil {
			return nil, Output{}, err
		}
		if _, err := jobPath(input.ProjectID, input.JobID); err != nil {
			return nil, Output{}, err
		}
		path, _ := projectPath(input.ProjectID, "/renders/"+input.JobID+"/inspect")
		op, err := jsonRequest(path, input.RenderSamples)
		if err != nil {
			return nil, Output{}, err
		}
		result, output, err := invoke(ctx, req, call, op)
		if err != nil || result.IsError {
			return result, output, err
		}
		fields, _ := output.Data.(map[string]any)
		frames, ok := fields["frames"].([]any)
		if !ok || len(frames) != len(input.Times) {
			return nil, Output{}, errors.New("Unexpected render sample count.")
		}
		for _, item := range frames {
			frame, _ := item.(map[string]any)
			data, _ := frame["data"].(string)
			raw, err := base64.StdEncoding.DecodeString(data)
			if err != nil || len(raw) == 0 || len(raw) > 128<<10 || frame["mimeType"] != "image/jpeg" {
				return nil, Output{}, errors.New("Invalid render sample.")
			}
			result.Content = append(result.Content, &mcp.TextContent{Text: fmt.Sprintf("Composed MP4 sample at %v seconds.", frame["time"])}, &mcp.ImageContent{Data: raw, MIMEType: "image/jpeg"})
			delete(frame, "data")
		}
		return result, output, nil
	})
}
