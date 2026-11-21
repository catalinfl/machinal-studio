package document

import (
	"reflect"
	"strings"
)

func Schema() map[string]any {
	schema := schemaFor(reflect.TypeFor[Document]())
	schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
	schema["title"] = "Edit document"
	schema["required"] = []string{"version", "mode"}
	properties := schema["properties"].(map[string]any)
	properties["version"] = map[string]any{"enum": []int{Version, RecipeVersion, MontageVersion}}
	properties["mode"] = map[string]any{"enum": []string{"assemble", "modify"}}
	for _, name := range []string{"catalogVersion", "compilerVersion"} {
		properties[name].(map[string]any)["description"] = "Optional compatibility pin: a string, not a number. Omit unless pinning is needed; otherwise read get_capabilities and quote the deployed value in YAML."
	}
	return schema
}

func schemaFor(kind reflect.Type) map[string]any {
	for kind.Kind() == reflect.Pointer {
		kind = kind.Elem()
	}
	if kind == reflect.TypeFor[Time]() {
		return map[string]any{"oneOf": []any{
			map[string]any{"type": "number", "minimum": -MaxTime.Seconds(), "maximum": MaxTime.Seconds()},
			map[string]any{"type": "string", "pattern": `^-?\d+(\.\d+)?(ms|s)$`},
		}}
	}
	switch kind.Kind() {
	case reflect.Struct:
		properties := make(map[string]any)
		for name, child := range jsonFields(kind) {
			properties[name] = schemaFor(child)
		}
		result := map[string]any{"type": "object", "additionalProperties": false, "properties": properties}
		if kind == reflect.TypeFor[Clip]() {
			properties["start"].(map[string]any)["description"] = "Timeline start in seconds; independent of the source trim."
			properties["inPoint"].(map[string]any)["description"] = "Source trim start in seconds. Timeline duration is (outPoint - inPoint) / playbackRate."
			properties["outPoint"].(map[string]any)["description"] = "Source trim end in seconds, not the timeline end. Set outPoint = inPoint + timelineDuration * playbackRate; timeline end = start + timelineDuration."
		}
		if kind == reflect.TypeFor[Output]() {
			properties["fit"] = map[string]any{"enum": []string{string(VideoFitContain), string(VideoFitCover)}, "default": string(VideoFitContain), "description": "contain shows the whole image with bars; cover fills the output frame with a centered crop (left/right for landscape footage in portrait output)"}
		}
		if kind == reflect.TypeFor[TextStyle]() || kind == reflect.TypeFor[TextItem]() {
			properties["anchor"] = map[string]any{"enum": []string{"left", "center", "right"}, "default": "center", "description": "Horizontal reference point for x, independent of text alignment; use left when text should start at x"}
		}
		if kind == reflect.TypeFor[Job]() {
			properties["visualMode"] = map[string]any{"enum": []string{"auto", "2d", "3d"}}
			properties["maxWords"] = map[string]any{"type": "integer", "minimum": 1, "maximum": 50, "default": 4}
			properties["language"] = map[string]any{"type": "string", "description": "Spoken language: ro for Romanian, en for English, auto for conservative detection; applies to speech and captions"}
			properties["narrationJob"] = map[string]any{"type": "string", "description": "Earlier speech.generate job whose measured duration and spoken content drive this scene"}
			narrationFrom := properties["narrationFrom"].(map[string]any)
			narrationFrom["minimum"] = 0
			narrationFrom["description"] = "Source-audio seconds; partial narration windows require measured caption words"
			result["allOf"] = []any{map[string]any{
				"if": map[string]any{"properties": map[string]any{"type": map[string]any{"enum": []string{"scene.generate", "scene.edit"}}}, "required": []string{"type"}},
				"then": map[string]any{"properties": map[string]any{
					"prompt": map[string]any{"type": "string", "maxLength": MaxScenePromptRunes},
					"images": map[string]any{"type": "array", "maxItems": MaxSceneImages},
				}},
			}}
		}
		if kind == reflect.TypeFor[SceneImage]() {
			properties["id"] = map[string]any{"enum": []string{"image_1", "image_2", "image_3", "image_4"}}
			properties["file"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 255}
			properties["job"] = map[string]any{"type": "string", "minLength": 1, "description": "Earlier before image.generate job ID; the backend pins its actual output filename"}
			properties["name"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 255}
			properties["description"] = map[string]any{"type": "string", "maxLength": 600}
			result["required"] = []string{"id", "name"}
			result["oneOf"] = []any{
				map[string]any{"required": []string{"file"}, "not": map[string]any{"required": []string{"job"}}},
				map[string]any{"required": []string{"job"}, "not": map[string]any{"required": []string{"file"}}},
			}
		}
		return result
	case reflect.Map:
		return map[string]any{"type": "object", "additionalProperties": schemaFor(kind.Elem())}
	case reflect.Slice:
		return map[string]any{"type": "array", "items": schemaFor(kind.Elem())}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Int, reflect.Int64:
		return map[string]any{"type": "integer"}
	case reflect.Float64:
		return map[string]any{"type": "number"}
	default:
		return map[string]any{"type": strings.TrimPrefix(kind.Kind().String(), "reflect.")}
	}
}
