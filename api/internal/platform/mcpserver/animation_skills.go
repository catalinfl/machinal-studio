package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type animationSkill struct {
	ID          string   `json:"id"`
	Version     string   `json:"version"`
	Label       string   `json:"label"`
	Description string   `json:"description"`
	Templates   []string `json:"templates"`
	URI         string   `json:"uri"`
	Source      string   `json:"source,omitempty"`
}

func animationSkillSource(id string) (string, error) {
	if !sceneTemplateIDPattern.MatchString(id) {
		return "", fmt.Errorf("invalid animation skill ID")
	}
	content, err := bundledGuides.ReadFile("reference/animation-skills/" + id + ".md")
	if err != nil || len(content) == 0 || len(content) > maxTemplateSourceBytes {
		return "", fmt.Errorf("animation skill %q is unavailable or invalid", id)
	}
	return string(content), nil
}

func loadAnimationSkillEntries() ([]json.RawMessage, error) {
	content, err := bundledGuides.ReadFile("reference/animation-skills.json")
	if err != nil {
		return nil, fmt.Errorf("read animation skills: %w", err)
	}
	var skills []animationSkill
	if err := json.Unmarshal(content, &skills); err != nil {
		return nil, fmt.Errorf("decode animation skills: %w", err)
	}
	entries := make([]json.RawMessage, 0, len(skills))
	seen := make(map[string]bool)
	for _, skill := range skills {
		if seen[skill.ID] || skill.Version == "" || skill.Label == "" || skill.Description == "" || skill.Source != "" {
			return nil, fmt.Errorf("invalid animation skill %q", skill.ID)
		}
		if _, err := animationSkillSource(skill.ID); err != nil {
			return nil, err
		}
		seen[skill.ID] = true
		skill.URI = "machinal://animation-skills/" + skill.ID
		entry, err := json.Marshal(skill)
		if err != nil {
			return nil, fmt.Errorf("encode animation skill: %w", err)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func animationSkillWithSource(entry json.RawMessage) (json.RawMessage, error) {
	var skill animationSkill
	if err := json.Unmarshal(entry, &skill); err != nil {
		return nil, fmt.Errorf("decode animation skill: %w", err)
	}
	source, err := animationSkillSource(skill.ID)
	if err != nil {
		return nil, err
	}
	skill.Source = source
	return json.Marshal(skill)
}

func registerAnimationSkillResources(server *mcp.Server, entries []json.RawMessage) error {
	for _, entry := range entries {
		var skill animationSkill
		if err := json.Unmarshal(entry, &skill); err != nil {
			return fmt.Errorf("decode animation skill resource: %w", err)
		}
		server.AddResource(&mcp.Resource{URI: skill.URI, Name: skill.ID, Title: skill.Label, MIMEType: "text/markdown"},
			func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
				source, err := animationSkillSource(skill.ID)
				if err != nil {
					return nil, err
				}
				return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: skill.URI, MIMEType: "text/markdown", Text: source}}}, nil
			})
	}
	return nil
}
