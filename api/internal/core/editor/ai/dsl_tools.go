package ai

import (
	"encoding/json"
	"fmt"
	"sort"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/integrations/openrouter"
)

// Focused DSL tools for the version-1 edit document. The previous single
// patch_document tool forced the model to guess dot paths and full Clip JSON,
// producing "document.mode: path does not exist" and
// "tracks[0].between: unknown field". These tools expose the DSL sections
// with strict shapes instead: the model only sends DSL fragments, the server
// merges them into the authoritative document and compiles.

const (
	dslAssembleToolName = "dsl_assemble"
	dslTracksToolName   = "dsl_tracks"
	dslTweakToolName    = "dsl_tweak"
	dslPatchToolName    = "patch_document"
)

func dslTimeSchema() map[string]any {
	return map[string]any{"oneOf": []any{
		map[string]any{"type": "number", "minimum": 0},
		map[string]any{"type": "string", "pattern": `^\d+(\.\d+)?(ms|s)$`},
	}}
}

func dslObject(required []string, properties map[string]any) map[string]any {
	schema := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties":           properties,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func dslEnum(values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}

func dslAssetEnum(assetIDs []string) map[string]any {
	if len(assetIDs) == 0 {
		return map[string]any{"type": "string", "minLength": 1}
	}
	return dslEnum(assetIDs...)
}

func dslTransformSchema() map[string]any {
	fields := map[string]any{
		"zoomX":     map[string]any{"type": "number", "minimum": 0.01, "maximum": 40},
		"zoomY":     map[string]any{"type": "number", "minimum": 0.01, "maximum": 40},
		"linkZoom":  map[string]any{"type": "boolean"},
		"positionX": map[string]any{"type": "number", "minimum": -100, "maximum": 100},
		"positionY": map[string]any{"type": "number", "minimum": -100, "maximum": 100},
		"rotation":  map[string]any{"type": "number", "minimum": -180, "maximum": 180},
		"anchorX":   map[string]any{"type": "number", "minimum": 0, "maximum": 1},
		"anchorY":   map[string]any{"type": "number", "minimum": 0, "maximum": 1},
		"pitch":     map[string]any{"type": "number", "minimum": -90, "maximum": 90},
		"yaw":       map[string]any{"type": "number", "minimum": -90, "maximum": 90},
		"flipH":     map[string]any{"type": "boolean"},
		"flipV":     map[string]any{"type": "boolean"},
	}
	props := make(map[string]any, len(fields)+1)
	for key, value := range fields {
		props[key] = value
	}
	inner := make(map[string]any, len(fields))
	for key, value := range fields {
		inner[key] = value
	}
	props["keyframes"] = map[string]any{
		"type": "array", "maxItems": 32,
		"items": dslObject([]string{"time", "transform"}, map[string]any{
			"time":      dslTimeSchema(),
			"transform": dslObject(nil, inner),
		}),
	}
	return dslObject(nil, props)
}

// dslClipSchema is the exact explicit-track Clip shape. Field names matter:
// assetId (not asset), inPoint/outPoint (source bounds, not from/duration),
// start (timeline position). Transitions live in the top-level transitions
// array, never inside a clip.
func dslClipSchema(assetIDs, looks, motions []string) map[string]any {
	props := map[string]any{
		"id":           map[string]any{"type": "string", "minLength": 1, "maxLength": 128},
		"assetId":      dslAssetEnum(assetIDs),
		"start":        dslTimeSchema(),
		"inPoint":      dslTimeSchema(),
		"outPoint":     dslTimeSchema(),
		"playbackRate": map[string]any{"type": "number", "minimum": 0.25, "maximum": 4},
		"volume":       map[string]any{"type": "number", "minimum": 0, "maximum": 200},
		"opacity":      map[string]any{"type": "number", "minimum": 0, "maximum": 1},
		"fadeIn":       dslTimeSchema(),
		"fadeOut":      dslTimeSchema(),
		"transform":    dslTransformSchema(),
		"transformKeyframes": map[string]any{
			"type": "array", "maxItems": 32,
			"items": dslObject([]string{"time", "transform"}, map[string]any{
				"time":      dslTimeSchema(),
				"transform": dslTransformSchema(),
			}),
		},
		"layerEntrance": dslEnum("none", "fade", "focus", "lift", "drift-left", "drift-right"),
		"layerExit":     dslEnum("none", "fade", "zoom-out", "sink", "drift-left", "drift-right"),
	}
	if len(looks) > 0 {
		props["look"] = dslEnum(looks...)
	} else {
		props["look"] = map[string]any{"type": "string"}
	}
	if len(motions) > 0 {
		props["motion"] = dslEnum(motions...)
	} else {
		props["motion"] = map[string]any{"type": "string"}
	}
	return dslObject([]string{"id", "assetId", "start", "inPoint", "outPoint"}, props)
}

func dslTrackSchema(assetIDs, looks, motions []string) map[string]any {
	return dslObject([]string{"id", "type", "clips"}, map[string]any{
		"id":     map[string]any{"type": "string", "minLength": 1},
		"name":   map[string]any{"type": "string"},
		"type":   dslEnum("video", "audio"),
		"muted":  map[string]any{"type": "boolean"},
		"hidden": map[string]any{"type": "boolean"},
		"locked": map[string]any{"type": "boolean"},
		"clips": map[string]any{
			"type": "array", "maxItems": 500,
			"items": dslClipSchema(assetIDs, looks, motions),
		},
	})
}

func dslTransitionSchema(transitions []string) map[string]any {
	preset := map[string]any{"type": "string", "minLength": 1}
	if len(transitions) > 0 {
		preset = dslEnum(transitions...)
	}
	return dslObject([]string{"id", "trackId", "leftClipId", "rightClipId", "preset", "duration"}, map[string]any{
		"id":          map[string]any{"type": "string", "minLength": 1},
		"trackId":     map[string]any{"type": "string", "minLength": 1},
		"leftClipId":  map[string]any{"type": "string", "minLength": 1},
		"rightClipId": map[string]any{"type": "string", "minLength": 1},
		"preset":      preset,
		"duration":    dslTimeSchema(),
	})
}

func dslTakeSchema() map[string]any {
	return dslObject([]string{"from", "duration"}, map[string]any{
		"from":     dslTimeSchema(),
		"duration": dslTimeSchema(),
	})
}

func dslTreatmentSchema(looks, motions []string) map[string]any {
	props := map[string]any{
		"take":         dslTakeSchema(),
		"source_audio": dslEnum("keep", "remove"),
		"rate":         map[string]any{"type": "number", "minimum": 0.25, "maximum": 4},
		"volume":       map[string]any{"type": "number", "minimum": 0, "maximum": 200},
	}
	if len(looks) > 0 {
		props["look"] = dslEnum(looks...)
	} else {
		props["look"] = map[string]any{"type": "string"}
	}
	if len(motions) > 0 {
		props["motion"] = dslEnum(motions...)
	} else {
		props["motion"] = map[string]any{"type": "string"}
	}
	return dslObject([]string{"take", "source_audio"}, props)
}

func dslSequenceSchema(looks, motions, transitions []string) map[string]any {
	betweenProps := map[string]any{"duration": dslTimeSchema(), "policy": dslEnum("error", "shrink")}
	if len(transitions) > 0 {
		betweenProps["preset"] = dslEnum(transitions...)
	} else {
		betweenProps["preset"] = map[string]any{"type": "string", "minLength": 1}
	}
	return dslObject([]string{"use", "each"}, map[string]any{
		"use":     map[string]any{"type": "string", "minLength": 1},
		"order":   dslEnum("input", "reverse"),
		"each":    dslTreatmentSchema(looks, motions),
		"between": dslObject([]string{"preset", "duration"}, betweenProps),
	})
}

func dslOverrideSchema(looks, motions []string) map[string]any {
	props := map[string]any{
		"target":   map[string]any{"type": "string", "minLength": 1},
		"start":    dslTimeSchema(),
		"from":     dslTimeSchema(),
		"duration": dslTimeSchema(),
		"rate":     map[string]any{"type": "number", "minimum": 0.25, "maximum": 4},
		"volume":   map[string]any{"type": "number", "minimum": 0, "maximum": 200},
		"opacity":  map[string]any{"type": "number", "minimum": 0, "maximum": 1},
		"fadeIn":   dslTimeSchema(),
		"fadeOut":  dslTimeSchema(),
		"transform": dslTransformSchema(),
		"keyframes": map[string]any{
			"type": "array", "maxItems": 32,
			"items": dslObject([]string{"time", "transform"}, map[string]any{
				"time":      dslTimeSchema(),
				"transform": dslTransformSchema(),
			}),
		},
	}
	if len(looks) > 0 {
		props["look"] = dslEnum(looks...)
	} else {
		props["look"] = map[string]any{"type": "string"}
	}
	if len(motions) > 0 {
		props["motion"] = dslEnum(motions...)
	} else {
		props["motion"] = map[string]any{"type": "string"}
	}
	return dslObject([]string{"target"}, props)
}

func dslSelectorSchema() map[string]any {
	return dslObject(nil, map[string]any{
		"kind":     dslEnum("", "clip", "video", "audio", "image", "track", "transition"),
		"ids":      map[string]any{"type": "array", "items": map[string]any{"type": "string", "minLength": 1}},
		"trackId":  map[string]any{"type": "string"},
		"position": dslEnum("", "all", "first", "last", "nth"),
		"index":    map[string]any{"type": "integer", "minimum": 1},
		"selected": map[string]any{"type": "boolean"},
	})
}

func dslCommandSchema(looks, motions, transitions []string) map[string]any {
	presets := append(append([]string{}, looks...), motions...)
	presets = append(presets, transitions...)
	preset := map[string]any{"type": "string"}
	if len(presets) > 0 {
		preset = dslEnum(presets...)
	}
	return dslObject([]string{"type", "target"}, map[string]any{
		"type":     dslEnum(compiler.SupportedCommands()...),
		"target":   dslSelectorSchema(),
		"patch":    dslOverrideSchema(looks, motions),
		"track":    dslTrackSchema(nil, looks, motions),
		"trackId":  map[string]any{"type": "string"},
		"value":    map[string]any{"type": "boolean"},
		"time":     dslTimeSchema(),
		"preset":   preset,
		"duration": dslTimeSchema(),
		"closeGap": map[string]any{"type": "boolean"},
	})
}

func sortedAssetIDs(assets []document.Asset) []string {
	ids := make([]string, 0, len(assets))
	for _, asset := range assets {
		if asset.ID != "" {
			ids = append(ids, asset.ID)
		}
	}
	sort.Strings(ids)
	return ids
}

func catalogIDs(engine compiler.Compiler) (looks, motions, transitions []string) {
	for _, item := range engine.Catalog.Looks {
		looks = append(looks, item.ID)
	}
	for _, item := range engine.Catalog.Motions {
		motions = append(motions, item.ID)
	}
	for _, item := range engine.Catalog.Transitions {
		transitions = append(transitions, item.ID)
	}
	sort.Strings(looks)
	sort.Strings(motions)
	sort.Strings(transitions)
	return looks, motions, transitions
}

func dslAssembleTool(assetIDs, looks, motions, transitions []string) openrouter.Tool {
	bindings := map[string]any{
		"type": "object", "minProperties": 1,
		"additionalProperties": map[string]any{
			"type": "array", "minItems": 1, "maxItems": 500,
			"items": dslAssetEnum(assetIDs),
		},
	}
	inputs := map[string]any{
		"type": "object", "minProperties": 1,
		"additionalProperties": dslObject([]string{"kind"}, map[string]any{
			"kind":     dslEnum("video", "audio", "image"),
			"multiple": map[string]any{"type": "boolean"},
			"optional": map[string]any{"type": "boolean"},
		}),
	}
	audio := map[string]any{
		"type": "array", "maxItems": 32,
		"items": dslObject([]string{"id", "use"}, map[string]any{
			"id":       map[string]any{"type": "string", "minLength": 1},
			"use":      map[string]any{"type": "string", "minLength": 1},
			"start":    dslTimeSchema(),
			"from":     dslTimeSchema(),
			"duration": dslTimeSchema(),
			"fit":      dslEnum("sequence", "source"),
			"repeat":   map[string]any{"type": "boolean"},
			"volume":   map[string]any{"type": "number", "minimum": 0, "maximum": 200},
		}),
	}
	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        dslAssembleToolName,
			Description: "Assemble clips from Media Bin assets. Use for empty timelines or 'adauga videourile': declare inputs/bindings/sequence and Go computes positions and overlaps. take.from is SOURCE time, take.duration is TIMELINE time.",
			Parameters: dslObject(nil, map[string]any{
				"inputs":   inputs,
				"bindings": bindings,
				"sequence": dslSequenceSchema(looks, motions, transitions),
				"audio":    audio,
			}),
		},
	}
}

func dslTracksTool(assetIDs, looks, motions, transitions []string) openrouter.Tool {
	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        dslTracksToolName,
			Description: "Replace the explicit timeline. Use when the document already has tracks with clips. Clips need id, assetId, start (timeline), inPoint/outPoint (source bounds). Transitions go in the top-level transitions array, never inside a clip. Replace whole arrays to add/remove.",
			Parameters: dslObject(nil, map[string]any{
				"tracks": map[string]any{
					"type": "array", "maxItems": 32,
					"items": dslTrackSchema(assetIDs, looks, motions),
				},
				"transitions": map[string]any{
					"type": "array", "maxItems": 500,
					"items": dslTransitionSchema(transitions),
				},
			}),
		},
	}
}

func dslTweakTool(looks, motions, transitions []string) openrouter.Tool {
	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        dslTweakToolName,
			Description: "Tweak existing clips without resending the timeline: overrides (stable target clip ID with start/from/duration/rate/volume/opacity/fadeIn/fadeOut/look/motion/transform/keyframes) and commands (clip.move/trim/duration/speed, look.apply/remove, motion.apply, transform.set/reset, transition.set/duration/remove with selectors).",
			Parameters: dslObject(nil, map[string]any{
				"overrides": map[string]any{
					"type": "array", "maxItems": 100,
					"items": dslOverrideSchema(looks, motions),
				},
				"commands": map[string]any{
					"type": "array", "maxItems": 100,
					"items": dslCommandSchema(looks, motions, transitions),
				},
			}),
		},
	}
}

func dslPatchTool() openrouter.Tool {
	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        dslPatchToolName,
			Description: "Fallback for document sections without a dedicated tool (effects, texts, output, mode). Paths are dot paths relative to the document root, e.g. sequence.between.duration or tracks.0.clips. Never prefix with document. and never use brackets like tracks[0]. Replace a whole array to append/remove items.",
			Parameters: map[string]any{
				"type": "object", "additionalProperties": false, "required": []string{"changes"},
				"properties": map[string]any{"changes": map[string]any{"type": "array", "minItems": 1, "maxItems": 100,
					"items": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"path", "value"},
						"properties": map[string]any{"path": map[string]any{"type": "string"}, "value": map[string]any{}}}}},
			},
		},
	}
}

func buildDSLTools(input compiler.Input, engine compiler.Compiler) []openrouter.Tool {
	looks, motions, transitions := catalogIDs(engine)
	assetIDs := sortedAssetIDs(input.Assets)
	return []openrouter.Tool{
		dslAssembleTool(assetIDs, looks, motions, transitions),
		dslTracksTool(assetIDs, looks, motions, transitions),
		dslTweakTool(looks, motions, transitions),
		dslPatchTool(),
	}
}

// dslFragment holds one merged model response: raw section payloads decoded
// strictly so unknown fields (asset instead of assetId, transition inside a
// clip, between on a track) fail with a precise repair error instead of a
// silent bad compile.
type dslFragment struct {
	inputs      *map[string]document.Input
	bindings    *document.Bindings
	sequence    *document.Sequence
	audio       *[]document.Audio
	tracks      *[]document.Track
	transitions *[]document.Transition
	overrides   *[]document.Override
	commands    *[]document.Command
	patches     []document.Patch
	hasAssemble bool
	hasTracks   bool
	hasTweak    bool
}

func decodeDSLSection(raw json.RawMessage, target any, tool, section string) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	if err := document.DecodeJSON(raw, target); err != nil {
		return fmt.Errorf("tool %s section %s is invalid: %w", tool, section, err)
	}
	return nil
}

func mergeDSLCalls(response openrouter.ChatCompletionResponse) (dslFragment, error) {
	var merged dslFragment
	if len(response.Choices) == 0 {
		return merged, fmt.Errorf("OpenRouter returned no choices")
	}
	calls := response.Choices[0].Message.ToolCalls
	if len(calls) == 0 {
		return merged, fmt.Errorf("OpenRouter did not return any tool call")
	}
	for _, call := range calls {
		if call.ID == "" {
			return merged, fmt.Errorf("OpenRouter returned %s without a call ID", call.Function.Name)
		}
		var args map[string]json.RawMessage
		if err := document.DecodeJSON([]byte(call.Function.Arguments), &args); err != nil {
			return merged, fmt.Errorf("tool %s has invalid arguments: %w", call.Function.Name, err)
		}
		switch call.Function.Name {
		case dslAssembleToolName:
			merged.hasAssemble = true
			for key, raw := range args {
				switch key {
				case "inputs":
					var value map[string]document.Input
					if err := decodeDSLSection(raw, &value, call.Function.Name, key); err != nil {
						return merged, err
					}
					merged.inputs = &value
				case "bindings":
					var value document.Bindings
					if err := decodeDSLSection(raw, &value, call.Function.Name, key); err != nil {
						return merged, err
					}
					merged.bindings = &value
				case "sequence":
					var value document.Sequence
					if err := decodeDSLSection(raw, &value, call.Function.Name, key); err != nil {
						return merged, err
					}
					merged.sequence = &value
				case "audio":
					var value []document.Audio
					if err := decodeDSLSection(raw, &value, call.Function.Name, key); err != nil {
						return merged, err
					}
					merged.audio = &value
				default:
					return merged, fmt.Errorf("tool %s does not support field %q (use inputs, bindings, sequence, audio)", call.Function.Name, key)
				}
			}
		case dslTracksToolName:
			merged.hasTracks = true
			for key, raw := range args {
				switch key {
				case "tracks":
					var value []document.Track
					if err := decodeDSLSection(raw, &value, call.Function.Name, key); err != nil {
						return merged, err
					}
					merged.tracks = &value
				case "transitions":
					var value []document.Transition
					if err := decodeDSLSection(raw, &value, call.Function.Name, key); err != nil {
						return merged, err
					}
					merged.transitions = &value
				default:
					return merged, fmt.Errorf("tool %s does not support field %q (use tracks, transitions)", call.Function.Name, key)
				}
			}
		case dslTweakToolName:
			merged.hasTweak = true
			for key, raw := range args {
				switch key {
				case "overrides":
					var value []document.Override
					if err := decodeDSLSection(raw, &value, call.Function.Name, key); err != nil {
						return merged, err
					}
					merged.overrides = &value
				case "commands":
					var value []document.Command
					if err := decodeDSLSection(raw, &value, call.Function.Name, key); err != nil {
						return merged, err
					}
					merged.commands = &value
				default:
					return merged, fmt.Errorf("tool %s does not support field %q (use overrides, commands)", call.Function.Name, key)
				}
			}
		case dslPatchToolName:
			var patch struct {
				Changes []document.Patch `json:"changes"`
			}
			if err := document.DecodeJSON([]byte(call.Function.Arguments), &patch); err != nil {
				return merged, fmt.Errorf("tool %s has invalid arguments: %w", call.Function.Name, err)
			}
			if len(patch.Changes) == 0 {
				return merged, fmt.Errorf("tool %s needs at least one change", call.Function.Name)
			}
			merged.patches = append(merged.patches, patch.Changes...)
		default:
			return merged, fmt.Errorf("unsupported DSL tool %q", call.Function.Name)
		}
	}
	return merged, nil
}

// applyDSLFragment merges one model response into a working copy. Focused
// tools replace whole sections; patch_document applies normalized dot paths
// (bindings.* goes to bindings, everything else to the document).
func applyDSLFragment(input compiler.Input, fragment dslFragment) (compiler.Input, error) {
	working := input
	if fragment.inputs != nil {
		working.Document.Inputs = *fragment.inputs
	}
	if fragment.bindings != nil {
		working.Bindings = *fragment.bindings
	}
	if fragment.sequence != nil {
		working.Document.Sequence = fragment.sequence
	}
	if fragment.audio != nil {
		working.Document.Audio = *fragment.audio
	}
	if fragment.tracks != nil {
		working.Document.Tracks = *fragment.tracks
	}
	if fragment.transitions != nil {
		working.Document.Transitions = *fragment.transitions
	}
	if fragment.overrides != nil {
		working.Document.Overrides = *fragment.overrides
	}
	if fragment.commands != nil {
		working.Document.Commands = *fragment.commands
	}
	// Intent tools imply assemble: explicit tracks and sequences compile
	// together, while snapshot commands need modify (see below).
	if fragment.hasAssemble || fragment.hasTracks {
		working.Document.Mode = "assemble"
	}
	// Assembling alongside an empty placeholder track (the default
	// "sequence/video" on new timelines) collides with the assembled track
	// ID. Empty tracks carry no media, so drop the placeholders; non-empty
	// collisions stay errors for the repair turn.
	if fragment.hasAssemble && working.Document.Sequence != nil {
		instance := working.Document.InstanceID
		if instance == "" {
			instance = "sequence"
		}
		assembled := map[string]bool{instance + "/video": true, instance + "/source-audio": true}
		kept := working.Document.Tracks[:0]
		for _, track := range working.Document.Tracks {
			if len(track.Clips) == 0 && assembled[track.ID] {
				continue
			}
			kept = append(kept, track)
		}
		working.Document.Tracks = kept
	}
	for _, patch := range fragment.patches {
		normalized, err := document.NormalizePatchPath(patch.Path)
		if err != nil {
			return input, fmt.Errorf("%s: %w", patch.Path, err)
		}
		if normalized == "bindings" || len(normalized) > 9 && normalized[:9] == "bindings." {
			slot := ""
			if len(normalized) > 9 {
				slot = normalized[9:]
			}
			var value any
			if err := json.Unmarshal(patch.Value, &value); err != nil {
				return input, fmt.Errorf("%s: invalid patch value: %w", patch.Path, err)
			}
			if slot == "" {
				var bindings document.Bindings
				if err := document.DecodeJSON(patch.Value, &bindings); err != nil {
					return input, fmt.Errorf("%s: bindings must be an object of slot to asset-ID arrays: %w", patch.Path, err)
				}
				working.Bindings = bindings
				continue
			}
			var ids []string
			if err := document.DecodeJSON(patch.Value, &ids); err != nil {
				return input, fmt.Errorf("%s: bindings.%s must be an array of asset IDs: %w", patch.Path, slot, err)
			}
			if working.Bindings == nil {
				working.Bindings = document.Bindings{}
			}
			working.Bindings[slot] = ids
			continue
		}
		revised, err := document.ApplyPatches(working.Document, working.Document.Revision, []document.Patch{{Path: normalized, Value: patch.Value}})
		if err != nil {
			return input, err
		}
		working.Document = revised
	}
	// Pure tweak responses target the snapshot: switch to modify and drop the
	// explicit intent so "modify uses snapshot tracks" validates. Mixed
	// responses keep assemble and compile explicit + sequence + commands.
	if fragment.hasTweak && !fragment.hasAssemble && !fragment.hasTracks && len(fragment.patches) == 0 {
		working.Document.Mode = "modify"
		working.Document.Tracks = nil
		working.Document.Sequence = nil
		working.Document.Audio = nil
	}
	return working, nil
}
