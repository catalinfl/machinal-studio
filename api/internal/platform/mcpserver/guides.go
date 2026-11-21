package mcpserver

import (
	"context"

	"ffmpeg-go-server/editengine/scenecontract"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var guideResources = []struct{ uri, name string }{
	{"machinal://skills/editing", "editing-style-guide"},
	{"machinal://skills/scenes", "scene-direction-guide"},
	{"machinal://skills/credits", "credit-workflow-guide"},
	{"machinal://skills/media", "media-workflow-guide"},
	{"machinal://reference/overview", "editing-reference-overview"},
	{"machinal://reference/brief", "video-brief-guide"},
	{"machinal://reference/production", "video-production-guide"},
	{"machinal://reference/yaml", "yaml-contract-reference"},
	{"machinal://reference/media", "media-transfer-reference"},
	{"machinal://reference/transitions", "transition-reference"},
	{"machinal://reference/effects", "effect-reference"},
	{"machinal://reference/looks-motion", "look-motion-reference"},
	{"machinal://reference/text-audio", "text-audio-reference"},
	{"machinal://reference/jobs-scenes", "job-scene-reference"},
	{"machinal://reference/scene-authoring", "client-scene-authoring"},
	{"machinal://reference/scene-templates", "scene-template-guide"},
	{"machinal://reference/animation-skills", "animation-craft-guide"},
	{"machinal://reference/film-styles", "film-style-guide"},
	{"machinal://reference/hyperframes", "hyperframes-adaptation-guide"},
	{"machinal://reference/commands", "command-reference"},
	{"machinal://reference/styles", "named-style-reference"},
	{"machinal://reference/examples", "recipe-example-reference"},
}

func registerGuideResources(server *mcp.Server) {
	server.AddResource(&mcp.Resource{URI: "machinal://reference/scene-runtime", Name: "scene-runtime-contract", Title: "Implemented scene fonts, images and Three.js API", MIMEType: "text/markdown"},
		func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: "machinal://reference/scene-runtime", MIMEType: "text/markdown", Text: scenecontract.Guide}}}, nil
		})
	for _, guide := range guideResources {
		server.AddResource(&mcp.Resource{
			URI: guide.uri, Name: guide.name, Title: "Installed MCP authoring reference", MIMEType: "text/markdown",
		}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
				URI: guide.uri, MIMEType: "text/markdown", Text: clientLibraryNotice,
			}}}, nil
		})
	}
}
