package mcpserver

import (
	"encoding/json"
	"fmt"

	"ffmpeg-go-server/editengine/catalog"
	"ffmpeg-go-server/editengine/compiler"
)

type referenceTopic struct {
	ID       string
	Guide    string
	Category string
}

var referenceTopics = []referenceTopic{
	{"overview", "reference-overview", ""},
	{"brief", "brief", ""},
	{"production", "production", ""},
	{"yaml", "yaml", ""},
	{"media", "media", ""},
	{"transitions", "transitions", "transitions"},
	{"effects", "effects", "effects"},
	{"looks", "looks-motion", "looks"},
	{"motions", "looks-motion", "motions"},
	{"text", "text-audio", "textPresets"},
	{"fonts", "text-audio", "fonts"},
	{"audio", "text-audio", ""},
	{"jobs", "jobs-scenes", ""},
	{"scenes", "jobs-scenes", ""},
	{"scene-runtime", "scene-runtime", ""},
	{"scene-authoring", "scene-authoring", ""},
	{"scene-templates", "scene-templates", "sceneTemplates"},
	{"film-styles", "film-styles", "filmStyles"},
	{"film-techniques", "film-styles", "filmTechniques"},
	{"commands", "commands", "commands"},
	{"styles", "styles", "styles"},
	{"examples", "examples", "examples"},
}

type exampleDefinition struct {
	ID           string
	Description  string
	Requirements int
}

var referenceExamples = []exampleDefinition{
	{"client-scene", "Place client-authored Svelte source without a server AI fee; server scene rendering and video encoding remain billed", 0},
	{"cinematic-sequence", "Uniform sequence, fine-film, motion override and 600ms overlap", 0},
	{"social-hook", "Explicit clips, short transition, look/motion rules and a supplied title", 0},
	{"tutorial-clean", "Readable step label, static treatment and source audio", 0},
	{"caption-audio", "Verified example word timings and percent-volume looping music", 0},
	{"montage-v3", "Whole source ranges, exact duration tolerance and deterministic presets", 0},
	{"modify-snapshot", "Synthetic current-shaped compiler snapshot, trim and motion commands", 0},
	{"scene-generation", "Pending paid portrait scene brief and staged placement", 1},
	{"scene-three-explainer", "Art-directed procedural Three.js mechanism with timed assembly, independent motion, lighting and camera orbit", 1},
	{"scene-image-insert", "Footage with a timed animated Svelte scene, independently moving objects and an uploaded image attachment", 1},
	{"scene-generated-image", "Generate a complex subject image before embedding it in a genuine Three.js scene", 2},
	{"scene-edit", "Pending paid edit of an existing live scene, preserving other content", 1},
	{"generated-media", "Pending paid image, speech and after-stage captions", 3},
	{"narration-timing", "Pass 1: Romanian speech and requested measured captions only, without visual generation", 2},
	{"narrated-documentary", "Pass 2: preserve resolved voice/captions, then generate an image and a cue-bound Three.js scene with an FHD heading", 2},
}

func referenceTopicNames() []string {
	names := make([]string, 0, len(referenceTopics))
	for _, topic := range referenceTopics {
		names = append(names, topic.ID)
	}
	return names
}

func loadReferenceEntries() (map[string][]json.RawMessage, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(catalog.JSON(), &raw); err != nil {
		return nil, fmt.Errorf("decode reference catalog: %w", err)
	}
	entries := make(map[string][]json.RawMessage)
	for _, category := range []string{"transitions", "effects", "looks", "motions", "textPresets", "fonts"} {
		var values []json.RawMessage
		if err := json.Unmarshal(raw[category], &values); err != nil {
			return nil, fmt.Errorf("decode reference category %s: %w", category, err)
		}
		entries[category] = values
	}
	styles, err := bundledGuides.ReadFile("reference/styles.json")
	if err != nil {
		return nil, fmt.Errorf("read reference styles: %w", err)
	}
	var profiles []json.RawMessage
	if err := json.Unmarshal(styles, &profiles); err != nil {
		return nil, fmt.Errorf("decode reference styles: %w", err)
	}
	entries["styles"] = profiles
	templates, err := loadSceneTemplateEntries()
	if err != nil {
		return nil, err
	}
	entries["sceneTemplates"] = templates
	for _, category := range []struct{ topic, key string }{{"film-styles", "filmStyles"}, {"film-techniques", "filmTechniques"}} {
		values, err := loadFilmReferenceEntries(category.topic)
		if err != nil {
			return nil, err
		}
		entries[category.key] = values
	}
	for _, command := range compiler.SupportedCommands() {
		entry, err := json.Marshal(map[string]string{"id": command})
		if err != nil {
			return nil, fmt.Errorf("encode reference command: %w", err)
		}
		entries["commands"] = append(entries["commands"], entry)
	}
	for _, example := range referenceExamples {
		entry, err := referenceExampleEntry(example)
		if err != nil {
			return nil, err
		}
		entries["examples"] = append(entries["examples"], entry)
	}
	return entries, nil
}

func referenceExampleEntry(example exampleDefinition) (json.RawMessage, error) {
	content, err := bundledGuides.ReadFile("reference/examples/" + example.ID + ".yaml")
	if err != nil {
		return nil, fmt.Errorf("read reference example: %w", err)
	}
	entry, err := json.Marshal(map[string]any{
		"id": example.ID, "description": example.Description, "composition": string(content),
		"uri": "machinal://examples/" + example.ID, "syntheticMetadata": true,
		"pendingGeneration": example.Requirements > 0,
	})
	if err != nil {
		return nil, fmt.Errorf("encode reference example: %w", err)
	}
	return entry, nil
}
