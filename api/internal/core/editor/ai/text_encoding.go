package ai

import (
	"slices"
	"strings"

	edittext "ffmpeg-go-server/editengine/text"
)

func normalizeAITextEncoding(plan *editPlan) {
	for index := range plan.Operations {
		operation := &plan.Operations[index]
		if operation.Text != nil && oneOf(operation.Type, "add_text", "update_text") {
			repaired := edittext.RepairEncoding(*operation.Text)
			operation.Text = &repaired
		}
	}
}

func requestsCaptionEncodingRepair(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	if !strings.Contains(normalized, "caption") && !strings.Contains(normalized, "subtit") {
		return false
	}
	repair := slices.ContainsFunc(strings.Fields(normalized), func(word string) bool {
		return oneOf(word, "repara", "reparati", "corecteaza", "corectati", "fix", "repair", "correct", "restore")
	})
	if !repair {
		return false
	}
	return slices.ContainsFunc([]string{"codificar", "encoding", "mojibake", "diacriti", "utf 8", "caractere stricate", "damaged characters"}, func(issue string) bool {
		return strings.Contains(normalized, issue)
	})
}
