package mcpserver

import (
	"encoding/json"
	"errors"
	"fmt"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/compositions"
)

func presentComposition(output Output, yaml string, full bool, doc *document.Document) Output {
	fields, ok := output.Data.(map[string]any)
	if !ok {
		return output
	}
	fields["compositionVersion"] = compositionVersion(yaml)
	if version := captionVersion(doc); version != "" {
		fields["captionVersion"] = version
		fields["captionContentReview"] = reviewCaptionContent(*doc, captionTimeline(fields["composition"]))
	}
	if !full {
		for _, key := range []string{"document", "bindings", "composition", "recovery"} {
			delete(fields, key)
		}
		fields["detail"] = "summary"
		fields["fullResultHint"] = "Use fullResult=true on this same free operation for normalized document/plan/recovery. No generation or render is needed."
	}
	return output
}

func captionVersion(doc *document.Document) string {
	if doc == nil {
		return ""
	}
	type resolvedCaptions struct {
		ID      string   `json:"id"`
		TextIDs []string `json:"resultTextIds"`
	}
	ids := []resolvedCaptions{}
	for _, jobs := range [][]document.Job{doc.Jobs, doc.Before, doc.After} {
		for _, job := range jobs {
			if len(job.ResultTextIDs) > 0 {
				ids = append(ids, resolvedCaptions{ID: job.ID, TextIDs: job.ResultTextIDs})
			}
		}
	}
	data, err := json.Marshal(struct {
		Texts []document.TextItem `json:"texts"`
		Jobs  []resolvedCaptions  `json:"jobs"`
	}{doc.Texts, ids})
	if err != nil {
		return ""
	}
	return contentVersion(data)
}

func recipeCaptionVersion(yaml string) string {
	input, _, err := compositions.ParseProject([]byte(yaml))
	if err != nil {
		return ""
	}
	return captionVersion(&input.Document)
}

func checkCaptionVersion(yaml, expected string) error {
	if expected == "" {
		return nil
	}
	input, _, err := compositions.ParseProject([]byte(yaml))
	if err != nil {
		return fmt.Errorf("Cannot verify caption preservation: invalid recipe: %w", err)
	}
	if !contractVersionPattern(expected) || captionVersion(&input.Document) != expected {
		return errors.New("Existing text entries or caption resultTextIds changed from expectedCaptionVersion. Restore the exact baseline, or omit this optional guard only for an explicitly authorized text/caption edit.")
	}
	return nil
}

func attachCompositionCheckpoint(output Output) Output {
	fields, ok := output.Data.(map[string]any)
	if !ok {
		return output
	}
	data, err := json.Marshal(fields["composition"])
	if err != nil {
		return output
	}
	var plan *composition.Composition
	if json.Unmarshal(data, &plan) != nil || plan == nil {
		return output
	}
	fields["planSummary"] = map[string]any{"id": plan.ID, "duration": plan.Duration, "output": plan.Output,
		"tracks": len(plan.Tracks), "assets": len(plan.Assets), "texts": len(plan.TextItems),
		"effects": len(plan.Effects), "transitions": len(plan.Transitions), "compilerVersion": plan.CompilerVersion, "catalogVersion": plan.CatalogVersion}
	return output
}
