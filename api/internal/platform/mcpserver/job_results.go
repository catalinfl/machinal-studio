package mcpserver

import (
	"context"
	"errors"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gopkg.in/yaml.v3"
)

func invokeJobResult(ctx context.Context, req *mcp.CallToolRequest, call Caller, input jobInput) (*mcp.CallToolResult, Output, error) {
	path, err := jobPath(input.ProjectID, input.JobID)
	if err != nil {
		return nil, Output{}, err
	}
	return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: path + "?view=result"})
}

func resolvedRecipe(data any) (string, error) {
	view, ok := data.(map[string]any)
	if !ok {
		return "", errors.New("job did not return a structured result")
	}
	if view["status"] != "completed" && view["status"] != "failed" {
		return "", errors.New("wait for the existing job to finish before continuing its recipe")
	}
	result, _ := view["result"].(map[string]any)
	if recovery, ok := result["recovery"].(map[string]any); ok && recovery["document"] != nil {
		return encodeRecipeYAML(recovery)
	}
	compiled, _ := result["composition"].(map[string]any)
	if result["document"] == nil || compiled == nil {
		return "", errors.New("this job has no resolved generation recipe; retain the original YAML and inspect its diagnostics")
	}
	bindings := result["bindings"]
	if bindings == nil {
		bindings = map[string]any{}
	}
	return encodeRecipeYAML(map[string]any{"document": result["document"], "bindings": bindings, "assets": compiled["assets"]})
}

func encodeRecipeYAML(envelope map[string]any) (string, error) {
	encoded, err := yaml.Marshal(envelope)
	if err != nil {
		return "", errors.New("the resolved recipe could not be encoded as YAML")
	}
	if len(encoded) > maxCompositionBytes {
		return "", errors.New("resolved YAML exceeds MCP limits; retrieve it through the authenticated API")
	}
	return string(encoded), nil
}

func yamlJobResult(data any) any {
	view, ok := data.(map[string]any)
	if !ok {
		return data
	}
	result, _ := view["result"].(map[string]any)
	if recipe, err := resolvedRecipe(data); err == nil {
		// Job.View also flattens the compiler result for legacy editor routes.
		for _, key := range []string{"result", "document", "bindings", "composition", "recovery"} {
			delete(view, key)
		}
		view["recipeYaml"] = recipe
		view["compositionVersion"] = contentVersion([]byte(recipe))
		if version := recipeCaptionVersion(recipe); version != "" {
			view["captionVersion"] = version
		}
		for _, key := range []string{"diagnostics", "requirements", "summary", "cost"} {
			if value, exists := result[key]; exists {
				view[key] = value
			}
		}
	}
	return view
}

func continuationYAML(ctx context.Context, req *mcp.CallToolRequest, call Caller, projectID, sourceJobID, composition string) (string, error) {
	if sourceJobID == "" {
		return composition, nil
	}
	if composition != "" {
		return "", errors.New("provide either sourceJobId for an unchanged continuation or a complete YAML composition, not both")
	}
	result, output, err := invokeJobResult(ctx, req, call, jobInput{ProjectID: projectID, JobID: sourceJobID})
	if err != nil {
		return "", err
	}
	if result.IsError {
		return "", errors.New("the source job is not accessible in this project")
	}
	return resolvedRecipe(output.Data)
}
