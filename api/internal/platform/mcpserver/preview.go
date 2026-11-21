package mcpserver

import (
	"context"
	"errors"
	"net/url"
	"strconv"

	"ffmpeg-go-server/internal/core/editor/render"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type renderPreviewInput struct {
	RecipeRef                  string  `json:"recipeRef,omitempty" jsonschema:"Reuse the project's preflight recipeRef instead of composition/sourceJobId"`
	ProjectID                  string  `json:"projectId"`
	Composition                string  `json:"composition,omitempty" jsonschema:"Exact fully resolved YAML; no pending generation"`
	SourceJobID                string  `json:"sourceJobId,omitempty" jsonschema:"Unchanged resolved generation job; do not also send composition"`
	IdempotencyKey             string  `json:"idempotencyKey"`
	UserApproved               bool    `json:"userApproved" jsonschema:"True only after explicit source and local preview-processing approval covering COMPLETE timeline and full referenced scene processing, not just the excerpt"`
	ExpectedCompositionVersion string  `json:"expectedCompositionVersion" jsonschema:"Required exact reviewed/resolved YAML fingerprint from productionReview"`
	Start                      float64 `json:"start" jsonschema:"Global timeline start in seconds; captions and source timing remain unchanged"`
	Duration                   float64 `json:"duration" jsonschema:"Excerpt duration, greater than zero and at most 15 seconds, covered by the fully resolved MP4 composition"`
}

func registerPreviewTools(server *mcp.Server, call Caller, refs *recipeRefs) {
	hints := annotations(false, false, true)
	openWorld := true
	hints.OpenWorldHint = &openWorld
	mcp.AddTool(server, &mcp.Tool{Name: "render_preview", Annotations: hints, Description: "Queue a short MP4 preview in the user's local Docker installation, with final compositing and mixed audio. Requires a fully resolved valid YAML and explicit source/processing approval. NO pending generation is allowed. IMPORTANT: it processes the COMPLETE composition and full referenced scenes, then excerpts at final encoding; CPU/memory/time are not limited to the 1-15s excerpt. No machinal account or credits are used. Preserve recipe/captions and final delivery. Uses existing jobs/idempotency/waits/delivery; no automatic preview loop. Reuse successful assets and pass expectedCompositionVersion for the reviewed recipe." + captionPreservationToolHint}, func(ctx context.Context, req *mcp.CallToolRequest, input renderPreviewInput) (*mcp.CallToolResult, Output, error) {
		if err := requireMediaApproval(input.UserApproved); err != nil {
			return nil, Output{}, err
		}
		if err := validateIdempotencyKey(input.IdempotencyKey); err != nil {
			return nil, Output{}, err
		}
		if err := (render.PreviewWindow{Start: input.Start, Duration: input.Duration}).Validate(); err != nil {
			return nil, Output{}, err
		}
		composition, err := refs.resolve(ctx, req, call, input.ProjectID, input.SourceJobID, input.Composition, input.RecipeRef)
		if err != nil {
			return nil, Output{}, err
		}
		if input.ExpectedCompositionVersion == "" || input.ExpectedCompositionVersion != compositionVersion(composition) {
			return nil, Output{}, errors.New("Preview requires expectedCompositionVersion matching the exact reviewed/resolved YAML; compile it before paid submission.")
		}
		operation, err := compositionRequest(input.ProjectID, composition, "/renders/preview", input.IdempotencyKey)
		if err != nil {
			return nil, Output{}, err
		}
		query := url.Values{"previewStart": {strconv.FormatFloat(input.Start, 'f', -1, 64)}, "previewDuration": {strconv.FormatFloat(input.Duration, 'f', -1, 64)}}
		operation.Path += "?" + query.Encode()
		return invoke(ctx, req, call, operation)
	})
}
