package mcpserver

import (
	"context"
	"embed"
	"fmt"

	"ffmpeg-go-server/editengine/scenecontract"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

//go:embed guides/*.md reference/*.json reference/examples/*.yaml reference/scene-templates/*.svelte reference/film-library
var bundledGuides embed.FS

var guideResources = []struct{ uri, name, title, file string }{
	{"machinal://skills/editing", "editing-style-guide", "Editing direction and style profiles", "guides/editing.md"},
	{"machinal://skills/scenes", "scene-direction-guide", "Plan animated Svelte scenes, moving objects and image layouts", "guides/jobs-scenes.md"},
	{"machinal://skills/credits", "credit-workflow-guide", "Credit-aware editing workflow", "guides/credits.md"},
	{"machinal://skills/media", "media-workflow-guide", "Media consent, volume uploads and signed S3 delivery", "guides/media.md"},
	{"machinal://reference/overview", "editing-reference-overview", "Editing reference workflow and topic index", "guides/reference-overview.md"},
	{"machinal://reference/brief", "video-brief-guide", "Collaborative video brief, visual choices and output preferences", "guides/brief.md"},
	{"machinal://reference/production", "video-production-guide", "Director contract, critic checkpoints and normalized editorial evidence", "guides/production.md"},
	{"machinal://reference/yaml", "yaml-contract-reference", "YAML envelope, fields, versions, timing and montage", "guides/yaml.md"},
	{"machinal://reference/media", "media-transfer-reference", "Media permissions, storage, download preferences and recovery", "guides/media.md"},
	{"machinal://reference/transitions", "transition-reference", "Transition choices, placement and overlap math", "guides/transitions.md"},
	{"machinal://reference/effects", "effect-reference", "Effect choices, parameters, intervals and ramps", "guides/effects.md"},
	{"machinal://reference/looks-motion", "look-motion-reference", "Look expansion, motion and style namespaces", "guides/looks-motion.md"},
	{"machinal://reference/text-audio", "text-audio-reference", "Typography, verified captions, fonts and audio", "guides/text-audio.md"},
	{"machinal://reference/jobs-scenes", "job-scene-reference", "Staged generation jobs and concrete scene direction", "guides/jobs-scenes.md"},
	{"machinal://reference/scene-authoring", "client-scene-authoring", "Current-client Svelte authoring, free compilation and source editing", "guides/scene-authoring.md"},
	{"machinal://reference/scene-templates", "scene-template-guide", "Reusable effect components, selection and source-level adaptation", "guides/scene-templates.md"},
	{"machinal://reference/film-styles", "film-style-guide", "Cinematic film styles and safe adaptation to machinal", "guides/film-styles.md"},
	{"machinal://reference/commands", "command-reference", "Selectors, overrides and every edit command", "guides/commands.md"},
	{"machinal://reference/styles", "named-style-reference", "Named editorial profiles and decision rules", "guides/styles.md"},
	{"machinal://reference/examples", "recipe-example-reference", "Complete compiler-tested YAML examples", "guides/examples.md"},
}

func registerGuideResources(server *mcp.Server) {
	server.AddResource(&mcp.Resource{URI: "machinal://reference/scene-runtime", Name: "scene-runtime-contract", Title: "Implemented scene fonts, images and Three.js API", MIMEType: "text/markdown"},
		func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: "machinal://reference/scene-runtime", MIMEType: "text/markdown", Text: scenecontract.Guide}}}, nil
		})
	for _, guide := range guideResources {
		server.AddResource(&mcp.Resource{
			URI: guide.uri, Name: guide.name, Title: guide.title, MIMEType: "text/markdown",
		}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			content, err := bundledGuides.ReadFile(guide.file)
			if err != nil {
				return nil, fmt.Errorf("read bundled MCP guide: %w", err)
			}
			return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
				URI: guide.uri, MIMEType: "text/markdown", Text: string(content),
			}}}, nil
		})
	}
}
