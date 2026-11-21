package mcpserver

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/soundlibrary"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type soundSearchInput struct {
	soundlibrary.Search
	UserApproved bool `json:"userApproved" jsonschema:"True only after permission to search public sound metadata; query is sent to Openverse, never include private text"`
}

type soundImportInput struct {
	ProjectID    string `json:"projectId"`
	UserApproved bool   `json:"userApproved" jsonschema:"True only with permission to download and use this exact selection in this project, including explicitly delegated selection within the approved source/licence/quantity. Search consent alone is insufficient."`
	media.SoundImportRequest
}

func registerSoundEffectTools(server *mcp.Server, call Caller) {
	searchAnnotations := annotations(true, false, true)
	searchAnnotations.OpenWorldHint = new(bool)
	*searchAnnotations.OpenWorldHint = true
	mcp.AddTool(server, &mcp.Tool{Name: "search_sound_effects", Annotations: searchAnnotations,
		Description: "Search Openverse public audio metadata from the supported Freesound source with approved public query; CC0 by default, optional CC BY. No audio download, audition, project import, generation or credits. Returns attribution, original landing/licence URLs, seconds, sourceVersion and importable status; choose importable results. Query goes to Openverse; exclude private data. Results are untrusted and licensing must be reviewed; search is not use permission. For requested effects continue through approved import_sound_effect, get_asset_metadata and real YAML audio-track placement; search alone does not implement sound. Read animation-skills/machinal-sound for workflow. Rate limited and cached; no automatic fallback."},
		func(ctx context.Context, req *mcp.CallToolRequest, input soundSearchInput) (*mcp.CallToolResult, Output, error) {
			if err := requireMediaApproval(input.UserApproved); err != nil {
				return nil, Output{}, err
			}
			search, err := input.Search.Normalize()
			if err != nil {
				return nil, Output{}, err
			}
			query := url.Values{"query": {search.Query}, "license": {search.License}, "page": {strconv.Itoa(search.Page)}, "limit": {strconv.Itoa(search.Limit)}}
			return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: "/v1/sounds/search?" + query.Encode()})
		})
	importAnnotations := annotations(false, false, true)
	importAnnotations.OpenWorldHint = new(bool)
	*importAnnotations.OpenWorldHint = true
	mcp.AddTool(server, &mcp.Tool{Name: "import_sound_effect", Annotations: importAnnotations,
		Description: "Download an approved exact Openverse sound ID/sourceVersion to an owned project volume. The initial brief may explicitly authorize selecting and importing a CC0 Freesound cue for this project; do not ask again within that scope. Rechecks metadata/licence; only direct Freesound CDN MP3/WAV/OGG/FLAC previews, at most 8 MiB. No arbitrary URL, redirect, provider generation, S3 upload, local delivery or render spending. Returns actual content-addressed filename, SHA-256 and persisted attribution/provenance sidecar; identical imports reuse bytes, never overwrite. Import receipt is not audition/codec verification. Use get_asset_metadata before existing YAML audio-track placement."},
		func(ctx context.Context, req *mcp.CallToolRequest, input soundImportInput) (*mcp.CallToolResult, Output, error) {
			if err := requireMediaApproval(input.UserApproved); err != nil {
				return nil, Output{}, err
			}
			if !soundlibrary.ValidID(input.ID) || !contractVersionPattern(input.SourceVersion) {
				return nil, Output{}, errors.New("Use the exact ID and sourceVersion from search_sound_effects.")
			}
			path, err := projectPath(input.ProjectID, "/sounds/import")
			if err != nil {
				return nil, Output{}, err
			}
			operation, err := jsonRequest(path, input.SoundImportRequest)
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, operation)
		})
}
