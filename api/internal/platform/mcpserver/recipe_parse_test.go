package mcpserver

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestInvalidYAMLReportsParseBeforeCaptionAndContractGuards(t *testing.T) {
	source, err := os.ReadFile("testdata/caption-preservation.edit.yaml")
	if err != nil {
		t.Fatal(err)
	}
	baseline := string(source)
	broken := strings.Replace(baseline, "bindings:", "  bindings:", 1)
	for _, name := range []string{"validate_recipe", "compile_recipe"} {
		handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
			t.Fatal("invalid YAML reached API")
			return Response{}, nil
		})
		result, output := callTool(t, handler, name, map[string]any{
			"projectId": "owned", "composition": broken,
			"expectedCaptionVersion": recipeCaptionVersion(baseline), "captionBaseline": baseline,
		})
		if !result.IsError || output.StatusCode != http.StatusBadRequest {
			t.Fatal(result, output)
		}
		fields := output.Data.(map[string]any)
		if fields["captionReview"].(map[string]any)["status"] != "not_checked" {
			t.Fatal(fields)
		}
		diagnostic := fields["diagnostics"].([]any)[0].(map[string]any)
		if diagnostic["code"] != "parse" || diagnostic["line"] == nil && !strings.Contains(diagnostic["message"].(string), "line") {
			t.Fatal(diagnostic)
		}
	}
	if err := checkCaptionVersion(broken, recipeCaptionVersion(baseline)); err == nil || !strings.Contains(err.Error(), "invalid recipe") {
		t.Fatal("parse error masquerades as caption mutation", err)
	}
	if _, err := compareCaptionBaseline(broken, baseline, nil, false); err == nil || strings.Contains(err.Error(), "Caption preservation failed") {
		t.Fatal("baseline comparison hid parsing failure", err)
	}
}

func TestEmptyCaptionComparisonDoesNotClaimPreservation(t *testing.T) {
	const recipe = "document:\n  version: 2\n  mode: assemble\n"
	review, err := compareCaptionBaseline(recipe, recipe, nil, false)
	if err != nil || review["status"] != "not_applicable" || review["completeEntriesCompared"] != false {
		t.Fatal(review, err)
	}
	const unresolved = "document:\n  version: 2\n  jobs:\n    - {id: captions, type: captions.generate, resultTextIds: [missing]}\n"
	if _, err := compareCaptionBaseline(unresolved, unresolved, nil, false); err == nil {
		t.Fatal("unresolved caption IDs passed as materialized preservation")
	}
}
