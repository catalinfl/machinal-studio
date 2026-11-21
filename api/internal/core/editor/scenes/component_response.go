package scenes

import (
	"fmt"
	"regexp"
	"strings"
)

type componentResult struct {
	Component   string `json:"component"`
	Explanation string `json:"explanation,omitempty"`
}

var componentFence = regexp.MustCompile("(?m)^```svelte[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```[ \\t]*\\r?$")

func extractComponent(text string) (componentResult, error) {
	text = strings.TrimSpace(text)
	matches := componentFence.FindAllStringSubmatchIndex(text, -1)
	if len(matches) == 1 {
		match := matches[0]
		return componentResult{
			Component:   strings.TrimSpace(text[match[2]:match[3]]),
			Explanation: strings.TrimSpace(text[:match[0]] + "\n" + text[match[1]:]),
		}, nil
	}
	if len(matches) > 1 || strings.Contains(text, "```") || !strings.HasPrefix(text, "<") {
		return componentResult{}, &providerResultError{"The scene model must return one complete Svelte component, separated from its explanation. Try again."}
	}
	return componentResult{Component: text}, nil
}

func normalizeComponentResult(result componentResult) (componentResult, error) {
	isolated, err := extractComponent(result.Component)
	if err != nil {
		return componentResult{}, err
	}
	if len(isolated.Component) == 0 || len(isolated.Component) > maxComponentBytes {
		return componentResult{}, fmt.Errorf("generated scene component exceeds size limits")
	}
	result.Component = isolated.Component
	if result.Explanation == "" {
		result.Explanation = isolated.Explanation
	}
	if len(result.Explanation) > maxComponentBytes {
		return componentResult{}, fmt.Errorf("generated scene explanation exceeds size limits")
	}
	return result, nil
}
