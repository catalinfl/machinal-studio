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
			"id":           map[string]any{"type": "string", "maxLength": 128, "description": "Exact deployed preset, style, example, animation-skill or film ID; omit for discovery. Scene/Hyperframes sources are in the installed client library, not this API."},
			"query":        map[string]any{"type": "string", "maxLength": maxReferenceQuery, "description": "Literal search in IDs, labels, categories and descriptions; not a regex or prompt"},
			"limit":        map[string]any{"type": "integer", "minimum": 1, "maximum": maxReferenceLimit, "description": "Page size, default 8"},
			"offset":       map[string]any{"type": "integer", "minimum": 0, "description": "Use nextOffset from a previous page"},
			"includeGuide": map[string]any{"type": "boolean", "description": "Include the full workflow guide. Defaults to true for an unfiltered first page, false for ID/search/pagination. guideUri always identifies the separately readable guide."},
		},
	}
}

func registerReferenceTools(server *mcp.Server) {
	entries, loadErr := loadReferenceEntries()
	mcp.AddTool(server, &mcp.Tool{
		Name: "get_editing_reference", InputSchema: referenceInputSchema(), Annotations: annotations(true, false, true),
		Description: "Read live execution-preset metadata, limits and the scene-runtime contract. All authoring guides, skills, cinema styles, templates and examples belong to the installed MCP package: use get_library_reference or OpenCode machinal_library. Legacy guide topics return a client-library notice, not source. For new video topic=brief use the local native question tool in one form and proceed immediately within authorization without a separate plan confirmation. IDs are not permission. No paid work or user media access.",
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
		return referenceResult{}, errors.New("This authoring guide is in the installed MCP library. Use get_library_reference for authoring IDs/search; commands and live execution catalogs support runtime filters.")
	}
	guide := []byte(clientLibraryNotice)
	if topic.ID == "scene-runtime" {
		guide = []byte(scenecontract.Guide)
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
