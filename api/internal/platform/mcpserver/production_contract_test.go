package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

func contractFixture(yaml string) (composition.Composition, productionContract) {
	clip := editorialClip("mechanism", 0, 4)
	plan := composition.Composition{Assets: []document.Asset{{ID: clip.AssetID, Version: "sha256:source"}}, Tracks: []document.Track{{ID: "main", Type: "video", Clips: []document.Clip{clip}}}}
	contract := productionContract{Version: 1, CompositionVersion: contentVersion([]byte(yaml)), Beats: []productionBeat{{
		ID: "engagement", ClipID: clip.ID, AssetVersion: "sha256:source", Start: 0, End: 4,
		Message: "The signal engages the mechanism", Subject: "Signal and receiver", Action: "Signal travels into receiver", Objects: []string{"signal", "receiver"},
		Phases:     []productionPhase{{"reveal", 0}, {"action", 1}, {"hold", 2.5}, {"exit", 3.8}},
		Treatments: []productionTreatment{{Kind: "none", Start: 0, Duration: 4, Reason: "Keep attention on the internal explanatory movement"}},
	}}}
	return plan, contract
}

func TestContractTreatmentIntervalsUseTimelineMicroseconds(t *testing.T) {
	_, contract := contractFixture("recipe")
	beat := &contract.Beats[0]
	beat.End = 0.3
	beat.Phases = []productionPhase{{"reveal", 0}, {"action", 0.1}, {"hold", 0.2}, {"exit", 0.3}}
	beat.Treatments = []productionTreatment{{Kind: "none", Start: 0.1, Duration: 0.2, Reason: "Hold the measured action"}}
	if err := contract.validate(); err != nil {
		t.Fatal("binary floating point rejected a valid microsecond interval", err)
	}
	beat.Treatments[0].Duration = 0.20001
	var field *contractValidationError
	if err := contract.validate(); !errors.As(err, &field) || field.diagnostic.Path != "productionContract.beats[0].treatments[0].duration" || field.diagnostic.Code != "treatment_outside_beat" || !strings.Contains(field.diagnostic.Message, "[0.000000, 0.300000]") {
		t.Fatal("missing actionable interval diagnostic", err)
	}
}

func TestContractSchemaExposesConcretePhaseAndTreatmentFields(t *testing.T) {
	schema := compositionToolSchema()
	contract := schema.Properties["productionContract"]
	beat := contract.Properties["beats"].Items
	phase := beat.Properties["phases"].Items
	treatment := beat.Properties["treatments"].Items
	if phase.Properties["at"].Type != "number" || phase.Properties["kind"].Type != "string" || len(phase.Properties["kind"].Enum) != 4 || treatment.Properties["duration"].Type != "number" || len(treatment.Properties["kind"].Enum) != 6 {
		t.Fatal("opaque production contract input schema", schema)
	}
}

func TestInvalidContractIntervalReturnsStructuredFieldDiagnostic(t *testing.T) {
	_, contract := contractFixture("recipe")
	contract.Beats[0].Treatments[0].Duration = 99
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("invalid contract reached API")
		return Response{}, nil
	})
	result, output := callTool(t, handler, "compile_recipe", map[string]any{"projectId": "owned", "composition": "recipe", "productionContract": contract})
	if !result.IsError || output.StatusCode != 422 {
		t.Fatal(result, output)
	}
	diagnostics := output.Data.(map[string]any)["diagnostics"].([]any)
	diagnostic := diagnostics[0].(map[string]any)
	if diagnostic["path"] != "productionContract.beats[0].treatments[0].duration" || diagnostic["code"] != "treatment_outside_beat" {
		t.Fatal(diagnostic)
	}
}

func productionOutput(t *testing.T, yaml string, plan composition.Composition, contract *productionContract) productionReview {
	t.Helper()
	data, err := json.Marshal(composition.Result{Composition: &plan})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	output := attachProductionReview(Output{StatusCode: 200, Data: fields}, yaml, contract)
	return output.Data.(map[string]any)["productionReview"].(productionReview)
}

func TestProductionContractPinsExactYAMLAndNeverClaimsAestheticApproval(t *testing.T) {
	plan, contract := contractFixture("version: 1\n")
	if err := contract.validate(); err != nil {
		t.Fatal(err)
	}
	review := productionOutput(t, "version: 1\n", plan, &contract)
	if review.Status != "review_required" || review.VisualInspection || review.ContractVersion == "" || review.TotalFindings != 0 {
		t.Fatal(review)
	}
	stale := productionOutput(t, "version: 1\n# edited\n", plan, &contract)
	if stale.Status != "revision_required" || stale.Findings[0].Code != "stale_contract" {
		t.Fatal(stale)
	}
	without := productionOutput(t, "version: 1\n", plan, nil)
	if without.Status != "contract_required" || without.CompositionVersion != review.CompositionVersion {
		t.Fatal(without)
	}
}

func TestProductionContractDetectsSourceTimingTreatmentAndHandoffOmissions(t *testing.T) {
	plan, contract := contractFixture("recipe")
	beat := &contract.Beats[0]
	beat.AssetVersion = "changed"
	beat.End = 5
	beat.Treatments = []productionTreatment{{Kind: "effect", Preset: "glow", Start: 1, Duration: 1}}
	beat.Handoff = &productionHandoff{NextBeatID: "missing", ObjectID: "signal"}
	review := productionOutput(t, "recipe", plan, &contract)
	for _, code := range []string{"stale_beat_asset", "beat_outside_clip", "missing_promised_treatment", "broken_object_handoff"} {
		if !slices.ContainsFunc(review.Findings, func(d document.Diagnostic) bool { return d.Code == code }) {
			t.Errorf("missing %s in %+v", code, review.Findings)
		}
	}
}

func TestProductionContractMatchesExactExpandedEffectsAndMotivatedCuts(t *testing.T) {
	plan, contract := contractFixture("recipe")
	plan.Effects = []document.EffectBlock{{ID: "accent", TrackID: "main", OwnerClipID: "mechanism", Preset: "glow", Start: document.Seconds(1), Duration: document.Seconds(0.25)}}
	plan.Tracks[0].Clips = append(plan.Tracks[0].Clips, editorialClip("next", 4, 2))
	contract.Beats[0].Treatments = []productionTreatment{{Kind: "effect", Preset: "glow", Start: 1, Duration: 0.25}, {Kind: "cut", Start: 4, Reason: "Move to the result"}}
	review := productionOutput(t, "recipe", plan, &contract)
	if review.TotalFindings != 0 {
		t.Fatal(review)
	}
	contract.Beats[0].Treatments[0].Duration = 0.5
	if productionOutput(t, "recipe", plan, &contract).Status != "revision_required" {
		t.Fatal("incorrect effect interval accepted")
	}
}

func TestInvalidContractsAreRejectedBeforeDispatch(t *testing.T) {
	_, contract := contractFixture("recipe")
	contract.Beats[0].Phases[1].At = 99
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("invalid contract reached API")
		return Response{}, nil
	})
	result, _ := callTool(t, handler, "compile_recipe", map[string]any{"projectId": "owned", "composition": "recipe", "productionContract": contract})
	if !result.IsError {
		t.Fatal("invalid phase accepted")
	}
}

func TestPaidSubmissionRejectsStaleReviewBeforeDispatch(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("stale review submitted paid work")
		return Response{}, nil
	})
	result, _ := callTool(t, handler, "render_video", map[string]any{"projectId": "owned", "composition": "changed", "idempotencyKey": "one", "userApproved": true, "expectedCompositionVersion": contentVersion([]byte("original"))})
	if !result.IsError {
		t.Fatal("stale review accepted")
	}
}

func TestContractDetailsRemainBounded(t *testing.T) {
	review := productionReview{Findings: []document.Diagnostic{}}
	for range maxContractFindings + 1 {
		review.add("missing", "beat", "missing")
	}
	if !review.Truncated || len(review.Findings) != maxContractFindings || review.TotalFindings != maxContractFindings+1 {
		t.Fatal(review)
	}
	_, contract := contractFixture("recipe")
	contract.Beats[0].Action = strings.Repeat("x", maxContractText+1)
	if contract.validate() == nil {
		t.Fatal("unbounded contract copy accepted")
	}
}

func TestProductionContractMatchesJunctionsBeyondEditorialResponseSample(t *testing.T) {
	plan, contract := contractFixture("recipe")
	clips := make([]document.Clip, 0, editorialDetailLimit+10)
	for i := range editorialDetailLimit + 10 {
		id := "clip-" + strconv.Itoa(i)
		if i == editorialDetailLimit+5 {
			id = "mechanism"
		}
		clips = append(clips, editorialClip(id, float64(i*4), 4))
	}
	plan.Tracks[0].Clips = clips
	start := float64((editorialDetailLimit + 5) * 4)
	beat := &contract.Beats[0]
	beat.Start, beat.End = start, start+4
	for i := range beat.Phases {
		beat.Phases[i].At += start
	}
	beat.Treatments = []productionTreatment{{Kind: "cut", Start: start + 4, Reason: "Continue the explanation"}}
	if err := contract.validate(); err != nil {
		t.Fatal(err)
	}
	if review := productionOutput(t, "recipe", plan, &contract); review.TotalFindings != 0 {
		t.Fatal("complete plan was confused with truncated inventory", review)
	}
}
