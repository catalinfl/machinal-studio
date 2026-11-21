package mcpserver

import "fmt"

func compareProductionBaseline(output Output, contract, baseline *productionContract) Output {
	if baseline == nil || output.StatusCode != 200 {
		return output
	}
	fields, ok := output.Data.(map[string]any)
	if !ok {
		return output
	}
	review, ok := fields["productionReview"].(productionReview)
	if !ok || review.Status == "not_ready" {
		return output
	}
	ids := make(map[string]bool)
	if contract != nil {
		for _, beat := range contract.Beats {
			ids[beat.ID] = true
		}
	}
	for index, beat := range baseline.Beats {
		if !ids[beat.ID] {
			review.add("missing_original_beat", fmt.Sprintf("productionBaseline.beats[%d]", index),
				fmt.Sprintf("Original beat %q [%.6f, %.6f]s is missing. Reconcile this beat explicitly; do not collapse the original contract into one generic whole-video beat.", beat.ID, beat.Start, beat.End))
		}
	}
	if review.TotalFindings > 0 {
		review.Status = "revision_required"
	}
	fields["productionReview"] = review
	return output
}
