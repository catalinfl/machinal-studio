package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestWireEditPlanSerializesMissingOperationsAsEmptyArray(t *testing.T) {
	encoded, err := json.Marshal(wireEditPlan(editPlan{Summary: "Kept everything"}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"operations":[]`) {
		t.Fatalf("operations must serialize as [], got %s", encoded)
	}
	var decoded struct {
		Operations []editOperation `json:"operations"`
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Operations == nil {
		t.Fatal("operations must decode as an empty array, got nil")
	}
}

func TestWireEditPlanKeepsExistingOperations(t *testing.T) {
	plan := wireEditPlan(editPlan{
		Summary:    "Trimmed",
		Operations: []editOperation{{Type: "delete_clip", ClipID: "clip-1"}},
	})
	if len(plan.Operations) != 1 || plan.Operations[0].ClipID != "clip-1" {
		t.Fatalf("existing operations must be preserved, got %+v", plan.Operations)
	}
}
