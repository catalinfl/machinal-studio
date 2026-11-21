package mcpserver

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type assetFile struct {
	ID   string `json:"id" jsonschema:"Binding ID to assign to this asset"`
	File string `json:"file" jsonschema:"Existing project filename from list_media"`
}

type assetInput struct {
	ProjectID    string      `json:"projectId"`
	Files        []assetFile `json:"files" jsonschema:"Request 1–100 existing project files"`
	UserApproved bool        `json:"userApproved" jsonschema:"True only after user approval to inspect/use these specific files, including hydrating S3 sources into the volume. Listing approval alone is insufficient."`
}

type videoInput struct {
	ProjectID         string `json:"projectId"`
	JobID             string `json:"jobId"`
	Delivery          string `json:"delivery,omitempty" jsonschema:"link (default) returns a user-facing temporary opaque download link; local also reads the approved client-local download directory. Neither mode downloads bytes or writes server/container paths."`
	UserApproved      bool   `json:"userApproved" jsonschema:"True only after the user agrees to receiving/downloading this job's output."`
	RequirePublicLink bool   `json:"requirePublicLink,omitempty" jsonschema:"Reject loopback-only delivery when the link must open on another device. Requires an administrator-configured reachable HTTPS PUBLIC_API_URL; never rerenders or changes deployment."`
}

func registerMediaTools(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "list_media", Description: "After user permission to see filenames, list an owned project's media from s3, volume or all. Does not download contents. Returns paginated files and nextOffset. Listing permission does not authorize downloads, use or spending.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input mediaListInput) (*mcp.CallToolResult, Output, error) {
			operation, err := mediaListRequest(input)
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, operation)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "get_asset_metadata", Description: "Get immutable source metadata for recipe assets (duration, kind, dimensions, content version). Reads only owned project files; may probe video/audio.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input assetInput) (*mcp.CallToolResult, Output, error) {
			if err := requireMediaApproval(input.UserApproved); err != nil {
				return nil, Output{}, err
			}
			path, err := projectPath(input.ProjectID, "/compositions/assets")
			if err != nil {
				return nil, Output{}, err
			}
			operation, err := jsonRequest(path, struct {
				Files []assetFile `json:"files"`
			}{input.Files})
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, operation)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "get_upload_target", Description: "Read topic=media in get_editing_reference for transfer steps. Get the owned project's authenticated multipart REST upload route. New source bytes go directly to the persistent volume, NOT S3. The host's local tools read/upload selected files; this remote MCP cannot read local paths. Then get approved asset metadata and validate the YAML.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input projectInput) (*mcp.CallToolResult, Output, error) {
			path, err := projectPath(input.ProjectID, "")
			if err != nil {
				return nil, Output{}, err
			}
			result, output, err := invoke(ctx, req, call, Request{Method: http.MethodGet, Path: path})
			if err == nil && !result.IsError {
				output.Data = map[string]any{"method": "POST", "path": path + "/upload", "encoding": "multipart/form-data", "fileField": "file",
					"authentication": "none; loopback-only local installation. Do not send hosted application credentials.", "maxFileBytes": int64(2 << 30), "storage": "volume", "uploadsToS3": false,
					"modelAttachments": map[string]any{"extension": ".glb", "maxFileBytes": 4 << 20, "selfContainedOnly": true, "compileField": "models", "genericVideoImageAsset": false},
					"nextSteps":        "Upload only selected local files using the host's transfer tools and this same-origin path. Keep returned filenames; do not upload another copy to S3. After source-use permission, get_asset_metadata for ordinary media and validate_recipe. GLB model attachments instead use compile_scene.models with the actual filename; do not turn GLB into a video/image asset. See get_editing_reference(topic=media) and scene-runtime."}
			}
			return result, output, err
		})
	mcp.AddTool(server, &mcp.Tool{Name: "get_video_result", Description: "After approval to receive a completed render, return a temporary opaque application download link, NOT S3 credentials or video bytes. delivery=link (default): give the requested clickable link and expiry; do not download locally instead. delivery=local: read the client's preferred directory and download only if requested, without overwriting. Cloud links redirect directly to S3; the API never proxies cloud bytes. On expiry request a new link for the SAME job, never rerender. Unfinished jobs return compact status only.", Annotations: annotations(false, false, false)},
		func(ctx context.Context, req *mcp.CallToolRequest, input videoInput) (*mcp.CallToolResult, Output, error) {
			if err := requireMediaApproval(input.UserApproved); err != nil {
				return nil, Output{}, err
			}
			if err := validateDelivery(input.Delivery); err != nil {
				return nil, Output{}, err
			}
			return videoResult(ctx, req, call, input)
		})
}

func videoResult(ctx context.Context, req *mcp.CallToolRequest, call Caller, input videoInput) (*mcp.CallToolResult, Output, error) {
	jobURL, err := jobPath(input.ProjectID, input.JobID)
	if err != nil {
		return nil, Output{}, err
	}
	result, output, err := invoke(ctx, req, call, Request{Method: http.MethodGet, Path: jobURL + "?view=summary"})
	if err != nil || result.IsError {
		return result, output, err
	}
	job, ok := output.Data.(map[string]any)
	if !ok || job["status"] != "completed" {
		return result, output, nil
	}
	if kind := job["kind"]; kind != "automation-render" && kind != "render" && kind != "editor-render" {
		return nil, Output{}, errors.New("This job is not a video/audio render. Read get_job.result or list_media for generated assets.")
	}
	filename, _ := job["filename"].(string)
	if filename == "" || strings.ContainsAny(filename, "/\\\x00\r\n") || strings.HasPrefix(filename, ".") {
		return nil, Output{}, errors.New("This completed job has no downloadable render. Read get_job.result or list_media instead.")
	}
	return mediaDownload(ctx, req, call, input.ProjectID, filename, false, input.Delivery, job, input.RequirePublicLink)
}
