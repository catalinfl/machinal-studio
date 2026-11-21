package ai

import (
	"fmt"
	"sort"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

// Focused executor tools. Each one carries mode+summary plus a small fragment
// of the plan; the server merges all calls into one validated editPlan.
// Small schemas keep fast models accurate and payloads cheap.

const (
	toolAddMedia   = "timeline_add_media"
	toolCut        = "timeline_cut"
	toolTrim       = "timeline_trim"
	toolLook       = "clip_look"
	toolTransition = "clip_transition"
	toolText       = "text_edit"
	toolCaption    = "caption_add"
	toolEffect     = "effect_apply"
	toolTransform  = "transform_apply"
	toolImage      = "image_generate"
	toolSpeech     = "speech_generate"
)

const maxFragmentOps = 16

// captionPresetIDs restricts caption_add to caption-friendly presets so the
// model cannot smuggle titles through the cheaper caption path.
var captionPresetIDs = []string{
	"active-word", "clean-phrase", "caption-bounce", "keyword-punch",
	"quote-pull", "payoff-line", "color-block",
	"tiktok-pop", "tiktok-box", "tiktok-glow",
}

func executorToolForFamily(family string) string {
	switch family {
	case familyMedia:
		return toolAddMedia
	case familyCut:
		return toolCut
	case familyTrim:
		return toolTrim
	case familyPreset:
		return toolLook
	case familyTransition:
		return toolTransition
	case familyText:
		return toolText
	case familyCaption:
		return toolCaption
	case familyEffect:
		return toolEffect
	case familyTransform:
		return toolTransform
	case familyImage:
		return toolImage
	case familySpeech:
		return toolSpeech
	}
	return ""
}

// allowedFragmentOps enforces that each focused tool only carries its own
// operation types. The merged plan still goes through full validation.
func allowedFragmentOps(tool string) map[string]bool {
	allow := func(types ...string) map[string]bool {
		set := make(map[string]bool, len(types))
		for _, t := range types {
			set[t] = true
		}
		return set
	}
	switch tool {
	case toolAddMedia:
		return allow("add_media")
	case toolCut:
		return allow("delete_range", "split_clip", "delete_clip", "move_clip", "remove_source_audio")
	case toolTrim:
		return allow("update_clip")
	case toolLook:
		return allow("apply_preset")
	case toolTransition:
		return allow("add_transition", "update_transition")
	case toolText:
		return allow("add_text", "update_text", "delete_text")
	case toolCaption:
		return allow("add_text")
	case toolEffect:
		return allow("add_effect", "update_effect", "delete_effect")
	case toolTransform:
		return allow("update_clip")
	}
	return map[string]bool{}
}

// Schema primitives shared by every focused tool.

func fragNumber(minimum float64) map[string]any {
	return map[string]any{"type": "number", "minimum": minimum}
}

func fragBounded(minimum, maximum float64) map[string]any {
	return map[string]any{"type": "number", "minimum": minimum, "maximum": maximum}
}

func fragEnum(values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}

func fragObject(required []string, properties map[string]any) map[string]any {
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

func fragModeSummary() map[string]any {
	return map[string]any{
		"mode":    fragEnum(planModeEdit, planModeRecommend),
		"summary": map[string]any{"type": "string", "maxLength": 160},
	}
}

func sortedTransitionIDs() []string {
	ids := make([]string, 0, len(transitionPresets))
	for id := range transitionPresets {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func sortedClipPresetIDs() []string {
	ids := make([]string, 0, len(clipPresets))
	for _, preset := range clipPresets {
		ids = append(ids, preset.ID)
	}
	sort.Strings(ids)
	return ids
}

func sortedTextPresetIDs() []string {
	ids := make([]string, 0, len(textPresets))
	for _, preset := range textPresets {
		ids = append(ids, preset.ID)
	}
	sort.Strings(ids)
	return ids
}

func sortedMotionPresetIDs() []string {
	ids := make([]string, 0, len(transformPresets))
	for _, preset := range transformPresets {
		ids = append(ids, preset.ID)
	}
	sort.Strings(ids)
	return ids
}

func sortedSourceIDs(project project) []string {
	ids := make([]string, 0, len(project.Sources))
	for _, source := range project.Sources {
		ids = append(ids, source.ID)
	}
	sort.Strings(ids)
	return ids
}

func proxyImageNames(project project) []string {
	names := make([]string, 0)
	for _, source := range project.Sources {
		if source.Kind == mediaKindImage && source.SourceMode == "proxy" {
			names = append(names, source.Name)
		}
	}
	sort.Strings(names)
	return names
}

func fragStyleSchema() map[string]any {
	return fragObject(nil, map[string]any{
		"x": fragNumber(0), "y": fragNumber(0),
		"fontFamily":                 fragEnum("sans", "system", "roboto", "open-sans", "lato", "montserrat", "oswald", "helvetica", "verdana", "trebuchet", "tahoma", "arial-black", "serif", "playfair-display", "merriweather", "times", "palatino", "mono", "roboto-mono", "lucida-console", "display", "comic-sans"),
		"fontSize":                   fragNumber(8),
		"fontWeight":                 map[string]any{"type": "integer", "enum": []int{400, 700}},
		"italic":                     map[string]any{"type": "boolean"},
		"align":                      fragEnum("left", "center", "right", "justify"),
		"color":                      map[string]any{"type": "string"},
		"strokeColor":                map[string]any{"type": "string"},
		"strokeWidth":                fragNumber(0),
		"backgroundColor":            map[string]any{"type": "string"},
		"backgroundOpacity":          fragNumber(0),
		"backgroundPadding":          fragNumber(0),
		"backgroundRadius":           fragNumber(0),
		"bannerStyle":                fragEnum("none", "rail", "block", "underline"),
		"accentColor":                map[string]any{"type": "string"},
		"animation":                  fragEnum("none", "slide-left", "slide-right", "rise", "pop", "drop", "bounce", "shake", "float"),
		"animationDuration":          fragBounded(0.1, 2),
		"opacity":                    fragNumber(0),
		"rotation":                   map[string]any{"type": "number", "minimum": -180, "maximum": 180},
		"isCaption":                  map[string]any{"type": "boolean"},
		"highlightMode":              fragEnum("none", "word"),
		"highlightColor":             map[string]any{"type": "string"},
		"highlightBackgroundColor":   map[string]any{"type": "string"},
		"highlightBackgroundOpacity": fragNumber(0),
		"highlightAnimation":         fragEnum("pop", "bounce", "slide-up", "glow", "none"),
	})
}

func fragTransformSchema() map[string]any {
	fields := map[string]any{
		"zoomX": fragBounded(0.01, 40), "zoomY": fragBounded(0.01, 40),
		"linkZoom":  map[string]any{"type": "boolean"},
		"positionX": fragBounded(-100, 100), "positionY": fragBounded(-100, 100),
		"rotation": fragBounded(-180, 180),
		"anchorX":  fragBounded(0, 1), "anchorY": fragBounded(0, 1),
		"pitch": fragBounded(-90, 90), "yaw": fragBounded(-90, 90),
		"flipH": map[string]any{"type": "boolean"}, "flipV": map[string]any{"type": "boolean"},
	}
	props := copySchemaFields(fields)
	props["keyframes"] = map[string]any{
		"type": "array", "maxItems": maxTransformKeyframes,
		"items": fragObject([]string{"time", "transform"}, map[string]any{
			"time":      fragBounded(0, maxTimeline),
			"transform": fragObject(nil, copySchemaFields(fields)),
		}),
	}
	return fragObject(nil, props)
}

func copySchemaFields(fields map[string]any) map[string]any {
	copied := make(map[string]any, len(fields))
	for key, value := range fields {
		copied[key] = value
	}
	return copied
}

func fragParamsSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": map[string]any{"type": "number"},
	}
}

// Per-operation schemas mirroring the editTool branches.

func fragDeleteRangeOp() any {
	return fragObject([]string{"type", "start", "end"}, map[string]any{
		"type":  map[string]any{"const": "delete_range"},
		"start": fragNumber(0), "end": fragNumber(0),
		"channelIds": map[string]any{"type": "array", "uniqueItems": true, "items": map[string]any{"type": "string"}},
	})
}

func fragSplitOp() any {
	return fragObject([]string{"type", "clipId", "time"}, map[string]any{
		"type":   map[string]any{"const": "split_clip"},
		"clipId": map[string]any{"type": "string", "minLength": 1},
		"time":   fragBounded(0, maxTimeline),
	})
}

func fragDeleteClipOp() any {
	return fragObject([]string{"type", "clipId"}, map[string]any{
		"type":   map[string]any{"const": "delete_clip"},
		"clipId": map[string]any{"type": "string", "minLength": 1},
	})
}

func fragRemoveAudioOp() any {
	return fragObject([]string{"type", "clipId"}, map[string]any{
		"type":   map[string]any{"const": "remove_source_audio"},
		"clipId": map[string]any{"type": "string", "minLength": 1},
	})
}

func fragMoveOp() any {
	return map[string]any{"oneOf": []any{
		fragObject([]string{"type", "clipId", "start"}, map[string]any{
			"type":      map[string]any{"const": "move_clip"},
			"clipId":    map[string]any{"type": "string", "minLength": 1},
			"start":     fragBounded(0, maxTimeline),
			"channelId": map[string]any{"type": "string", "minLength": 1},
		}),
		fragObject([]string{"type", "clipId", "delta"}, map[string]any{
			"type":      map[string]any{"const": "move_clip"},
			"clipId":    map[string]any{"type": "string", "minLength": 1},
			"delta":     map[string]any{"type": "number", "minimum": -maxTimeline, "maximum": maxTimeline},
			"channelId": map[string]any{"type": "string", "minLength": 1},
		}),
	}}
}

func fragAddMediaOp(project project) any {
	sourceIDs := sortedSourceIDs(project)
	props := map[string]any{
		"type":         map[string]any{"const": "add_media"},
		"resultId":     map[string]any{"type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,31}$"},
		"channelId":    map[string]any{"type": "string", "minLength": 1},
		"start":        fragBounded(0, maxTimeline),
		"sourceIn":     fragNumber(0),
		"sourceOut":    fragNumber(0),
		"playbackRate": fragBounded(minPlaybackRate, maxPlaybackRate),
		"volume":       fragBounded(0, 200),
		"includeAudio": map[string]any{"type": "boolean"},
	}
	if len(sourceIDs) > 0 {
		props["sourceId"] = fragEnum(sourceIDs...)
	} else {
		props["sourceId"] = map[string]any{"type": "string"}
	}
	return fragObject([]string{"type", "sourceId", "resultId", "channelId", "start", "sourceIn", "sourceOut", "includeAudio"}, props)
}

func fragTrimOp() any {
	return fragObject([]string{"type", "clipId"}, map[string]any{
		"type":         map[string]any{"const": "update_clip"},
		"clipId":       map[string]any{"type": "string", "minLength": 1},
		"start":        fragBounded(0, maxTimeline),
		"inPoint":      fragNumber(0),
		"outPoint":     fragNumber(0),
		"playbackRate": fragBounded(minPlaybackRate, maxPlaybackRate),
		"volume":       fragBounded(0, 200),
	})
}

func fragTransformOp() any {
	return fragObject([]string{"type", "clipId"}, map[string]any{
		"type":         map[string]any{"const": "update_clip"},
		"clipId":       map[string]any{"type": "string", "minLength": 1},
		"transform":    fragTransformSchema(),
		"motionPreset": fragEnum(sortedMotionPresetIDs()...),
	})
}

func fragLookOp() any {
	return fragObject([]string{"type", "clipId", "presetId"}, map[string]any{
		"type":     map[string]any{"const": "apply_preset"},
		"clipId":   map[string]any{"type": "string", "minLength": 1},
		"presetId": fragEnum(sortedClipPresetIDs()...),
	})
}

func fragTransitionOp() any {
	newTransition := func(constName string) any {
		return fragObject([]string{"type", "channelId", "leftClipId", "rightClipId", "effectId", "duration"}, map[string]any{
			"type":        map[string]any{"const": constName},
			"channelId":   map[string]any{"type": "string", "minLength": 1},
			"leftClipId":  map[string]any{"type": "string", "minLength": 1},
			"rightClipId": map[string]any{"type": "string", "minLength": 1},
			"effectId":    fragEnum(sortedTransitionIDs()...),
			"duration":    fragBounded(0.05, maxTimeline),
		})
	}
	return map[string]any{"oneOf": []any{newTransition("add_transition"), newTransition("update_transition")}}
}

func fragTextOp(presetIDs []string) any {
	newText := func(constName string, required []string) any {
		props := map[string]any{
			"type":         map[string]any{"const": constName},
			"start":        fragNumber(0),
			"duration":     fragNumber(0.2),
			"text":         map[string]any{"type": "string", "maxLength": 1000},
			"textId":       map[string]any{"type": "string"},
			"textPresetId": fragEnum(presetIDs...),
			"style":        fragStyleSchema(),
		}
		return fragObject(required, props)
	}
	return map[string]any{"oneOf": []any{
		newText("add_text", []string{"type", "start", "duration", "text"}),
		newText("update_text", []string{"type", "textId"}),
		fragObject([]string{"type", "textId"}, map[string]any{
			"type":   map[string]any{"const": "delete_text"},
			"textId": map[string]any{"type": "string"},
		}),
	}}
}

func fragCaptionOp() any {
	return fragObject([]string{"type", "start", "duration", "text"}, map[string]any{
		"type":         map[string]any{"const": "add_text"},
		"start":        fragNumber(0),
		"duration":     fragNumber(0.2),
		"text":         map[string]any{"type": "string", "maxLength": 1000},
		"textPresetId": fragEnum(captionPresetIDs...),
		"style":        fragStyleSchema(),
	})
}

func fragEffectOp() any {
	return map[string]any{"oneOf": []any{
		fragObject([]string{"type", "channelId", "effectId", "start", "duration"}, map[string]any{
			"type":      map[string]any{"const": "add_effect"},
			"channelId": map[string]any{"type": "string"},
			"effectId":  map[string]any{"type": "string"},
			"start":     fragNumber(0),
			"duration":  fragNumber(0.2),
			"params":    fragParamsSchema(),
		}),
		fragObject([]string{"type", "blockId"}, map[string]any{
			"type":     map[string]any{"const": "update_effect"},
			"blockId":  map[string]any{"type": "string"},
			"start":    fragNumber(0),
			"duration": fragNumber(0.2),
			"params":   fragParamsSchema(),
		}),
		fragObject([]string{"type", "blockId"}, map[string]any{
			"type":    map[string]any{"const": "delete_effect"},
			"blockId": map[string]any{"type": "string"},
		}),
	}}
}

func fragImageJobsSchema(project project) map[string]any {
	props := map[string]any{
		"id":           map[string]any{"type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,31}$"},
		"prompt":       map[string]any{"type": "string", "minLength": 1, "maxLength": 4000},
		"style":        map[string]any{"type": "string", "maxLength": 300},
		"placement":    fragEnum("media-bin", "overlay"),
		"position":     fragEnum("left", "center", "right"),
		"start":        fragBounded(0, maxTimeline),
		"duration":     fragBounded(0.2, maxTimeline),
		"background":   fragEnum("auto", "transparent", "opaque"),
		"quality":      fragEnum("auto", "low", "medium", "high"),
		"motionPreset": fragEnum(sortedMotionPresetIDs()...),
		"opacity":      fragBounded(0, 1),
		"fade":         fragBounded(0, maxTimeline),
	}
	if names := proxyImageNames(project); len(names) > 0 {
		props["sourceName"] = fragEnum(names...)
	}
	return map[string]any{
		"type": "array", "maxItems": maxImageJobs,
		"items": fragObject(
			[]string{"id", "prompt", "placement", "position", "start", "duration", "background", "quality", "motionPreset"},
			props,
		),
	}
}

func fragSpeechJobsSchema() map[string]any {
	variants := make([]any, 0, len(speechModelPresets))
	for _, preset := range speechModelPresets {
		variants = append(variants, fragObject(
			[]string{"id", "input", "model", "voice", "start"},
			map[string]any{
				"id":           map[string]any{"type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,31}$"},
				"input":        map[string]any{"type": "string", "minLength": 1, "maxLength": 4000},
				"model":        map[string]any{"const": preset.ID},
				"voice":        fragEnum(preset.Voices...),
				"language":     map[string]any{"type": "string", "description": "Spoken language: ro for Romanian, en for English; voice must match"},
				"instructions": map[string]any{"type": "string", "maxLength": maxSpeechInputRunes},
				"start":        fragBounded(0, maxTimeline),
				"volume":       fragBounded(0, maxVolumePercent),
			},
		))
	}
	return map[string]any{
		"type": "array", "maxItems": maxSpeechJobs,
		"items": map[string]any{"oneOf": variants},
	}
}

// Focused tool constructors.

func fragOpsTool(name, description string, ops ...any) openrouter.Tool {
	base := fragModeSummary()
	base["operations"] = map[string]any{
		"type": "array", "maxItems": maxFragmentOps,
		"items": map[string]any{"oneOf": ops},
	}
	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        name,
			Description: description,
			Parameters: fragObject(
				[]string{"mode", "summary", "operations"},
				base,
			),
		},
	}
}

func addMediaTool(project project) openrouter.Tool {
	return fragOpsTool(toolAddMedia,
		"Add one or more Media Bin sources to the timeline. Use exact sourceIds from the snapshot.",
		fragAddMediaOp(project))
}

func cutTool() openrouter.Tool {
	return fragOpsTool(toolCut,
		"Cut timeline: delete ranges, split, delete or move clips, remove source audio. Delete ranges are applied right to left.",
		fragDeleteRangeOp(), fragSplitOp(), fragDeleteClipOp(), fragMoveOp(), fragRemoveAudioOp())
}

func trimTool() openrouter.Tool {
	return fragOpsTool(toolTrim,
		"Retime existing clips: trim source windows, retime start, set playback rate and volume.",
		fragTrimOp())
}

func lookTool() openrouter.Tool {
	return fragOpsTool(toolLook,
		"Apply a color/grade clip look preset to clips. Pick the closest preset ID yourself.",
		fragLookOp())
}

func transitionTool() openrouter.Tool {
	return fragOpsTool(toolTransition,
		"Add or update transitions between adjacent clips. Transitions join two neighboring clips on the same track.",
		fragTransitionOp())
}

func textTool() openrouter.Tool {
	return fragOpsTool(toolText,
		"On-screen text and titles: add, update or delete text. Use an exact text preset ID.",
		fragTextOp(sortedTextPresetIDs()))
}

func captionTool() openrouter.Tool {
	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        toolCaption,
			Description: "Captions and subtitles only: add a timed caption line. Prefer the active-word preset for spoken captions. Each caption holds at most 5 words; split longer lines into sequential captions.",
			Parameters: fragObject(
				[]string{"mode", "summary", "operations"},
				map[string]any{
					"mode":    fragEnum(planModeEdit, planModeRecommend),
					"summary": map[string]any{"type": "string", "maxLength": 160},
					"operations": map[string]any{
						"type": "array", "maxItems": maxFragmentOps,
						"items": fragCaptionOp(),
					},
				},
			),
		},
	}
}

func effectTool() openrouter.Tool {
	return fragOpsTool(toolEffect,
		"Channel effects: add, update or delete a numeric-param effect on a video track.",
		fragEffectOp())
}

func transformTool() openrouter.Tool {
	return fragOpsTool(toolTransform,
		"Motion and framing: apply a motion preset or transform values to a clip.",
		fragTransformOp())
}

func imageTool(project project) openrouter.Tool {
	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        toolImage,
			Description: "Generate new AI images or overlays. Deferred: the client generates them when applying the plan.",
			Parameters: fragObject(
				[]string{"mode", "summary", "imageJobs"},
				map[string]any{
					"mode":      fragEnum(planModeEdit, planModeRecommend),
					"summary":   map[string]any{"type": "string", "maxLength": 160},
					"imageJobs": fragImageJobsSchema(project),
				},
			),
		},
	}
}

func speechTool() openrouter.Tool {
	return openrouter.Tool{
		Type: "function",
		Function: openrouter.FunctionDefinition{
			Name:        toolSpeech,
			Description: "Generate narration or voice-over with text-to-speech. Copy requested spoken words exactly.",
			Parameters: fragObject(
				[]string{"mode", "summary", "speechJobs"},
				map[string]any{
					"mode":       fragEnum(planModeEdit, planModeRecommend),
					"summary":    map[string]any{"type": "string", "maxLength": 160},
					"speechJobs": fragSpeechJobsSchema(),
				},
			),
		},
	}
}

// buildExecutorTools returns only the focused tools for the selected families.
func buildExecutorTools(project project, families []string) []openrouter.Tool {
	tools := make([]openrouter.Tool, 0, len(families))
	for _, family := range families {
		switch family {
		case familyMedia:
			tools = append(tools, addMediaTool(project))
		case familyCut:
			tools = append(tools, cutTool())
		case familyTrim:
			tools = append(tools, trimTool())
		case familyPreset:
			tools = append(tools, lookTool())
		case familyTransition:
			tools = append(tools, transitionTool())
		case familyText:
			tools = append(tools, textTool())
		case familyCaption:
			tools = append(tools, captionTool())
		case familyEffect:
			tools = append(tools, effectTool())
		case familyTransform:
			tools = append(tools, transformTool())
		case familyImage:
			tools = append(tools, imageTool(project))
		case familySpeech:
			tools = append(tools, speechTool())
		}
	}
	if len(tools) == 0 {
		tools = append(tools, cutTool(), trimTool())
	}
	return tools
}

func executorToolNames(tools []openrouter.Tool) []string {
	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		names = append(names, tool.Function.Name)
	}
	return names
}

// Fragment parsing and merging.

type planFragment struct {
	Mode       string          `json:"mode"`
	Summary    string          `json:"summary"`
	Operations []editOperation `json:"operations,omitempty"`
	ImageJobs  []imageJob      `json:"imageJobs,omitempty"`
	SpeechJobs []speechJob     `json:"speechJobs,omitempty"`
}

// mergeExecutorCalls merges every focused tool call of one response into a
// single editPlan. Unknown tools and cross-family operations are rejected so
// the repair loop gets a precise error.
func mergeExecutorCalls(response openrouter.ChatCompletionResponse) (editPlan, error) {
	if len(response.Choices) == 0 {
		return editPlan{}, fmt.Errorf("OpenRouter returned no choices")
	}
	if response.Choices[0].FinishReason == "length" {
		return editPlan{}, fmt.Errorf("planner output exceeded its token budget; no partial plan was applied")
	}
	calls := response.Choices[0].Message.ToolCalls
	if len(calls) == 0 {
		return editPlan{}, fmt.Errorf("OpenRouter did not return any tool call")
	}
	merged := editPlan{Operations: []editOperation{}}
	for _, call := range calls {
		fragment, err := parsePlanFragment(call)
		if err != nil {
			return editPlan{}, err
		}
		if fragment.Mode != "" && merged.Mode == "" {
			merged.Mode = fragment.Mode
		}
		if fragment.Summary != "" && merged.Summary == "" {
			merged.Summary = fragment.Summary
		}
		merged.Operations = append(merged.Operations, fragment.Operations...)
		merged.ImageJobs = append(merged.ImageJobs, fragment.ImageJobs...)
		merged.SpeechJobs = append(merged.SpeechJobs, fragment.SpeechJobs...)
	}
	if merged.Summary == "" {
		return editPlan{}, fmt.Errorf("planner did not return a summary")
	}
	return merged, nil
}

func parsePlanFragment(call openrouter.ToolCall) (planFragment, error) {
	var fragment planFragment
	allowed, ok := fragmentPayload(call.Function.Name)
	if !ok {
		return fragment, fmt.Errorf("unsupported planner tool %q", call.Function.Name)
	}
	if call.ID == "" {
		return fragment, fmt.Errorf("OpenRouter returned %s without a call ID", call.Function.Name)
	}
	if err := decodeStrictJSON([]byte(call.Function.Arguments), &fragment); err != nil {
		return fragment, fmt.Errorf("OpenRouter returned invalid %s arguments: %w", call.Function.Name, err)
	}
	for _, operation := range fragment.Operations {
		if !allowed[operation.Type] {
			return fragment, fmt.Errorf("tool %s cannot carry operation %q", call.Function.Name, operation.Type)
		}
	}
	if call.Function.Name == toolCaption {
		for index, operation := range fragment.Operations {
			if operation.TextPresetID != "" && !oneOf(operation.TextPresetID, captionPresetIDs...) {
				return fragment, fmt.Errorf("tool %s supports caption presets only; use text_edit for %q", toolCaption, operation.TextPresetID)
			}
			if operation.TextPresetID == "" {
				fragment.Operations[index].TextPresetID = "active-word"
			}
		}
	}
	if call.Function.Name == toolTrim && len(fragment.Operations) > 0 {
		for _, operation := range fragment.Operations {
			if operation.Transform != nil || operation.MotionPreset != "" {
				return fragment, fmt.Errorf("tool %s trims timing only; use transform_apply for motion", toolTrim)
			}
		}
	}
	if call.Function.Name == toolTransform && len(fragment.Operations) > 0 {
		for _, operation := range fragment.Operations {
			if operation.Start != nil || operation.InPoint != nil || operation.OutPoint != nil ||
				operation.PlaybackRate != nil || operation.Volume != nil {
				return fragment, fmt.Errorf("tool %s changes motion only; use timeline_trim for timing", toolTransform)
			}
		}
	}
	return fragment, nil
}

// fragmentPayload reports which operation types a tool may carry. Image and
// speech tools carry jobs instead of operations.
func fragmentPayload(name string) (map[string]bool, bool) {
	switch name {
	case toolImage, toolSpeech:
		return map[string]bool{}, true
	}
	allowed := allowedFragmentOps(name)
	if len(allowed) == 0 {
		return nil, false
	}
	return allowed, true
}
