package mcpserver

import (
	"strings"
	"testing"
)

func TestWorkflowCarriesApprovalAndDistinguishesRepairableSourceFromInfrastructure(t *testing.T) {
	for _, text := range []string{
		"Carry the approved scope through completion",
		"userApproved asserts that existing permission",
		"Do not end the turn after an intermediate success",
		"Host permission prompts are separate",
		"Classify failures before repair",
		"rewriting Svelte cannot fix them",
		"recover the original job/idempotency before retrying",
	} {
		if !strings.Contains(instructions, text) {
			t.Errorf("missing continuity guidance: %s", text)
		}
	}
	for _, topic := range []string{"brief", "scene-authoring"} {
		reference, err := editingReference(referenceInput{Topic: topic}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(reference.Guide, "permission") || !strings.Contains(reference.Guide, "blocker") {
			t.Errorf("%s omits approval or persistent-blocker handling", topic)
		}
	}
}
