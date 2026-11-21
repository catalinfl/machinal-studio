package ai

import (
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
)

func TestNormalizeAITextRepairsEncodingWithoutRetiming(t *testing.T) {
	for _, kind := range []string{"add_text", "update_text"} {
		original := "È˜tiinÈ›Äƒ È™i RomÃ¢nia"
		operation := editOperation{Type: kind, Text: &original, TextPresetID: "active-word"}
		if kind == "add_text" {
			operation.Start, operation.Duration = floatPtr(1), floatPtr(2)
		} else {
			operation.TextID = "caps/0"
		}
		plan := normalizePlanForInstruction("Corectează textul", editPlan{Operations: []editOperation{operation}}, project{})
		if len(plan.Operations) != 1 || *plan.Operations[0].Text != "Știință și România" {
			t.Fatalf("AI text was not repaired: %+v", plan.Operations)
		}
		got := plan.Operations[0]
		if got.Start != operation.Start || got.Duration != operation.Duration || got.TextID != operation.TextID || got.TextPresetID != operation.TextPresetID {
			t.Fatalf("encoding repair changed unrelated fields: %+v", got)
		}
		if original != "È˜tiinÈ›Äƒ È™i RomÃ¢nia" {
			t.Fatal("normalization mutated the original text")
		}
	}
}

func TestAITextRejectsLostCharactersForRepair(t *testing.T) {
	p := project{Duration: 5, Aspect: "landscape", Texts: []text{{ID: "caps/0", Duration: 1, Text: "România"}}}
	for _, operation := range []editOperation{
		{Type: "add_text", Start: floatPtr(0), Duration: floatPtr(1), Text: stringPtr("Rom�nia")},
		{Type: "update_text", TextID: "caps/0", Text: stringPtr("Rom�nia")},
	} {
		plan := editPlan{Mode: planModeEdit, Summary: "Captions", Operations: []editOperation{operation}}
		if err := validatePlan(plan, p); err == nil || !strings.Contains(err.Error(), "damaged characters") {
			t.Fatalf("damaged AI text did not request repair: %v", err)
		}
	}
}

func TestAIRecipeRepairsExistingCaptionsWithoutNewGeneration(t *testing.T) {
	input := dslTestInput()
	input.Snapshot = testSnapshotWithClip()
	style := document.DefaultTextStyle()
	style.IsCaption, style.HighlightMode = true, "word"
	input.Snapshot.TextItems = []document.TextItem{{
		ID: "caps/0", Text: "È™i", Start: document.Second, Duration: document.Second,
		TextStyle: style, Words: []document.Word{{Text: "È™i", End: document.Second}},
	}}
	response := dslTestResponse(dslCall("1", recipeToolName, recipePlan{
		Mode: planModeEdit, Summary: "Text corectat", Recipe: document.Document{Mode: "modify"},
	}))
	plan, result, err := validateRecipeResponse(response, input, compiler.New(), recipeAnalysis{}, "Repară codificarea captions existente", recipeProject(input, 0))
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Recipe.After) != 0 || len(plan.Recipe.Before) != 0 || len(result.Requirements) != 0 {
		t.Fatal("encoding repair queued unnecessary generation")
	}
	if result.Composition == nil || result.Composition.TextItems[0].Text != "și" || result.Composition.TextItems[0].Words[0].Text != "și" {
		t.Fatalf("AI recipe retained damaged captions: %+v", result)
	}
}

func TestCaptionEncodingRepairDoesNotBecomeGeneration(t *testing.T) {
	for _, instruction := range []string{
		"Repară codificarea captions existente", "Corectează diacriticele subtitrării",
		"Fix caption encoding", "Repair mojibake in subtitles", "Restore UTF-8 in captions",
	} {
		selection := ensureRecipeFamilies(toolSelection{}, instruction)
		if !oneOf(familyText, selection.Families...) || oneOf(familyCaption, selection.Families...) {
			t.Errorf("text repair selected new caption generation for %q: %+v", instruction, selection)
		}
		doc := document.Document{}
		ensureRecipeCaptions(&doc, instruction)
		if len(doc.After) != 0 {
			t.Errorf("text repair added a paid job for %q", instruction)
		}
	}
	for _, instruction := range []string{"Generează captions cu diacritice corecte", "Add Romanian captions", "Pune subtitrări"} {
		doc := document.Document{}
		ensureRecipeCaptions(&doc, instruction)
		if len(doc.After) != 1 || doc.After[0].Type != "captions.generate" {
			t.Errorf("new captions were suppressed for %q: %+v", instruction, doc)
		}
	}
}

func TestCaptionEncodingRepairRejectsModelProposedPaidRetries(t *testing.T) {
	for _, kind := range []string{"captions.generate", "analysis.transcribe", "speech.generate"} {
		input := dslTestInput()
		input.Snapshot = testSnapshotWithClip()
		response := dslTestResponse(dslCall("1", recipeToolName, recipePlan{
			Mode: planModeEdit, Summary: "Repair", Recipe: document.Document{Mode: "modify", After: []document.Job{{ID: "retry", Type: kind}}},
		}))
		_, _, err := validateRecipeResponse(response, input, compiler.New(), recipeAnalysis{}, "Repară codificarea captions existente", recipeProject(input, 0))
		if err == nil || !strings.Contains(err.Error(), "omit new transcription and speech jobs") {
			t.Errorf("encoding repair accepted paid %s: %v", kind, err)
		}
	}
}
