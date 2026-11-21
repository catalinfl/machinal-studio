package mcpserver

import "testing"

func TestOriginalBeatsCannotBeSilentlyCollapsedInFinalContract(t *testing.T) {
	plan, original := contractFixture("recipe")
	current := original
	current.Beats = append([]productionBeat(nil), original.Beats...)
	current.Beats[0].ID = "whole-video-summary"
	review := productionOutput(t, "recipe", plan, &current)
	output := compareProductionBaseline(Output{StatusCode: 200, Data: map[string]any{"productionReview": review}}, &current, &original)
	checked := output.Data.(map[string]any)["productionReview"].(productionReview)
	if checked.Status != "revision_required" || checked.TotalFindings != 1 || checked.Findings[0].Code != "missing_original_beat" {
		t.Fatal(checked)
	}
	output = compareProductionBaseline(Output{StatusCode: 200, Data: map[string]any{"productionReview": productionOutput(t, "recipe", plan, &original)}}, &original, &original)
	if output.Data.(map[string]any)["productionReview"].(productionReview).TotalFindings != 0 {
		t.Fatal(output)
	}
}
