package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/compositions"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const maxRecipePatchOperations = 32

type patchRecipeInput struct {
	ProjectID                  string                 `json:"projectId"`
	BaseRecipeRef              string                 `json:"baseRecipeRef,omitempty" jsonschema:"Reuse an existing server-side recipeRef from get_job_result, validate_recipe, compile_recipe or patch_recipe in this project instead of resending full YAML."`
	SourceJobID                string                 `json:"sourceJobId,omitempty" jsonschema:"Resolve the base YAML directly from an owned completed/failed generation job in this project instead of resending full YAML."`
	Composition                string                 `json:"composition,omitempty" jsonschema:"Optional inline base YAML when no baseRecipeRef or sourceJobId is available."`
	ExpectedCompositionVersion string                 `json:"expectedCompositionVersion,omitempty" jsonschema:"Optional optimistic guard: base YAML compositionVersion must match before patching."`
	ExpectedCaptionVersion     string                 `json:"expectedCaptionVersion,omitempty" jsonschema:"Optional exact caption preservation guard checked against the base recipe before patching."`
	CaptionEditsApproved       bool                   `json:"captionEditsApproved,omitempty" jsonschema:"True only after the user explicitly authorized exact caption text replacements in applyCaptionTextEdits operations."`
	SkipValidate               bool                   `json:"skipValidate,omitempty" jsonschema:"Skip free /compositions/validate after patching. Default false: validates immediately and returns diagnostics, requirements and planSummary."`
	IncludeYaml                bool                   `json:"includeYaml,omitempty" jsonschema:"Include the full patched recipeYaml in the response. Default false: returns a compact summary and reusable recipeRef without echoing large YAML."`
	Operations                 []recipePatchOperation `json:"operations" jsonschema:"Ordered list of 1-32 structured recipe mutations: upsertAssets, replaceClipAsset, upsertTracks, setEffects, setTransitions, setOutput or applyCaptionTextEdits."`
}

type recipePatchOperation struct {
	Op               string                 `json:"op" jsonschema:"Mutation operation: upsertAssets, replaceClipAsset, upsertTracks, setEffects, setTransitions, setOutput or applyCaptionTextEdits."`
	Assets           []document.Asset       `json:"assets,omitempty" jsonschema:"For upsertAssets: assets to upsert by id (replaces matching id in-place or appends)."`
	ClipID           string                 `json:"clipId,omitempty" jsonschema:"For replaceClipAsset: target clip ID to update."`
	TrackID          string                 `json:"trackId,omitempty" jsonschema:"For replaceClipAsset: optional track ID to disambiguate clipId."`
	AssetID          string                 `json:"assetId,omitempty" jsonschema:"For replaceClipAsset: replacement asset ID."`
	Start            *document.Time         `json:"start,omitempty" jsonschema:"For replaceClipAsset: optional replacement timeline start in seconds or duration string."`
	InPoint          *document.Time         `json:"inPoint,omitempty" jsonschema:"For replaceClipAsset: optional replacement source inPoint."`
	OutPoint         *document.Time         `json:"outPoint,omitempty" jsonschema:"For replaceClipAsset: optional replacement source outPoint."`
	Look             *string                `json:"look,omitempty" jsonschema:"For replaceClipAsset: optional replacement look preset ID."`
	Motion           *string                `json:"motion,omitempty" jsonschema:"For replaceClipAsset: optional replacement motion preset ID."`
	Volume           *float64               `json:"volume,omitempty" jsonschema:"For replaceClipAsset: optional replacement audio volume (0-200)."`
	Tracks           []document.Track       `json:"tracks,omitempty" jsonschema:"For upsertTracks: tracks to upsert by id (replaces matching id in-place or appends, preserving untouched tracks such as narration)."`
	Effects          []document.EffectBlock `json:"effects,omitempty" jsonschema:"For setEffects: effect blocks to set or merge."`
	Transitions      []document.Transition  `json:"transitions,omitempty" jsonschema:"For setTransitions: transitions to set or merge."`
	Merge            bool                   `json:"merge,omitempty" jsonschema:"For setEffects/setTransitions: when true, upserts entries by id instead of replacing the entire array."`
	Output           *document.Output       `json:"output,omitempty" jsonschema:"For setOutput: non-zero output fields (aspect, fit, resolution, fps, format, quality) to update."`
	CaptionTextEdits []captionTextEdit      `json:"captionTextEdits,omitempty" jsonschema:"For applyCaptionTextEdits: explicitly approved exact text/word replacements preserving all timings, IDs, grouping and styling."`
}

func patchRecipeToolSchema() *jsonschema.Schema {
	schema, err := jsonschema.For[patchRecipeInput](nil)
	if err != nil {
		panic("invalid patch_recipe input schema: " + err.Error())
	}
	inlineSchemaDefs(schema, schema.Defs)
	schema.Defs = nil
	if ops := schema.Properties["operations"]; ops != nil && ops.Items != nil {
		opSchema := ops.Items
		if op := opSchema.Properties["op"]; op != nil {
			op.Enum = []any{
				"upsertAssets",
				"replaceClipAsset",
				"upsertTracks",
				"setEffects",
				"setTransitions",
				"setOutput",
				"applyCaptionTextEdits",
			}
		}
		for _, field := range []string{"start", "inPoint", "outPoint"} {
			setTimePropertySchema(opSchema.Properties[field])
		}
		if assets := opSchema.Properties["assets"]; assets != nil && assets.Items != nil {
			assets.Items.Required = []string{"id", "file", "kind"}
			if kind := assets.Items.Properties["kind"]; kind != nil {
				kind.Enum = []any{"video", "image", "audio"}
			}
			setTimePropertySchema(assets.Items.Properties["duration"])
		}
		if tracks := opSchema.Properties["tracks"]; tracks != nil && tracks.Items != nil {
			tracks.Items.Required = []string{"id", "type"}
			if clips := tracks.Items.Properties["clips"]; clips != nil && clips.Items != nil {
				clipSchema := clips.Items
				clipSchema.Required = []string{"id", "assetId"}
				for _, field := range []string{"start", "inPoint", "outPoint", "fadeIn", "fadeOut"} {
					setTimePropertySchema(clipSchema.Properties[field])
				}
				if tr := clipSchema.Properties["transform"]; tr != nil {
					tr.Required = nil
				}
				if kfs := clipSchema.Properties["transformKeyframes"]; kfs != nil && kfs.Items != nil {
					kfs.Items.Required = []string{"time"}
					setTimePropertySchema(kfs.Items.Properties["time"])
					if tr := kfs.Items.Properties["transform"]; tr != nil {
						tr.Required = nil
					}
				}
			}
		}
		if effects := opSchema.Properties["effects"]; effects != nil && effects.Items != nil {
			effectSchema := effects.Items
			effectSchema.Required = []string{"id", "trackId", "preset"}
			setTimePropertySchema(effectSchema.Properties["start"])
			setTimePropertySchema(effectSchema.Properties["duration"])
			if ramp := effectSchema.Properties["ramp"]; ramp != nil {
				ramp.Required = nil
			}
		}
		if transitions := opSchema.Properties["transitions"]; transitions != nil && transitions.Items != nil {
			trSchema := transitions.Items
			trSchema.Required = []string{"id", "trackId", "leftClipId", "rightClipId", "preset"}
			setTimePropertySchema(trSchema.Properties["duration"])
		}
		if output := opSchema.Properties["output"]; output != nil {
			output.Required = nil
		}
	}
	return schema
}

func inlineSchemaDefs(schema *jsonschema.Schema, definitions map[string]*jsonschema.Schema) {
	if schema == nil {
		return
	}
	if name, ok := strings.CutPrefix(schema.Ref, "#/$defs/"); ok && definitions[name] != nil {
		*schema = *definitions[name].CloneSchemas()
	}
	for _, property := range schema.Properties {
		inlineSchemaDefs(property, definitions)
	}
	inlineSchemaDefs(schema.Items, definitions)
}

func setTimePropertySchema(schema *jsonschema.Schema) {
	if schema == nil {
		return
	}
	nullable := false
	for _, t := range schema.Types {
		if t == "null" {
			nullable = true
			break
		}
	}
	schema.Type = ""
	if nullable {
		schema.Types = []string{"null", "number", "string"}
	} else {
		schema.Types = []string{"number", "string"}
	}
}

func registerRecipePatchTool(server *mcp.Server, call Caller, refs *recipeRefs) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "patch_recipe",
		InputSchema: patchRecipeToolSchema(),
		Description: "Apply structured mutations (upsertAssets, replaceClipAsset, upsertTracks, setEffects, setTransitions, setOutput, applyCaptionTextEdits) directly on a server-side baseRecipeRef or sourceJobId without resending or echoing full YAML. Preserves all untouched captions/tracks verbatim, validates the patched recipe for free (unless skipValidate=true) and returns a new reusable recipeRef for compile_recipe, render_preview or render_video. No media use or paid work." + captionPreservationToolHint,
		Annotations: annotations(true, false, true),
	}, func(ctx context.Context, req *mcp.CallToolRequest, input patchRecipeInput) (*mcp.CallToolResult, Output, error) {
		if len(input.Operations) == 0 || len(input.Operations) > maxRecipePatchOperations {
			return nil, Output{}, fmt.Errorf("Provide 1-%d patch operations.", maxRecipePatchOperations)
		}
		baseYAML, err := refs.resolve(ctx, req, call, input.ProjectID, input.SourceJobID, input.Composition, input.BaseRecipeRef)
		if err != nil {
			return nil, Output{}, err
		}
		if input.ExpectedCompositionVersion != "" && input.ExpectedCompositionVersion != compositionVersion(baseYAML) {
			return nil, Output{}, errors.New("Base recipe changed since expectedCompositionVersion; re-read or pass the matching baseRecipeRef.")
		}
		if err := checkCaptionVersion(baseYAML, input.ExpectedCaptionVersion); err != nil {
			return nil, Output{}, err
		}
		parsed, _, err := compositions.ParseProject([]byte(baseYAML))
		if err != nil {
			return nil, Output{}, fmt.Errorf("Cannot patch invalid base recipe: %w", err)
		}
		baseCaptionVersion := captionVersion(&parsed.Document)

		applied, captionEdits, err := applyRecipePatchOperations(&parsed, input.Operations, input.CaptionEditsApproved)
		if err != nil {
			return nil, Output{}, err
		}
		patchedYAML, err := encodeProjectYAML(parsed)
		if err != nil {
			return nil, Output{}, err
		}
		reloaded, _, err := compositions.ParseProject([]byte(patchedYAML))
		if err != nil {
			return nil, Output{}, fmt.Errorf("Patched recipe failed schema parsing: %w", err)
		}

		var captionReview map[string]any
		if len(captionEdits) > 0 {
			captionReview, err = compareCaptionBaseline(patchedYAML, baseYAML, captionEdits, input.CaptionEditsApproved)
			if err != nil {
				return nil, Output{}, err
			}
		} else if baseCaptionVersion != "" && captionVersion(&reloaded.Document) != baseCaptionVersion {
			return nil, Output{}, errors.New("Internal caption preservation check failed: patch altered text entries without applyCaptionTextEdits.")
		}

		ref := refs.save(req, input.ProjectID, patchedYAML)
		if input.SkipValidate {
			data := map[string]any{
				"detail":             "summary",
				"compositionVersion": compositionVersion(patchedYAML),
				"appliedOperations":  applied,
				"validated":          false,
			}
			if ref != "" {
				data["recipeRef"] = ref
			}
			if v := captionVersion(&reloaded.Document); v != "" {
				data["captionVersion"] = v
			}
			if captionReview != nil {
				data["captionReview"] = captionReview
			}
			if input.IncludeYaml {
				data["recipeYaml"] = patchedYAML
			}
			return &mcp.CallToolResult{}, Output{StatusCode: http.StatusOK, Data: data}, nil
		}

		operation, err := compositionRequest(input.ProjectID, patchedYAML, "/compositions/validate", "")
		if err != nil {
			return nil, Output{}, err
		}
		result, output, err := invoke(ctx, req, call, operation)
		if err != nil {
			return result, output, err
		}
		output = attachCompositionCheckpoint(output)
		output = presentComposition(output, patchedYAML, false, &reloaded.Document)
		if fields, ok := output.Data.(map[string]any); ok {
			fields["appliedOperations"] = applied
			fields["validated"] = true
			if captionReview != nil {
				fields["captionReview"] = captionReview
			}
			if ref != "" {
				fields["recipeRef"] = ref
			}
			if input.IncludeYaml {
				fields["recipeYaml"] = patchedYAML
			}
		}
		return result, output, nil
	})
}

func applyRecipePatchOperations(project *compiler.Input, operations []recipePatchOperation, captionEditsApproved bool) ([]string, []captionTextEdit, error) {
	applied := make([]string, 0, len(operations))
	var allCaptionEdits []captionTextEdit

	for index, op := range operations {
		switch op.Op {
		case "upsertAssets":
			if len(op.Assets) == 0 {
				return nil, nil, fmt.Errorf("operations[%d]: upsertAssets requires at least one asset", index)
			}
			for _, asset := range op.Assets {
				if strings.TrimSpace(asset.ID) == "" || strings.TrimSpace(asset.File) == "" || strings.TrimSpace(asset.Kind) == "" {
					return nil, nil, fmt.Errorf("operations[%d]: each asset requires non-empty id, file and kind", index)
				}
				replaced := false
				for i := range project.Assets {
					if project.Assets[i].ID == asset.ID {
						project.Assets[i] = asset
						replaced = true
						break
					}
				}
				if !replaced {
					project.Assets = append(project.Assets, asset)
				}
			}
			applied = append(applied, fmt.Sprintf("upsertAssets(%d)", len(op.Assets)))

		case "replaceClipAsset":
			if strings.TrimSpace(op.ClipID) == "" || strings.TrimSpace(op.AssetID) == "" {
				return nil, nil, fmt.Errorf("operations[%d]: replaceClipAsset requires clipId and assetId", index)
			}
			matches := 0
			var target *document.Clip
			for ti := range project.Document.Tracks {
				if op.TrackID != "" && project.Document.Tracks[ti].ID != op.TrackID {
					continue
				}
				for ci := range project.Document.Tracks[ti].Clips {
					if project.Document.Tracks[ti].Clips[ci].ID == op.ClipID {
						matches++
						target = &project.Document.Tracks[ti].Clips[ci]
					}
				}
			}
			if matches == 0 {
				return nil, nil, fmt.Errorf("operations[%d]: clipId %q not found", index, op.ClipID)
			}
			if matches > 1 {
				return nil, nil, fmt.Errorf("operations[%d]: clipId %q matched %d tracks; specify trackId", index, op.ClipID, matches)
			}
			target.AssetID = op.AssetID
			if op.Start != nil {
				target.Start = *op.Start
			}
			if op.InPoint != nil {
				target.InPoint = *op.InPoint
			}
			if op.OutPoint != nil {
				target.OutPoint = *op.OutPoint
			}
			if op.Look != nil {
				target.Look = *op.Look
			}
			if op.Motion != nil {
				target.Motion = *op.Motion
			}
			if op.Volume != nil {
				target.Volume = *op.Volume
			}
			applied = append(applied, fmt.Sprintf("replaceClipAsset(%s->%s)", op.ClipID, op.AssetID))

		case "upsertTracks":
			if len(op.Tracks) == 0 {
				return nil, nil, fmt.Errorf("operations[%d]: upsertTracks requires at least one track", index)
			}
			for _, track := range op.Tracks {
				if strings.TrimSpace(track.ID) == "" || strings.TrimSpace(track.Type) == "" {
					return nil, nil, fmt.Errorf("operations[%d]: each track requires non-empty id and type", index)
				}
				if track.Clips == nil {
					track.Clips = []document.Clip{}
				}
				replaced := false
				for i := range project.Document.Tracks {
					if project.Document.Tracks[i].ID == track.ID {
						project.Document.Tracks[i] = track
						replaced = true
						break
					}
				}
				if !replaced {
					project.Document.Tracks = append(project.Document.Tracks, track)
				}
			}
			applied = append(applied, fmt.Sprintf("upsertTracks(%d)", len(op.Tracks)))

		case "setEffects":
			blocks := make([]document.EffectBlock, len(op.Effects))
			for i, block := range op.Effects {
				if block.Params == nil {
					block.Params = map[string]float64{}
				}
				blocks[i] = block
			}
			if !op.Merge {
				project.Document.Effects = blocks
			} else {
				for _, block := range blocks {
					if strings.TrimSpace(block.ID) == "" {
						return nil, nil, fmt.Errorf("operations[%d]: merge setEffects requires non-empty effect id", index)
					}
					replaced := false
					for i := range project.Document.Effects {
						if project.Document.Effects[i].ID == block.ID {
							project.Document.Effects[i] = block
							replaced = true
							break
						}
					}
					if !replaced {
						project.Document.Effects = append(project.Document.Effects, block)
					}
				}
			}
			applied = append(applied, fmt.Sprintf("setEffects(%d)", len(op.Effects)))

		case "setTransitions":
			if !op.Merge {
				project.Document.Transitions = append([]document.Transition(nil), op.Transitions...)
			} else {
				for _, tr := range op.Transitions {
					if strings.TrimSpace(tr.ID) == "" {
						return nil, nil, fmt.Errorf("operations[%d]: merge setTransitions requires non-empty transition id", index)
					}
					replaced := false
					for i := range project.Document.Transitions {
						if project.Document.Transitions[i].ID == tr.ID {
							project.Document.Transitions[i] = tr
							replaced = true
							break
						}
					}
					if !replaced {
						project.Document.Transitions = append(project.Document.Transitions, tr)
					}
				}
			}
			applied = append(applied, fmt.Sprintf("setTransitions(%d)", len(op.Transitions)))

		case "setOutput":
			if op.Output == nil {
				return nil, nil, fmt.Errorf("operations[%d]: setOutput requires output fields", index)
			}
			if op.Output.Aspect != "" {
				project.Document.Output.Aspect = op.Output.Aspect
			}
			if op.Output.Fit != "" {
				project.Document.Output.Fit = op.Output.Fit
			}
			if op.Output.Resolution != "" {
				project.Document.Output.Resolution = op.Output.Resolution
			}
			if op.Output.FPS != 0 {
				project.Document.Output.FPS = op.Output.FPS
			}
			if op.Output.Format != "" {
				project.Document.Output.Format = op.Output.Format
			}
			if op.Output.Quality != "" {
				project.Document.Output.Quality = op.Output.Quality
			}
			applied = append(applied, "setOutput")

		case "applyCaptionTextEdits":
			if len(op.CaptionTextEdits) == 0 {
				return nil, nil, fmt.Errorf("operations[%d]: applyCaptionTextEdits requires at least one edit", index)
			}
			if !captionEditsApproved {
				return nil, nil, errors.New("applyCaptionTextEdits requires captionEditsApproved=true after explicit user approval.")
			}
			if len(allCaptionEdits)+len(op.CaptionTextEdits) > maxCaptionTextEdits {
				return nil, nil, fmt.Errorf("Use at most %d explicitly approved captionTextEdits.", maxCaptionTextEdits)
			}
			if err := applyCaptionTextEditsToDocument(&project.Document, op.CaptionTextEdits); err != nil {
				return nil, nil, err
			}
			allCaptionEdits = append(allCaptionEdits, op.CaptionTextEdits...)
			applied = append(applied, fmt.Sprintf("applyCaptionTextEdits(%d)", len(op.CaptionTextEdits)))

		default:
			return nil, nil, fmt.Errorf("operations[%d]: unsupported op %q", index, op.Op)
		}
	}
	return applied, allCaptionEdits, nil
}

// encodeProjectYAML converts the typed compiler.Input through JSON so custom
// MarshalJSON implementations (such as document.Time seconds formatting) match
// the exact canonical YAML shape produced by get_job_result.
func encodeProjectYAML(project compiler.Input) (string, error) {
	project.Document.Revision = ""
	bindings := project.Bindings
	if bindings == nil {
		bindings = document.Bindings{}
	}
	assets := project.Assets
	if assets == nil {
		assets = []document.Asset{}
	}
	rawJSON, err := json.Marshal(map[string]any{
		"document": project.Document,
		"bindings": bindings,
		"assets":   assets,
	})
	if err != nil {
		return "", fmt.Errorf("encode patched project: %w", err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(rawJSON, &envelope); err != nil {
		return "", fmt.Errorf("decode patched project envelope: %w", err)
	}
	if docMap, ok := envelope["document"].(map[string]any); ok {
		delete(docMap, "revision")
	}
	return encodeRecipeYAML(envelope)
}
