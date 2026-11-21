package ai

import (
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

func TestCaptionToolMarksUntypedCaptions(t *testing.T) {
	call := openrouter.ToolCall{ID: "caption-1"}
	call.Function.Name = toolCaption
	call.Function.Arguments = `{"mode":"execute","summary":"Captions","operations":[{"type":"add_text","start":0,"duration":1,"text":"Hello"}]}`
	fragment, err := parsePlanFragment(call)
	if err != nil {
		t.Fatal(err)
	}
	if fragment.Operations[0].TextPresetID != "active-word" {
		t.Fatalf("caption preset = %q", fragment.Operations[0].TextPresetID)
	}
}

func TestCaptionOnlyPlanDoesNotAddUnrequestedTransitions(t *testing.T) {
	plan := editPlan{Operations: []editOperation{
		{Type: "add_text", Start: floatPtr(0), Duration: floatPtr(1), Text: stringPtr("Hello"), TextPresetID: "active-word"},
		{Type: "add_transition", LeftClipID: "left", RightClipID: "right"},
	}}

	normalized := normalizePlanForInstruction("Pune captions", plan, project{})
	if len(normalized.Operations) != 1 || normalized.Operations[0].Type != "add_text" {
		t.Fatalf("caption-only operations = %+v", normalized.Operations)
	}

	withTransition := normalizePlanForInstruction("Pune captions si tranzitii", plan, project{})
	if len(withTransition.Operations) != 2 {
		t.Fatalf("explicit transition operations = %+v", withTransition.Operations)
	}
}
