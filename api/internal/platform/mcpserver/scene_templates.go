package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const maxTemplateSourceBytes = 64000

var sceneTemplateIDPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

type sceneTemplate struct {
	ID             string                   `json:"id"`
	Version        string                   `json:"version"`
	Label          string                   `json:"label"`
	Category       string                   `json:"category"`
	Description    string                   `json:"description"`
	VisualMode     string                   `json:"visualMode"`
	WhenToUse      []string                 `json:"whenToUse"`
	Avoid          []string                 `json:"avoid"`
	Config         sceneTemplateConfig      `json:"config"`
	Parameters     []sceneTemplateParameter `json:"parameters"`
	RequiredImages []sceneTemplateImage     `json:"requiredImages"`
	Choreography   map[string]string        `json:"choreography"`
	Adaptation     []string                 `json:"adaptation"`
	URI            string                   `json:"uri"`
	Component      string                   `json:"component,omitempty"`
}

type sceneTemplateConfig struct {
	Width           int  `json:"width"`
	Height          int  `json:"height"`
	FPS             int  `json:"fps"`
	Duration        int  `json:"duration"`
	CaptionSafeArea bool `json:"captionSafeArea"`
}

type sceneTemplateParameter struct {
	Path        string `json:"path"`
	Description string `json:"description"`
}

type sceneTemplateImage struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

func loadSceneTemplateEntries() ([]json.RawMessage, error) {
	content, err := bundledGuides.ReadFile("reference/scene-templates.json")
	if err != nil {
		return nil, fmt.Errorf("read scene template catalog: %w", err)
	}
	var templates []sceneTemplate
	if err := json.Unmarshal(content, &templates); err != nil {
		return nil, fmt.Errorf("decode scene template catalog: %w", err)
	}
	entries := make([]json.RawMessage, 0, len(templates))
	seen := make(map[string]bool)
	for _, template := range templates {
		if seen[template.ID] || template.Label == "" || template.Version == "" || template.Component != "" {
			return nil, fmt.Errorf("invalid or duplicate scene template %q", template.ID)
		}
		if _, err := sceneTemplateSource(template.ID); err != nil {
			return nil, err
		}
		seen[template.ID] = true
		template.URI = "machinal://scene-templates/" + template.ID
		entry, err := json.Marshal(template)
		if err != nil {
			return nil, fmt.Errorf("encode scene template %s: %w", template.ID, err)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func sceneTemplateSource(id string) (string, error) {
	if !sceneTemplateIDPattern.MatchString(id) {
		return "", fmt.Errorf("invalid scene template ID %q", id)
	}
	source, err := bundledGuides.ReadFile("reference/scene-templates/" + id + ".svelte")
	if err != nil {
		return "", fmt.Errorf("read bundled scene template %s: %w", id, err)
	}
	if len(source) == 0 || len(source) > maxTemplateSourceBytes {
		return "", fmt.Errorf("scene template %s must contain 1–%d bytes", id, maxTemplateSourceBytes)
	}
	return string(source), nil
}

func sceneTemplateWithSource(entry json.RawMessage) (json.RawMessage, error) {
	var template sceneTemplate
	if err := json.Unmarshal(entry, &template); err != nil {
		return nil, fmt.Errorf("decode scene template entry: %w", err)
	}
	source, err := sceneTemplateSource(template.ID)
	if err != nil {
		return nil, err
	}
	template.Component = source
	result, err := json.Marshal(template)
	if err != nil {
		return nil, fmt.Errorf("encode scene template source: %w", err)
	}
	return result, nil
}

func registerSceneTemplateResources(server *mcp.Server, entries []json.RawMessage) error {
	for _, entry := range entries {
		var template sceneTemplate
		if err := json.Unmarshal(entry, &template); err != nil {
			return fmt.Errorf("decode scene template resource: %w", err)
		}
		server.AddResource(&mcp.Resource{URI: template.URI, Name: "scene-template-" + template.ID, Title: template.Label, MIMEType: "text/plain"},
			func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
				source, err := sceneTemplateSource(template.ID)
				if err != nil {
					return nil, err
				}
				return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: template.URI, MIMEType: "text/plain", Text: source}}}, nil
			})
	}
	return nil
}
