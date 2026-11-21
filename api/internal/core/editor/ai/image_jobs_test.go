package ai

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEditToolExposesDeferredImageJobs(t *testing.T) {
	parameters, err := json.Marshal(editTool(project{Sources: []mediaSource{{
		ID: "poster", Name: "poster.png", Kind: mediaKindImage, SourceMode: "proxy", Duration: 10,
	}}}).Function.Parameters)
	if err != nil {
		t.Fatal(err)
	}
	schema := string(parameters)
	for _, expected := range []string{`"imageJobs"`, `"overlay"`, `"transparent"`, `"poster.png"`} {
		if !strings.Contains(schema, expected) {
			t.Fatalf("image job schema is missing %s", expected)
		}
	}
	if strings.Contains(schema, `"b-roll"`) {
		t.Fatal("image job schema still exposes b-roll")
	}
}

func TestValidateImageJobAllowsProxyReference(t *testing.T) {
	plan := editPlan{
		Mode:    planModeRecommend,
		Summary: "Recommend a transparent overlay",
		ImageJobs: []imageJob{{
			ID: "overlay", Prompt: "A calendar", SourceName: "poster.png", Placement: "overlay",
			Position: "right", Start: 2, Duration: 4, Background: "transparent", Quality: "high", MotionPreset: "none",
		}},
		Operations: []editOperation{},
	}
	project := project{Sources: []mediaSource{{ID: "poster", Name: "poster.png", Kind: mediaKindImage, SourceMode: "proxy", Duration: 10}}}

	if err := validatePlan(plan, project); err != nil {
		t.Fatal(err)
	}
}

func TestValidateImageJobRejectsWASMReference(t *testing.T) {
	plan := editPlan{
		Mode:    planModeEdit,
		Summary: "Edit a local image",
		ImageJobs: []imageJob{{
			ID: "local", Prompt: "Make it watercolor", SourceName: "local.png", Placement: "media-bin",
			Position: "center", Start: 0, Duration: 5, Background: "auto", Quality: "high", MotionPreset: "none",
		}},
		Operations: []editOperation{},
	}
	project := project{Sources: []mediaSource{{ID: "local", Name: "local.png", Kind: mediaKindImage, SourceMode: "wasm", Duration: 10}}}

	if err := validatePlan(plan, project); err == nil || !strings.Contains(err.Error(), "Proxy image") {
		t.Fatalf("validatePlan error = %v, want Proxy image rejection", err)
	}
}

func TestBestEffortPlanDoesNotReturnInvalidImageJobs(t *testing.T) {
	plan := editPlan{
		Mode:    planModeEdit,
		Summary: "Invalid generated overlay",
		ImageJobs: []imageJob{{
			ID: "overlay", Prompt: "A calendar", Placement: "overlay", Position: "right",
			Start: 0, Duration: 5, Background: "transparent", Quality: "ultra", MotionPreset: "none",
		}},
		Operations: []editOperation{{Type: "add_text", Start: floatPtr(0), Duration: floatPtr(1), Text: stringPtr("Keep")}},
	}
	project := project{Duration: 5, Aspect: "landscape", Tracks: []track{}, Texts: []text{}}

	result := buildBestEffortPlan(
		plan,
		func(candidate editPlan) error { return validatePlan(candidate, project) },
		func(editPlan) error { return nil },
	)
	if len(result.ImageJobs) != 0 || len(result.Operations) != 0 || !strings.Contains(result.Summary, "No safe timeline changes") {
		t.Fatalf("invalid fallback returned executable work: %+v", result)
	}
}
