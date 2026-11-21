package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"ffmpeg-go-server/editengine/catalog"
	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/scenecontract"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	defaultReferenceLimit = 8
	maxReferenceLimit     = 25
	maxReferenceQuery     = 80
)

type referenceInput struct {
	Topic        string `json:"topic"`
	ID           string `json:"id,omitempty"`
	Query        string `json:"query,omitempty"`
	Limit        int    `json:"limit,omitempty"`
	Offset       int    `json:"offset,omitempty"`
	IncludeGuide *bool  `json:"includeGuide,omitempty"`
}

type referenceResult struct {
	Topic           string            `json:"topic"`
	GuideURI        string            `json:"guideUri"`
	Guide           string            `json:"guide,omitempty"`
	CatalogVersion  string            `json:"catalogVersion"`
	CompilerVersion string            `json:"compilerVersion"`
	DSLVersions     []int             `json:"dslVersions"`
	Topics          []string          `json:"topics"`
	Counts          map[string]int    `json:"counts"`
	Entries         []json.RawMessage `json:"entries"`
	Total           int               `json:"total"`
	NextOffset      *int              `json:"nextOffset,omitempty"`
	Limits          map[string]int    `json:"limits"`
}

func referenceInputSchema() map[string]any {
	return map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"topic"},
		"properties": map[string]any{
			"topic":        map[string]any{"type": "string", "enum": referenceTopicNames()},
			"id":           map[string]any{"type": "string", "maxLength": 128, "description": "Exact preset, style, example, template, animation-skill or film ID; omit for discovery. Templates return Svelte; animation skills return focused native skill source; film entries return reference-only source/provenance."},
			"query":        map[string]any{"type": "string", "maxLength": maxReferenceQuery, "description": "Literal search in IDs, labels, categories and descriptions; not a regex or prompt"},
			"limit":        map[string]any{"type": "integer", "minimum": 1, "maximum": maxReferenceLimit, "description": "Page size, default 8"},
			"offset":       map[string]any{"type": "integer", "minimum": 0, "description": "Use nextOffset from a previous page"},
			"includeGuide": map[string]any{"type": "boolean", "description": "Include the full workflow guide. Defaults to true for an unfiltered first page, false for ID/search/pagination. guideUri always identifies the separately readable guide."},
		},
	}
}

func registerReferenceTools(server *mcp.Server) {
	entries, loadErr := loadReferenceEntries()
	if loadErr == nil {
		loadErr = registerSceneTemplateResources(server, entries["sceneTemplates"])
	}
	if loadErr == nil {
		loadErr = registerAnimationSkillResources(server, entries["animationSkills"])
	}
	for _, category := range []string{"filmStyles", "filmTechniques"} {
		if loadErr == nil {
			loadErr = registerFilmReferenceResources(server, entries[category])
		}
	}
	mcp.AddTool(server, &mcp.Tool{
		Name: "get_editing_reference", InputSchema: referenceInputSchema(), Annotations: annotations(true, false, true),
		Description: "Read deployed guides, exact presets and examples. New video: topic=brief, native question tool in one form, then proceed immediately within authorization without a separate plan confirmation. Read production before scenes/final render and media before source access/delivery. scene-runtime is the implementation contract; scene-templates plus exact id returns Svelte. animation-skills discovers focused motion, choreography, spatial, visual-review and sound skills; exact id returns complete native skill source. film-styles/film-techniques return reference direction. Skill/template/film IDs are not YAML presets or permission. Use exact id/query/pagination; cache unchanged references. No paid work or user media access.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, input referenceInput) (*mcp.CallToolResult, Output, error) {
		if loadErr != nil {
			return nil, Output{}, errors.New("The bundled editing reference is unavailable. Use the live schema/capabilities and ask the administrator to rebuild the API.")
		}
		result, err := editingReference(input, entries)
		if err != nil {
			return nil, Output{}, err
		}
		return nil, Output{StatusCode: 200, Data: result}, nil
	})
	registerExampleResources(server)
}

func editingReference(input referenceInput, entries map[string][]json.RawMessage) (referenceResult, error) {
	var topic *referenceTopic
	for index := range referenceTopics {
		if referenceTopics[index].ID == input.Topic {
			topic = &referenceTopics[index]
			break
		}
	}
	if topic == nil || input.Offset < 0 || input.Limit < 0 || input.Limit > maxReferenceLimit || utf8.RuneCountInString(input.Query) > maxReferenceQuery {
		return referenceResult{}, errors.New("Use a supported reference topic, a valid page size/offset and a short literal query.")
	}
	if topic.Category == "" && (input.ID != "" || input.Query != "" || input.Offset != 0) {
		return referenceResult{}, errors.New("This topic is a field/workflow guide. Use catalog, styles, commands or examples topics for ID/search filters.")
	}
	guide, err := bundledGuides.ReadFile("guides/" + topic.Guide + ".md")
	if topic.ID == "scene-runtime" {
		guide, err = []byte(scenecontract.Guide), nil
	}
	if err != nil {
		return referenceResult{}, errors.New("The requested bundled guide is unavailable.")
	}
	result := referenceResult{
		Topic: topic.ID, GuideURI: "machinal://reference/" + topic.Guide,
		CatalogVersion: catalog.Version, CompilerVersion: compiler.Version,
		DSLVersions: []int{document.Version, document.RecipeVersion, document.MontageVersion}, Topics: referenceTopicNames(),
		Counts: make(map[string]int), Entries: []json.RawMessage{},
		Limits: map[string]int{"clips": compiler.MaxClips, "textItems": compiler.MaxTextItems, "commands": compiler.MaxCommands, "montageRanges": compiler.MaxMontageRanges},
	}
	includeGuide := input.ID == "" && input.Query == "" && input.Offset == 0
	if input.IncludeGuide != nil {
		includeGuide = *input.IncludeGuide
	}
	if includeGuide {
		result.Guide = string(guide)
	}
	if topic.ID == "overview" {
		result.GuideURI = "machinal://reference/overview"
	}
	for category, values := range entries {
		result.Counts[category] = len(values)
	}
	matches, err := matchingReferenceEntries(entries[topic.Category], input)
	if err != nil {
		return referenceResult{}, err
	}
	result.Total = len(matches)
	if input.ID != "" && len(matches) == 0 {
		return referenceResult{}, errors.New("No matching ID exists in this deployed reference topic. Search or list the category first; do not invent a preset.")
	}
	limit := input.Limit
	if limit == 0 {
		limit = defaultReferenceLimit
	}
	start := min(input.Offset, len(matches))
	end := min(start+limit, len(matches))
	result.Entries = append(result.Entries, matches[start:end]...)
	if topic.ID == "scene-templates" && input.ID != "" && len(result.Entries) > 0 {
		entry, err := sceneTemplateWithSource(result.Entries[0])
		if err != nil {
			return referenceResult{}, err
		}
		result.Entries[0] = entry
	}
	if topic.ID == "animation-skills" && input.ID != "" && len(result.Entries) > 0 {
		entry, err := animationSkillWithSource(result.Entries[0])
		if err != nil {
			return referenceResult{}, err
		}
		result.Entries[0] = entry
	}
	if (topic.ID == "film-styles" || topic.ID == "film-techniques") && input.ID != "" && len(result.Entries) > 0 {
		entry, err := filmReferenceWithSource(result.Entries[0])
		if err != nil {
			return referenceResult{}, err
		}
		result.Entries[0] = entry
	}
	if end < len(matches) {
		result.NextOffset = &end
	}
	return result, nil
}

func matchingReferenceEntries(entries []json.RawMessage, input referenceInput) ([]json.RawMessage, error) {
	matches := []json.RawMessage{}
	query := strings.ToLower(strings.TrimSpace(input.Query))
	for _, entry := range entries {
		var fields map[string]json.RawMessage
		if json.Unmarshal(entry, &fields) != nil {
			return nil, errors.New("A bundled reference entry is invalid. Rebuild the API before using this topic.")
		}
		var id string
		if json.Unmarshal(fields["id"], &id) != nil {
			return nil, errors.New("A bundled reference entry is missing its ID.")
		}
		if input.ID != "" && input.ID != id {
			continue
		}
		searchable := []string{id}
		for _, key := range []string{"label", "category", "summary", "algorithm", "description", "hint", "intent"} {
			if raw, ok := fields[key]; ok {
				var value string
				if json.Unmarshal(raw, &value) != nil {
					return nil, errors.New("A bundled reference description is invalid.")
				}
				searchable = append(searchable, value)
			}
		}
		if query == "" || strings.Contains(strings.ToLower(strings.Join(searchable, " ")), query) {
			matches = append(matches, entry)
		}
	}
	return matches, nil
}

func registerExampleResources(server *mcp.Server) {
	for _, example := range referenceExamples {
		uri := "machinal://examples/" + example.ID
		server.AddResource(&mcp.Resource{URI: uri, Name: "example-" + example.ID, Title: example.Description, MIMEType: "application/yaml"},
			func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
				content, err := bundledGuides.ReadFile("reference/examples/" + example.ID + ".yaml")
				if err != nil {
					return nil, errors.New("The bundled recipe example is unavailable.")
				}
				return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: uri, MIMEType: "application/yaml", Text: string(content)}}}, nil
			})
	}
}
