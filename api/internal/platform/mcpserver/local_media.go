package mcpserver

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"ffmpeg-go-server/internal/core/media"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type localMediaListInput struct {
	ProjectID    string `json:"projectId"`
	RootID       string `json:"rootId,omitempty" jsonschema:"Configured owner-scoped root ID; omit to discover your available root IDs, never an absolute client/server path"`
	Directory    string `json:"directory,omitempty" jsonschema:"Approved relative directory, default the configured root; subdirectories are not scanned recursively"`
	Limit        int    `json:"limit,omitempty" jsonschema:"Page size 1–100, default 25"`
	Offset       int    `json:"offset,omitempty" jsonschema:"Page offset 0–10000; follow nextOffset"`
	UserApproved bool   `json:"userApproved" jsonschema:"True only after permission to list this local folder; does not authorize inspection, import, upload or spending"`
}

type localMediaInput struct {
	ProjectID    string `json:"projectId"`
	UserApproved bool   `json:"userApproved" jsonschema:"True only after permission to inspect the named local images and return thumbnails, or import the named files as local working copies, for this operation; listing consent is insufficient"`
	media.LocalImportRequest
}

func registerLocalMediaTools(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "list_local_media", Annotations: annotations(true, false, true),
		Description: "List an approved local folder without uploading files. Omit rootId to discover this account's configured root IDs. Requires administrator-configured owner-scoped LOCAL_MEDIA_ROOTS_JSON and, for Docker, an explicitly approved read-only bind mount. Only relative paths inside those roots are accepted; a loopback URL alone grants no disk access. Returns bounded paginated names/sizes, not images or use/spending consent. Disabled by default; never silently upload as a fallback.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input localMediaListInput) (*mcp.CallToolResult, Output, error) {
		if err := requireMediaApproval(input.UserApproved); err != nil {
			return nil, Output{}, err
		}
		path, err := projectPath(input.ProjectID, "/media/local")
		if err != nil {
			return nil, Output{}, err
		}
		if input.Limit == 0 {
			input.Limit = 25
		}
		if input.Limit < 1 || input.Limit > 100 || input.Offset < 0 || input.Offset > 10000 {
			return nil, Output{}, errors.New("Use limit 1–100 and offset 0–10000.")
		}
		query := url.Values{"rootId": {input.RootID}, "limit": {strconv.Itoa(input.Limit)}, "offset": {strconv.Itoa(input.Offset)}}
		if input.Directory != "" {
			query.Set("directory", input.Directory)
		}
		return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: path + "?" + query.Encode()})
	})
	mcp.AddTool(server, &mcp.Tool{Name: "import_local_media", Annotations: annotations(false, false, true),
		Description: "Use approved local media without network/S3 upload: copy selected files from a configured read-only owner-scoped local root into this owned project's volume. Originals are never edited, linked into the project or overwritten. Content-addressed working copies are reused on retries and work with get_asset_metadata, YAML edits, compile_scene and rendering. Select 1–100 named relative paths, at most 2 GiB total; pin an inspected sourceVersion when available. Reports partial imports on failure. No provider or credit charge; rendering remains separately billed/approved. Not zero-copy and cannot access an unmounted client disk. Never substitute upload without explicit consent.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input localMediaInput) (*mcp.CallToolResult, Output, error) {
		return localMediaOperation(ctx, req, call, input, "import")
	})
	mcp.AddTool(server, &mcp.Tool{Name: "inspect_local_media", Annotations: annotations(true, false, true),
		Description: "View 1–6 approved local raster images as bounded actual MCP JPEG thumbnails, without importing/uploading originals or charging credits. Requires a configured owner-scoped read-only local root and explicit image-inspection permission; listing is insufficient. Returns sourceVersion fingerprints for pinned subsequent import. PNG/JPEG/WebP/GIF/BMP, at most 32 MiB/16 million pixels each, thumbnails at most 480px. No video/audio playback, alpha verification or final-composition inspection. Original files remain unchanged.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input localMediaInput) (*mcp.CallToolResult, Output, error) {
		result, output, err := localMediaOperation(ctx, req, call, input, "inspect")
		if err != nil || result.IsError {
			return result, output, err
		}
		result.Content, err = localMediaImages(output.Data)
		return result, output, err
	})
}

func localMediaOperation(ctx context.Context, req *mcp.CallToolRequest, call Caller, input localMediaInput, operation string) (*mcp.CallToolResult, Output, error) {
	if err := requireMediaApproval(input.UserApproved); err != nil {
		return nil, Output{}, err
	}
	maximum := 100
	if operation == "inspect" {
		maximum = media.MaxLocalInspectionFiles
	}
	if input.RootID == "" || len(input.Files) < 1 || len(input.Files) > maximum {
		return nil, Output{}, fmt.Errorf("Select a configured rootId and 1–%d exact relative files.", maximum)
	}
	path, err := projectPath(input.ProjectID, "/media/local/"+operation)
	if err != nil {
		return nil, Output{}, err
	}
	request, err := jsonRequest(path, input.LocalImportRequest)
	if err != nil {
		return nil, Output{}, err
	}
	return invoke(ctx, req, call, request)
}

func localMediaImages(data any) ([]mcp.Content, error) {
	fields, ok := data.(map[string]any)
	if !ok {
		return nil, errors.New("Local inspection returned invalid evidence.")
	}
	images, ok := fields["images"].([]any)
	if !ok || len(images) < 1 || len(images) > media.MaxLocalInspectionFiles {
		return nil, errors.New("Local inspection returned invalid images.")
	}
	contents := make([]mcp.Content, 0, len(images)*2)
	for _, item := range images {
		image, ok := item.(map[string]any)
		if !ok || image["mimeType"] != "image/jpeg" {
			return nil, errors.New("Local inspection returned invalid image metadata.")
		}
		encoded, _ := image["data"].(string)
		bytes, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(bytes) == 0 || len(bytes) > 128<<10 {
			return nil, errors.New("Local inspection returned invalid bounded image bytes.")
		}
		contents = append(contents, &mcp.TextContent{Text: fmt.Sprintf("Local image %v, source %v (%v×%v). JPEG sample; alpha/motion/audio unverified.", image["file"], image["sourceVersion"], image["width"], image["height"])}, &mcp.ImageContent{MIMEType: "image/jpeg", Data: bytes})
		delete(image, "data")
	}
	return contents, nil
}
