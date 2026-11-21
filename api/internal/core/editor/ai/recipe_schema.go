package ai

import (
	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/integrations/openrouter"
)

func recipeTool(families []string, engine compiler.Compiler, analysis recipeAnalysis, instruction string) openrouter.Tool {
	has := func(f string) bool { return oneOf(f, families...) }
	looks, motions, transitions := catalogIDs(engine)
	all := document.Schema()["properties"].(map[string]any)
	props := map[string]any{"mode": dslEnum("modify", "assemble")}
	props["output"] = dslObject(nil, map[string]any{
		"aspect": dslEnum("landscape", "portrait", "classic"),
		"fit":    dslEnum(string(document.VideoFitContain), string(document.VideoFitCover)),
	})
	if has(familyCut) || has(familyTransition) || has(familyTransform) {
		montage := dslObject([]string{"target"}, map[string]any{"target": dslSelectorSchema(), "targetDuration": dslTimeSchema(), "tolerance": dslTimeSchema()})
		fields := montage["properties"].(map[string]any)
		if analysis.Requested && !hasExplicitSourceRanges(instruction) {
			montage["required"] = []string{}
			fields["target"] = dslObject([]string{"kind"}, map[string]any{"kind": dslEnum("video")})
			delete(fields, "targetDuration")
			delete(fields, "tolerance")
		} else if has(familyCut) {
			ranges := map[string]any{"type": "array", "maxItems": compiler.MaxMontageRanges, "items": dslObject([]string{"clipId", "from", "to"}, map[string]any{"clipId": map[string]any{"type": "string"}, "from": dslTimeSchema(), "to": dslTimeSchema(), "score": map[string]any{"type": "integer", "minimum": 1, "maximum": 100}})}
			fields["ranges"], fields["candidates"] = ranges, ranges
		}
		if has(familyTransition) {
			fields["between"] = dslObject([]string{"duration"}, map[string]any{"preset": dslEnum(transitions...), "random": map[string]any{"type": "boolean"}, "duration": dslTimeSchema(), "policy": dslEnum("error", "shrink")})
		}
		if has(familyTransform) {
			fields["motion"] = dslObject(nil, map[string]any{"preset": dslEnum(motions...), "random": map[string]any{"type": "boolean"}, "family": dslEnum("zoom")})
		}
		props["montage"] = montage
	}
	if has(familyCut) || has(familyTrim) || has(familyTransform) || has(familyPreset) || has(familyTransition) {
		commands := dslCommandSchema(looks, motions, transitions)
		fields := commands["properties"].(map[string]any)
		delete(fields, "track")
		props["commands"] = map[string]any{"type": "array", "maxItems": 32, "items": commands}
	}
	if has(familyPreset) || has(familyTransform) || has(familyEffect) {
		apply := map[string]any{}
		if has(familyPreset) {
			apply["look"] = dslEnum(looks...)
		}
		if has(familyTransform) {
			apply["motion"] = dslEnum(motions...)
		}
		if has(familyEffect) {
			apply["effect"] = all["rules"].(map[string]any)["items"].(map[string]any)["properties"].(map[string]any)["apply"].(map[string]any)["properties"].(map[string]any)["effect"]
		}
		props["rules"] = map[string]any{"type": "array", "maxItems": 16, "items": dslObject([]string{"id", "target", "apply"}, map[string]any{"id": map[string]any{"type": "string"}, "target": dslSelectorSchema(), "apply": dslObject(nil, apply)})}
	}
	if has(familyCaption) {
		props["after"] = map[string]any{"type": "array", "maxItems": 4, "items": dslObject([]string{"id", "type", "language"}, map[string]any{"id": map[string]any{"type": "string"}, "type": dslEnum("captions.generate"), "input": dslEnum("montage"), "assetId": map[string]any{"type": "string"}, "language": map[string]any{"type": "string"}, "maxWords": map[string]any{"type": "integer", "minimum": 1, "maximum": 10}})}
	}
	if has(familyImage) || has(familySpeech) {
		var types []string
		if has(familyImage) {
			types = append(types, "image.generate")
		}
		if has(familySpeech) {
			types = append(types, "speech.generate")
		}
		fields := map[string]any{"id": map[string]any{"type": "string"}, "type": dslEnum(types...)}
		for _, name := range []string{"prompt", "text", "voice", "model", "aspect", "background", "imageStyle"} {
			fields[name] = map[string]any{"type": "string"}
		}
		props["before"] = map[string]any{"type": "array", "maxItems": 4, "items": dslObject([]string{"id", "type"}, fields)}
		props["placements"] = all["placements"]
	}
	if has(familyText) {
		props["texts"] = map[string]any{"type": "array", "maxItems": 16, "items": dslObject([]string{"id", "text", "start", "duration"}, map[string]any{"id": map[string]any{"type": "string"}, "text": map[string]any{"type": "string", "maxLength": 1000}, "start": dslTimeSchema(), "duration": dslTimeSchema(), "preset": dslEnum(sortedTextPresetIDs()...)})}
	}
	if has(familyMedia) {
		props["inputs"] = all["inputs"]
		props["sequence"] = dslSequenceSchema(looks, motions, transitions)
		props["audio"] = all["audio"]
	}
	envelope := map[string]any{"mode": dslEnum(planModeEdit, planModeRecommend), "summary": map[string]any{"type": "string", "maxLength": 160}, "recipe": dslObject([]string{"mode"}, props)}
	if analysis.Requested {
		ids := make([]string, 0, len(analysis.Moments))
		for _, moment := range analysis.Moments {
			ids = append(ids, moment.ID)
		}
		envelope["moments"] = map[string]any{"type": "array", "maxItems": compiler.MaxMontageRanges,
			"items": dslObject([]string{"id"}, map[string]any{
				"id": dslEnum(ids...), "score": map[string]any{"type": "integer", "minimum": 0, "maximum": 100},
			}),
		}
	}
	if has(familyMedia) {
		envelope["bindings"] = map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}
	}
	required := []string{"mode", "summary", "recipe"}
	if analysis.Requested && !hasExplicitSourceRanges(instruction) {
		required = append(required, "moments")
	}
	return openrouter.Tool{Type: "function", Function: openrouter.FunctionDefinition{Name: recipeToolName, Description: "Return one compact DSL recipe. Go resolves moments, IDs, overlap geometry and staged caption/media jobs.", Parameters: dslObject(required, envelope)}}
}
