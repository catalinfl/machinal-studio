package mcpserver

import (
	"context"
	"errors"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	// MaxRequestBytes bounds recipe/metadata envelopes; media bytes use REST.
	MaxRequestBytes     = 4 << 20
	MaxResultBytes      = 2 << 20
	maxCompositionBytes = 2 << 20
)

// ErrResultTooLarge tells clients to retrieve a large result through REST instead.
var ErrResultTooLarge = errors.New("API result exceeds MCP response limits")

// Request is an in-process /v1 operation assembled by a registered tool.
type Request struct {
	Method         string
	Path           string
	ContentType    string
	Body           []byte
	IdempotencyKey string
}

// Response carries bounded API metadata, never a streaming media body.
type Response struct {
	StatusCode int
	Header     http.Header
	Body       []byte
}

// Caller dispatches only to this application's versioned API, never to caller-supplied URLs.
type Caller func(context.Context, http.Header, Request) (Response, error)

type Output struct {
	StatusCode int    `json:"statusCode"`
	Data       any    `json:"data"`
	StatusURL  string `json:"statusUrl,omitempty"`
	RetryAfter string `json:"retryAfter,omitempty"`
}

// NewHandler serves stateless Streamable HTTP; authentication belongs on the enclosing route.
func NewHandler(call Caller) http.Handler {
	return newHandler(call, false)
}

func NewLocalHandler(call Caller) http.Handler {
	return newHandler(call, true)
}

func newHandler(call Caller, local bool) http.Handler {
	serverInstructions := instructions
	name := "machinal"
	if local {
		serverInstructions = localInstructions
		name = "machinal-local"
	}
	server := mcp.NewServer(&mcp.Implementation{Name: name, Version: "1.10.0"}, &mcp.ServerOptions{
		Instructions: serverInstructions,
		Capabilities: &mcp.ServerCapabilities{},
	})
	refs := newRecipeRefs()
	registerProjectTools(server, call)
	registerCompositionTools(server, call, refs)
	registerSceneTools(server, call)
	registerJobTools(server, call, refs)
	registerMediaTools(server, call)
	registerLocalMediaTools(server, call)
	registerMediaAccessTools(server, call)
	registerDownloadPreferences(server, call)
	registerWorkflowPreferences(server, call)
	if !local {
		registerCreditTools(server, call)
	}
	registerRoutingTool(server, call)
	registerGuideResources(server)
	server.AddResource(&mcp.Resource{URI: "machinal://reference/workflow", Name: "client-workflow-reference", Title: "Workflow policy in the installed MCP package", MIMEType: "text/markdown"},
		func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: "machinal://reference/workflow", MIMEType: "text/markdown", Text: clientLibraryNotice}}}, nil
		})
	registerReferenceTools(server)
	registerSpeechTools(server)
	registerSoundEffectTools(server, call)
	server.AddResource(&mcp.Resource{
		URI: "machinal://recipes/guide", Name: "recipe-guide", Title: "machinal recipe workflow", MIMEType: "text/markdown",
	}, func(_ context.Context, _ *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{
			URI: "machinal://recipes/guide", MIMEType: "text/markdown", Text: clientLibraryNotice,
		}}}, nil
	})
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{
		Stateless: true, JSONResponse: true, MaxRequestBodyBytes: MaxRequestBytes,
		PropagateRequestCancellation: true,
	})
}

func annotations(readOnly, destructive, idempotent bool) *mcp.ToolAnnotations {
	return &mcp.ToolAnnotations{
		ReadOnlyHint: readOnly, DestructiveHint: &destructive,
		IdempotentHint: idempotent, OpenWorldHint: new(bool),
	}
}
