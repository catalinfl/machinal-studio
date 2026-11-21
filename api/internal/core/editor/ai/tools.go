package ai

import (
	"ffmpeg-go-server/internal/integrations/openrouter"
)

const mediaAnalysisToolName = "analyze_media"

// resultIDPatternString is the shared result/job ID rule; plan_validation.go
// enforces the same rule via resultIDPattern so schema and validator cannot drift.
const resultIDPatternString = "^[A-Za-z][A-Za-z0-9_-]{0,31}$"

func mediaAnalysisTool() openrouter.Tool {
	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        mediaAnalysisToolName,
			Description: "Analyze the relevant selected, mentioned, or timeline media before making decisions based on its spoken or visible content, pauses, scenes, quality, energy, or important moments. Do not use for explicit timing, metadata, styling, or catalog-only edits.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties":           map[string]any{},
			},
		},
	}
}

// API must respect this schema created by this function.
// Invalid model output is rejected, repaired, or reduced to a safe fallback plan.
func editTool(project project) openrouter.Tool {
	imageJobs := buildEditImageJobsSchema(project)
	speechJobs := buildEditSpeechJobsSchema()
	operations := buildEditOperationsSchema(project)

	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        toolName,
			Description: "Return a validated timeline, AI-image, and text-to-speech edit or an executable recommendation. Generated media jobs run only when the client applies the plan. Undo is unavailable.",
			Parameters: editObject(
				[]string{
					"mode",
					"summary",
					"operations",
				},
				map[string]any{
					"mode":       editEnum(planModeEdit, planModeRecommend),
					"summary":    map[string]any{"type": "string", "maxLength": bestEffortSummaryLimit},
					"imageJobs":  imageJobs,
					"speechJobs": speechJobs,
					"operations": map[string]any{
						"type":     "array",
						"maxItems": maxOperations,
						"items":    map[string]any{"oneOf": operations},
					},
				},
			),
		},
	}
}

func editNumber(minimum float64) map[string]any {
	return map[string]any{"type": "number", "minimum": minimum}
}

func editBounded(minimum, maximum float64) map[string]any {
	return map[string]any{"type": "number", "minimum": minimum, "maximum": maximum}
}

func editEnum(values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}

func editObject(required []string, properties map[string]any) map[string]any {
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

func editCopyFields(fields map[string]any) map[string]any {
	copied := make(map[string]any, len(fields))
	for key, value := range fields {
		copied[key] = value
	}
	return copied
}

func buildEditStyleSchema() map[string]any {
	return editObject(nil, map[string]any{
		"x":                          editNumber(0),
		"y":                          editNumber(0),
		"fontFamily":                 editEnum("sans", "system", "roboto", "open-sans", "lato", "montserrat", "oswald", "helvetica", "verdana", "trebuchet", "tahoma", "arial-black", "serif", "playfair-display", "merriweather", "times", "palatino", "mono", "roboto-mono", "lucida-console", "display", "comic-sans"),
		"fontSize":                   editNumber(8),
		"fontWeight":                 map[string]any{"type": "integer", "enum": []int{400, 700}},
		"italic":                     map[string]any{"type": "boolean"},
		"align":                      editEnum("left", "center", "right", "justify"),
		"color":                      map[string]any{"type": "string"},
		"strokeColor":                map[string]any{"type": "string"},
		"strokeWidth":                editNumber(0),
		"backgroundColor":            map[string]any{"type": "string"},
		"backgroundOpacity":          editNumber(0),
		"backgroundPadding":          editNumber(0),
		"backgroundRadius":           editNumber(0),
		"bannerStyle":                editEnum("none", "rail", "block", "underline"),
		"accentColor":                map[string]any{"type": "string"},
		"animation":                  editEnum("none", "slide-left", "slide-right", "rise", "pop", "drop", "bounce", "shake", "float"),
		"animationDuration":          editBounded(0.1, 2),
		"opacity":                    editNumber(0),
		"rotation":                   map[string]any{"type": "number", "minimum": -180, "maximum": 180},
		"isCaption":                  map[string]any{"type": "boolean"},
		"highlightMode":              editEnum("none", "word"),
		"highlightColor":             map[string]any{"type": "string"},
		"highlightBackgroundColor":   map[string]any{"type": "string"},
		"highlightBackgroundOpacity": editNumber(0),
		"highlightAnimation":         editEnum("pop", "bounce", "slide-up", "glow", "none"),
	})
}

func buildEditTransformSchema() map[string]any {
	transformFields := map[string]any{
		"zoomX":     editBounded(0.01, 40),
		"zoomY":     editBounded(0.01, 40),
		"linkZoom":  map[string]any{"type": "boolean"},
		"positionX": editBounded(-100, 100),
		"positionY": editBounded(-100, 100),
		"rotation":  editBounded(-180, 180),
		"anchorX":   editBounded(0, 1),
		"anchorY":   editBounded(0, 1),
		"pitch":     editBounded(-90, 90),
		"yaw":       editBounded(-90, 90),
		"flipH":     map[string]any{"type": "boolean"},
		"flipV":     map[string]any{"type": "boolean"},
	}
	transformProperties := editCopyFields(transformFields)
	transformProperties["keyframes"] = map[string]any{
		"type":     "array",
		"maxItems": maxTransformKeyframes,
		"items": editObject(
			[]string{"time", "transform"},
			map[string]any{
				"time":      editBounded(0, maxTimeline),
				"transform": editObject(nil, editCopyFields(transformFields)),
			},
		),
	}
	return editObject(nil, transformProperties)
}

func buildEditImageJobsSchema(project project) map[string]any {
	motionPresetIDs := sortedMotionPresetIDs()
	proxyImageNames := proxyImageNames(project)
	imageJobProperties := map[string]any{
		"id":           map[string]any{"type": "string", "pattern": resultIDPatternString},
		"prompt":       map[string]any{"type": "string", "minLength": 1, "maxLength": maxImagePromptRunes},
		"style":        map[string]any{"type": "string", "maxLength": maxImageStyleRunes},
		"placement":    editEnum("media-bin", "overlay"),
		"position":     editEnum("left", "center", "right"),
		"start":        editBounded(0, maxTimeline),
		"duration":     editBounded(0.2, maxTimeline),
		"background":   editEnum("auto", "transparent", "opaque"),
		"quality":      editEnum("auto", "low", "medium", "high"),
		"motionPreset": editEnum(motionPresetIDs...),
		"opacity":      editBounded(0, 1),
		"fade":         editBounded(0, maxTimeline),
	}
	if len(proxyImageNames) > 0 {
		imageJobProperties["sourceName"] = editEnum(proxyImageNames...)
	}
	return map[string]any{
		"type":     "array",
		"maxItems": maxImageJobs,
		"items": editObject(
			[]string{"id", "prompt", "placement", "position", "start", "duration", "background", "quality", "motionPreset"},
			imageJobProperties,
		),
	}
}

func buildEditSpeechJobsSchema() map[string]any {
	speechJobVariants := make([]any, 0, len(speechModelPresets))
	for _, preset := range speechModelPresets {
		speechJobVariants = append(speechJobVariants, editObject(
			[]string{"id", "input", "model", "voice", "start"},
			map[string]any{
				"id":           map[string]any{"type": "string", "pattern": resultIDPatternString},
				"input":        map[string]any{"type": "string", "minLength": 1, "maxLength": maxSpeechInputRunes},
				"model":        map[string]any{"const": preset.ID},
				"voice":        editEnum(preset.Voices...),
				"language":     map[string]any{"type": "string", "description": "Spoken language, e.g. ro or en; choose a compatible native/multilingual voice"},
				"instructions": map[string]any{"type": "string", "maxLength": maxSpeechInputRunes},
				"start":        editBounded(0, maxTimeline),
				"volume":       editBounded(0, maxVolumePercent),
			},
		))
	}
	return map[string]any{
		"type":     "array",
		"maxItems": maxSpeechJobs,
		"items":    map[string]any{"oneOf": speechJobVariants},
	}
}

func buildEditOperationsSchema(project project) []any {
	style := buildEditStyleSchema()
	transform := buildEditTransformSchema()
	params := map[string]any{
		"type":                 "object",
		"additionalProperties": map[string]any{"type": "number"},
	}
	transitionIDs := sortedTransitionIDs()
	clipPresetIDs := sortedClipPresetIDs()
	textPresetIDs := sortedTextPresetIDs()
	sourceIDs := sortedSourceIDs(project)

	operations := []any{
		editObject(
			[]string{
				"type",
				"start",
				"end",
			},
			map[string]any{
				"type":  map[string]any{"const": "delete_range"},
				"start": editNumber(0),
				"end":   editNumber(0),
				"channelIds": map[string]any{
					"type":        "array",
					"uniqueItems": true,
					"items":       map[string]any{"type": "string"},
				},
			},
		),
		editObject(
			[]string{
				"type",
				"channelId",
				"effectId",
				"start",
				"duration",
			},
			map[string]any{
				"type":      map[string]any{"const": "add_effect"},
				"channelId": map[string]any{"type": "string"},
				"effectId":  map[string]any{"type": "string"},
				"start":     editNumber(0),
				"duration":  editNumber(0.2),
				"params":    params,
			},
		),
		editObject(
			[]string{
				"type",
				"blockId",
			},
			map[string]any{
				"type":     map[string]any{"const": "update_effect"},
				"blockId":  map[string]any{"type": "string"},
				"start":    editNumber(0),
				"duration": editNumber(0.2),
				"params":   params,
			},
		),
		editObject(
			[]string{
				"type",
				"blockId",
			},
			map[string]any{
				"type":    map[string]any{"const": "delete_effect"},
				"blockId": map[string]any{"type": "string"},
			},
		),
		editObject(
			[]string{
				"type",
				"start",
				"duration",
				"text",
			},
			map[string]any{
				"type":         map[string]any{"const": "add_text"},
				"start":        editNumber(0),
				"duration":     editNumber(0.2),
				"text":         map[string]any{"type": "string", "maxLength": maxTextLen},
				"textPresetId": editEnum(textPresetIDs...),
				"style":        style,
			},
		),
		editObject(
			[]string{
				"type",
				"textId",
			},
			map[string]any{
				"type":         map[string]any{"const": "update_text"},
				"textId":       map[string]any{"type": "string"},
				"start":        editNumber(0),
				"duration":     editNumber(0.2),
				"text":         map[string]any{"type": "string", "maxLength": maxTextLen},
				"textPresetId": editEnum(textPresetIDs...),
				"style":        style,
			},
		),
		editObject(
			[]string{
				"type",
				"textId",
			},
			map[string]any{
				"type":   map[string]any{"const": "delete_text"},
				"textId": map[string]any{"type": "string"},
			},
		),
		map[string]any{
			"oneOf": []any{
				editObject(
					[]string{
						"type",
						"clipId",
						"start",
					},
					map[string]any{
						"type":      map[string]any{"const": "move_clip"},
						"clipId":    map[string]any{"type": "string", "minLength": 1},
						"start":     editBounded(0, maxTimeline),
						"channelId": map[string]any{"type": "string", "minLength": 1},
					},
				),
				editObject(
					[]string{
						"type",
						"clipId",
						"delta",
					},
					map[string]any{
						"type":      map[string]any{"const": "move_clip"},
						"clipId":    map[string]any{"type": "string", "minLength": 1},
						"delta":     map[string]any{"type": "number", "minimum": -maxTimeline, "maximum": maxTimeline},
						"channelId": map[string]any{"type": "string", "minLength": 1},
					},
				),
			},
		},
		editObject(
			[]string{
				"type",
				"clipId",
			},
			map[string]any{
				"type":         map[string]any{"const": "update_clip"},
				"clipId":       map[string]any{"type": "string", "minLength": 1},
				"start":        editBounded(0, maxTimeline),
				"inPoint":      editNumber(0),
				"outPoint":     editNumber(0),
				"playbackRate": editBounded(minPlaybackRate, maxPlaybackRate),
				"volume":       editBounded(0, maxVolumePercent),
				"transform":    transform,
				"motionPreset": editEnum("none", "zoom-in", "zoom-out", "punch", "zoom-pulse", "ken-burns", "pan-left", "pan-right", "pan-up", "pan-down", "reframe-left", "reframe-right", "settle", "impact-shake", "drift"),
			},
		),
		editObject(
			[]string{
				"type",
				"clipId",
				"time",
			},
			map[string]any{
				"type":   map[string]any{"const": "split_clip"},
				"clipId": map[string]any{"type": "string", "minLength": 1},
				"time":   editBounded(0, maxTimeline),
			},
		),
		editObject(
			[]string{
				"type",
				"clipId",
			},
			map[string]any{
				"type":   map[string]any{"const": "remove_source_audio"},
				"clipId": map[string]any{"type": "string", "minLength": 1},
			},
		),
		editObject(
			[]string{
				"type",
				"clipId",
			},
			map[string]any{
				"type":   map[string]any{"const": "delete_clip"},
				"clipId": map[string]any{"type": "string", "minLength": 1},
			},
		),
		editObject(
			[]string{
				"type",
				"clipId",
				"presetId",
			},
			map[string]any{
				"type":     map[string]any{"const": "apply_preset"},
				"clipId":   map[string]any{"type": "string", "minLength": 1},
				"presetId": editEnum(clipPresetIDs...),
			},
		),
		editObject(
			[]string{
				"type",
				"channelId",
				"leftClipId",
				"rightClipId",
				"effectId",
				"duration",
			},
			map[string]any{
				"type":        map[string]any{"const": "add_transition"},
				"channelId":   map[string]any{"type": "string", "minLength": 1},
				"leftClipId":  map[string]any{"type": "string", "minLength": 1},
				"rightClipId": map[string]any{"type": "string", "minLength": 1},
				"effectId":    editEnum(transitionIDs...),
				"duration":    editBounded(minTransition, maxTimeline),
			},
		),
		editObject(
			[]string{
				"type",
				"channelId",
				"leftClipId",
				"rightClipId",
				"effectId",
				"duration",
			},
			map[string]any{
				"type":        map[string]any{"const": "update_transition"},
				"channelId":   map[string]any{"type": "string", "minLength": 1},
				"leftClipId":  map[string]any{"type": "string", "minLength": 1},
				"rightClipId": map[string]any{"type": "string", "minLength": 1},
				"effectId":    editEnum(transitionIDs...),
				"duration":    editBounded(minTransition, maxTimeline),
			},
		),
	}

	if len(sourceIDs) > 0 {
		operations = append(operations, editObject(
			[]string{
				"type",
				"sourceId",
				"resultId",
				"channelId",
				"start",
				"sourceIn",
				"sourceOut",
				"includeAudio",
			},
			map[string]any{
				"type":         map[string]any{"const": "add_media"},
				"sourceId":     editEnum(sourceIDs...),
				"resultId":     map[string]any{"type": "string", "pattern": resultIDPatternString},
				"channelId":    map[string]any{"type": "string", "minLength": 1},
				"start":        editBounded(0, maxTimeline),
				"sourceIn":     editNumber(0),
				"sourceOut":    editNumber(0),
				"playbackRate": editBounded(minPlaybackRate, maxPlaybackRate),
				"volume":       editBounded(0, maxVolumePercent),
				"includeAudio": map[string]any{"type": "boolean"},
			},
		))
	}

	return operations
}
