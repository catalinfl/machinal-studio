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
	{"animation-skills", "animation-skills", ""},
	{"film-styles", "film-styles", ""},
	{"film-techniques", "film-styles", ""},
	{"commands", "commands", "commands"},
	{"styles", "styles", ""},
	{"examples", "examples", ""},
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
	for _, command := range compiler.SupportedCommands() {
		entry, err := json.Marshal(map[string]string{"id": command})
		if err != nil {
			return nil, fmt.Errorf("encode reference command: %w", err)
		}
		entries["commands"] = append(entries["commands"], entry)
	}
	return entries, nil
}
