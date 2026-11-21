package mcpserver

import (
	"context"
	"errors"
	"net/http"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/compositions"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const captionPreservationToolHint = " Preserve existing captions verbatim, including text/word spacing, grouping, timings, layout, animation/highlighting and resultTextIds, unless the user explicitly requests caption edits. Patch only the requested fields; renderer fitting is not a reason to rewrite captions."

const productionContractToolHint = " compile_recipe also accepts optional productionContract and adds productionReview with exact YAML/contract fingerprints and deterministic beat/asset/treatment/handoff checks; read topic=production. These reports are not aesthetic approval."

type compositionInput struct {
	RecipeRef              string              `json:"recipeRef,omitempty" jsonschema:"Reuse an unchanged YAML revision from a successful validate_recipe or compile_recipe in this project instead of composition/sourceJobId. Temporary; resend YAML after expiry or edits."`
	ProjectID              string              `json:"projectId"`
	Composition            string              `json:"composition,omitempty" jsonschema:"Complete YAML composition, including document, bindings and assets when needed; not JSON or a local filesystem path"`
	SourceJobID            string              `json:"sourceJobId,omitempty" jsonschema:"Reuse the unchanged resolved YAML from an owned generation job instead of resending it; do not also set composition"`
	Draft                  bool                `json:"draft,omitempty" jsonschema:"For compile_recipe only: allow unresolved generation actions"`
	FullResult             bool                `json:"fullResult,omitempty" jsonschema:"Return the full normalized document and plan. Default is a compact response with diagnostics, requirements, summary, versions and reviews; request fullResult only when reading normalized source is necessary."`
	ExpectedCaptionVersion string              `json:"expectedCaptionVersion,omitempty" jsonschema:"Optional deterministic preservation guard from get_job_result or prior preflight: all text entries and caption resultTextIds must be identical. New/changed recipe text requires an explicitly authorized new baseline."`
	CaptionBaseline        string              `json:"captionBaseline,omitempty" jsonschema:"Optional intact resolved baseline YAML for deterministic comparison of complete caption entries and resultTextIds. No media use or paid work. Prefer captionBaselineJobId or captionBaselineRef to avoid resending large YAML."`
	CaptionBaselineJobID   string              `json:"captionBaselineJobId,omitempty" jsonschema:"Optional owned generation job ID (e.g. timing-first pass) whose resolved YAML is loaded on the server as the intact caption baseline instead of resending captionBaseline inline. Mutually exclusive with captionBaseline and captionBaselineRef."`
	CaptionBaselineRef     string              `json:"captionBaselineRef,omitempty" jsonschema:"Optional recipeRef from get_job_result or prior preflight in this project to use as the intact caption baseline instead of resending captionBaseline inline. Mutually exclusive with captionBaseline and captionBaselineJobId."`
	CaptionTextEdits       []captionTextEdit   `json:"captionTextEdits,omitempty" jsonschema:"Only explicitly approved exact text replacements; applied to baseline text and word strings, never timings, grouping or styling. Requires captionEditsApproved."`
	CaptionEditsApproved   bool                `json:"captionEditsApproved,omitempty" jsonschema:"True only after the user authorized these exact caption text replacements; not permission to regroup, retime or restyle captions."`
	ProductionContract     *productionContract `json:"productionContract,omitempty" jsonschema:"For compile_recipe only: structured beat, asset, choreography, handoff and treatment promises bound to the exact YAML revision; deterministic checks, never aesthetic approval"`
	ProductionBaseline     *productionContract `json:"productionBaseline,omitempty" jsonschema:"Optional original structured contract for compile_recipe. Keep every original beat ID when reconciling implementation; omitted/collapsed beats produce revision_required findings, not silent approval."`
}

type renderInput struct {
	RecipeRef                  string `json:"recipeRef,omitempty" jsonschema:"Reuse this project's preflight recipeRef instead of composition/sourceJobId"`
	ProjectID                  string `json:"projectId"`
	Composition                string `json:"composition,omitempty" jsonschema:"Complete YAML composition; source files must already be in this project"`
	SourceJobID                string `json:"sourceJobId,omitempty" jsonschema:"Reuse the unchanged resolved YAML from an owned generation job; do not also set composition"`
	IdempotencyKey             string `json:"idempotencyKey" jsonschema:"Unique request key, 1-128 characters. Reuse the same key and composition after an uncertain retry; use a new key for intentionally new work."`
	UserApproved               bool   `json:"userApproved" jsonschema:"True only after approval to use these sources, run local processing and any provider-billed image, speech or caption jobs on the user's own OpenRouter account. Local rendering uses no machinal credits. Listing consent alone is insufficient."`
	ExpectedCompositionVersion string `json:"expectedCompositionVersion,omitempty" jsonschema:"Optional stale-review guard: exact productionReview.compositionVersion of the reviewed YAML. This is not approval or a substitute for authorization/preflight."`
	ExpectedCaptionVersion     string `json:"expectedCaptionVersion,omitempty" jsonschema:"Optional exact text/caption preservation guard from get_job_result or preflight; checked before any paid submission."`
}

type capabilitiesInput struct {
	FullCatalog bool `json:"fullCatalog,omitempty" jsonschema:"Include the large full preset catalog only when needed; normally use targeted get_editing_reference lookups"`
}

func registerCompositionTools(server *mcp.Server, call Caller, refs *recipeRefs) {
	if refs == nil {
		refs = newRecipeRefs()
	}
	registerPreviewTools(server, call, refs)
	registerRecipePatchTool(server, call, refs)
	registerRenderInspection(server, call)
	mcp.AddTool(server, &mcp.Tool{Name: "get_capabilities", Description: "Get a compact live capability/configuration summary, schemaHash, language support and unsupported features such as music generation. Cache it for this workflow. Configuration does not prove provider health. Use fullCatalog=true only when the full catalog is needed; prefer targeted get_editing_reference lookups.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input capabilitiesInput) (*mcp.CallToolResult, Output, error) {
			path := "/v1/compositions/capabilities"
			if !input.FullCatalog {
				path += "?summary=true"
			}
			return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: path})
		})
	for _, tool := range []struct{ name, path, description string }{
		{"get_recipe_schema", "/v1/compositions/schema", "Get the authoritative document JSON schema used to validate YAML. The composition envelope has sibling bindings/assets/snapshot; get_editing_reference(topic=yaml) explains their semantics. Cache it until schemaHash changes."},
	} {
		mcp.AddTool(server, &mcp.Tool{Name: tool.name, Description: tool.description, Annotations: annotations(true, false, true)},
			func(ctx context.Context, req *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, Output, error) {
				return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: tool.path})
			})
	}
	for _, tool := range []struct{ name, suffix, description string }{
		{"validate_recipe", "/compositions/validate", "Validate the exact YAML after every edit without paid generation or rendering. Include metadata from get_asset_metadata. Checks timeline geometry/overlaps once assets and jobs are resolved; pending requirements require revalidation after materialization. Before final render_video require no error diagnostics or unresolved requirements. version is numeric, optional catalogVersion/compilerVersion are quoted strings; clip outPoint is source time, not timeline end."},
		{"compile_recipe", "/compositions/compile", "Compile a composition into an editing plan without paid generation or rendering. Include source asset metadata. Adds editorialReview: actual junctions (including implicit cross-dissolves), looks, motions and expanded effects from the normalized plan. Compare it with the production contract before rendering; it is not visual inspection or aesthetic approval. Read topic=production for the director/critic workflow. Draft mode allows unresolved generation actions but cannot pass editorial review."},
	} {
		mcp.AddTool(server, &mcp.Tool{Name: tool.name, InputSchema: compositionToolSchema(), Description: tool.description + productionContractToolHint + captionPreservationToolHint, Annotations: annotations(true, false, true)},
			func(ctx context.Context, req *mcp.CallToolRequest, input compositionInput) (*mcp.CallToolResult, Output, error) {
				composition, err := refs.resolve(ctx, req, call, input.ProjectID, input.SourceJobID, input.Composition, input.RecipeRef)
				if err != nil {
					return nil, Output{}, err
				}
				parsed, _, err := compositions.ParseProject([]byte(composition))
				if err != nil {
					diagnostic := document.Diagnostic{Code: "parse", Severity: "error", Path: "document", Message: err.Error()}
					var positioned document.Diagnostic
					if errors.As(err, &positioned) {
						diagnostic = positioned
					}
					output := Output{StatusCode: http.StatusBadRequest, Data: map[string]any{
						"diagnostics": []document.Diagnostic{diagnostic}, "requirements": []any{},
						"captionReview": map[string]any{"status": "not_checked", "reason": "Recipe parsing failed; no caption comparison or paid work was performed."},
					}}
					return &mcp.CallToolResult{IsError: true}, presentComposition(output, composition, input.FullResult, nil), nil
				}
				if input.ProductionContract != nil {
					if tool.name != "compile_recipe" {
						return nil, Output{}, errors.New("productionContract applies only to compile_recipe.")
					}
					if err := input.ProductionContract.validate(); err != nil {
						var field *contractValidationError
						if errors.As(err, &field) {
							return &mcp.CallToolResult{IsError: true}, Output{StatusCode: 422, Data: map[string]any{"diagnostics": []document.Diagnostic{field.diagnostic}}}, nil
						}
						return nil, Output{}, err
					}
				}
				if input.ProductionBaseline != nil {
					if tool.name != "compile_recipe" {
						return nil, Output{}, errors.New("productionBaseline applies only to compile_recipe.")
					}
					if err := input.ProductionBaseline.validate(); err != nil {
						return nil, Output{}, err
					}
				}
				operation, err := compositionRequest(input.ProjectID, composition, tool.suffix, "")
				if err != nil {
					return nil, Output{}, err
				}
				captionBaseline, err := refs.resolveCaptionBaseline(ctx, req, call, input.ProjectID, input.CaptionBaseline, input.CaptionBaselineJobID, input.CaptionBaselineRef)
				if err != nil {
					return nil, Output{}, err
				}
				captionGuardSource := composition
				if captionBaseline != "" && len(input.CaptionTextEdits) > 0 && input.CaptionEditsApproved {
					captionGuardSource = captionBaseline
				}
				if err := checkCaptionVersion(captionGuardSource, input.ExpectedCaptionVersion); err != nil {
					return nil, Output{}, err
				}
				captionReview, err := compareCaptionBaseline(composition, captionBaseline, input.CaptionTextEdits, input.CaptionEditsApproved)
				if err != nil {
					return nil, Output{}, err
				}
				if tool.name == "compile_recipe" && input.Draft {
					operation.Path += "?draft=true"
				}
				result, output, err := invoke(ctx, req, call, operation)
				if err == nil && tool.name == "compile_recipe" {
					output = attachEditorialReview(output)
					output = attachProductionReview(output, composition, input.ProductionContract)
					output = compareProductionBaseline(output, input.ProductionContract, input.ProductionBaseline)
				}
				if err == nil {
					if fields, ok := output.Data.(map[string]any); ok && captionReview != nil {
						fields["captionReview"] = captionReview
					}
					output = attachCompositionCheckpoint(output)
					output = presentComposition(output, composition, input.FullResult, &parsed.Document)
					if fields, ok := output.Data.(map[string]any); ok && output.StatusCode == http.StatusOK {
						fields["recipeRef"] = refs.save(req, input.ProjectID, composition)
					}
				}
				return result, output, err
			})
	}
	for _, tool := range []struct{ name, suffix, description string }{
		{"render_video", "/renders", "Queue video rendering on the user's local Docker API and scene renderer. Encoding uses the user's hardware without machinal credits. Pending provider actions may charge ONLY the user's OpenRouter account and require explicit source/spending consent. Prefer resolved assets. Pending scene.generate/scene.edit are rejected: the current client writes Svelte and calls compile_scene. For narration use measured timing before visuals. Retain the idempotencyKey and resolved recipe; wait_for_job on the SAME job until terminal status, then deliver its actual output."},
		{"generate_assets", "/compositions/compile-and-generate", "Queue approved image.generate, speech.generate and captions.generate/transcription without final encoding. Uses only this installation's user-configured OpenRouter key and may charge that user's provider account, never machinal credits. Obtain source/spending consent. Use speech and requested captions in a timing-first pass, then get_job_result for measured cues before visuals. New speech requires an explicitly selected or delegated model; read list_speech_models and get_speech_model. The current client authors Svelte scenes through compile_scene, without server-model fallback. For overly simplistic SVG/CSS subjects, consider approved image.generate artwork; attachment limits are per scene, not per video. Preserve successful voice, captions and images; reuse the returned recipeYaml and retain job IDs and idempotency keys."},
	} {
		hints := annotations(false, false, true)
		openWorld := true
		hints.OpenWorldHint = &openWorld
		mcp.AddTool(server, &mcp.Tool{Name: tool.name, Description: tool.description + captionPreservationToolHint, Annotations: hints},
			func(ctx context.Context, req *mcp.CallToolRequest, input renderInput) (*mcp.CallToolResult, Output, error) {
				if err := requireMediaApproval(input.UserApproved); err != nil {
					return nil, Output{}, err
				}
				if err := validateIdempotencyKey(input.IdempotencyKey); err != nil {
					return nil, Output{}, err
				}
				composition, err := refs.resolve(ctx, req, call, input.ProjectID, input.SourceJobID, input.Composition, input.RecipeRef)
				if err != nil {
					return nil, Output{}, err
				}
				if input.ExpectedCompositionVersion != "" && input.ExpectedCompositionVersion != compositionVersion(composition) {
					return nil, Output{}, errors.New("The YAML changed since review; revalidate/reconcile the exact final recipe before submitting paid work.")
				}
				if err := checkCaptionVersion(composition, input.ExpectedCaptionVersion); err != nil {
					return nil, Output{}, err
				}
				operation, err := compositionRequest(input.ProjectID, composition, tool.suffix, input.IdempotencyKey)
				if err != nil {
					return nil, Output{}, err
				}
				return invoke(ctx, req, call, operation)
			})
	}
}
