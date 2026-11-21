package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"
	"ffmpeg-go-server/internal/integrations/typesafe"
)

func TestParseJevToolSelectionKeepsMultipleFamiliesAndAnalysis(t *testing.T) {
	response := jevResponse(toolSelection{Families: []string{familyCut, familyCaption, familyText}, Analysis: analysisScope{NeedTranscript: true}})
	selection, err := parseJevToolSelection(response)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(selection.Families, ",") != "cut,text,caption" || selection.Analysis.NeedSignals || selection.Analysis.NeedVision || !selection.Analysis.NeedTranscript {
		t.Fatalf("selection = %+v", selection)
	}
}

func TestJevRoutingOnlyRequestsTranscriptAnalysis(t *testing.T) {
	request := buildJevRoutingRequest("Keep the spoken highlights", project{}, "typesafe/jev-1.13")
	if len(request.Questions) != len(familyDecisions)+1 || request.Questions["analysis_transcript"].Type != "noul" {
		t.Fatalf("questions = %+v", request.Questions)
	}
	for _, key := range []string{"analysis_signals", "analysis_vision"} {
		if _, exists := request.Questions[key]; exists {
			t.Fatalf("unexpected analysis question %s", key)
		}
	}

	response := jevResponse(toolSelection{Families: []string{familyCut}, Analysis: analysisScope{NeedTranscript: true}})
	yes := 0.99
	response.Answers["analysis_signals"] = typesafe.Answer{Type: "noul", Noul: &yes}
	response.Answers["analysis_vision"] = typesafe.Answer{Type: "noul", Noul: &yes}
	selection, err := parseJevToolSelection(response)
	if err != nil {
		t.Fatal(err)
	}
	if selection.Analysis != (analysisScope{NeedTranscript: true}) {
		t.Fatalf("unsolicited analysis decisions must be ignored: %+v", selection.Analysis)
	}
}

func TestSelectedSourceHighlightsCanUseNamedClipsForTransitions(t *testing.T) {
	project := analysisValidationProject()
	project.Focus.SelectedClipIDs = []string{"clip"}
	selection := toolSelection{Families: []string{familyCut, familyTransition}, Analysis: analysisScope{NeedTranscript: true}}
	withMedia := allowMediaForTimelineHighlights(selection, project)
	if !oneOf(familyMedia, withMedia.Families...) {
		t.Fatalf("highlight transitions need source clips with stable resultIds: %+v", withMedia.Families)
	}
	if oneOf(familyMedia, selection.Families...) {
		t.Fatal("the original selection was mutated")
	}
	if got := allowMediaForTimelineHighlights(toolSelection{Families: []string{familyCut, familyTransition}}, project); oneOf(familyMedia, got.Families...) {
		t.Fatal("metadata-only cuts must not add media")
	}
	project.Focus.SelectedClipIDs = nil
	if got := allowMediaForTimelineHighlights(selection, project); !oneOf(familyMedia, got.Families...) {
		t.Fatal("single timeline video without selection needs named clips for transitions")
	}
	project.Tracks[0].Clips = append(project.Tracks[0].Clips, clip{ID: "other"})
	if got := allowMediaForTimelineHighlights(selection, project); oneOf(familyMedia, got.Families...) {
		t.Fatal("multiple unselected timeline videos must not imply one highlight source")
	}
}

func TestBuildExecutorToolsFiltersToSelectedFamilies(t *testing.T) {
	project := project{}
	tools := buildExecutorTools(project, []string{familyPreset})
	if len(tools) != 1 || tools[0].Function.Name != toolLook {
		t.Fatalf("preset tools = %+v", executorToolNames(tools))
	}
	schema, _ := json.Marshal(tools[0].Function.Parameters)
	if !strings.Contains(string(schema), "hook-punch") {
		t.Fatal("look tool must carry clip preset IDs")
	}
	if strings.Contains(string(schema), "cross-dissolve") || strings.Contains(string(schema), "Zephyr") {
		t.Fatal("look tool leaks transition/speech catalogs")
	}

	tools = buildExecutorTools(project, []string{familyCut, familyCaption, familyImage, familySpeech})
	names := executorToolNames(tools)
	for _, want := range []string{toolCut, toolCaption, toolImage, toolSpeech} {
		if !oneOf(want, names...) {
			t.Fatalf("tools = %+v, want %s", names, want)
		}
	}
}

func TestFilteredExecutorPayloadIsSmallerThanMonolith(t *testing.T) {
	project := project{Sources: []mediaSource{{ID: "FF.mp4", Name: "FF.mp4", Kind: mediaKindVideo, Duration: 100}}}
	mono, _ := json.Marshal(editTool(project).Function.Parameters)

	tools := buildExecutorTools(project, []string{familyCut})
	filtered, _ := json.Marshal(tools)
	if len(filtered) >= len(mono) {
		t.Fatalf("filtered cut payload %d is not smaller than monolith %d", len(filtered), len(mono))
	}

	inspection, _ := filteredInspectionJSON(project, []string{familyCut}, projectMediaAnalysis{})
	if strings.Contains(string(inspection), "hook-punch") || strings.Contains(string(inspection), "cross-dissolve") {
		t.Fatal("filtered inspection leaks unselected catalogs")
	}
	full, _ := inspectionJSON(project, projectMediaAnalysis{})
	if len(inspection) >= len(full) {
		t.Fatalf("filtered inspection %d is not smaller than full %d", len(inspection), len(full))
	}
	t.Logf("monolith tools=%d filtered cut tools=%d full inspection=%d filtered inspection=%d",
		len(mono), len(filtered), len(full), len(inspection))
}

func TestTranscriptOnlyExecutorContextPreservesSpeechWithLessPayload(t *testing.T) {
	segments := make([]analysisTranscriptEntry, 0, 120)
	for index := 0; index < 120; index++ {
		segments = append(segments, analysisTranscriptEntry{
			Start: float64(index * 3), End: float64(index*3 + 2), Text: "Important spoken thought", Speaker: "speaker-1",
		})
	}
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{
		SourceID: "clip", SourceName: "clip.mp4", Kind: mediaKindVideo, AnalyzedDuration: 360, Available: true,
		Audio: &analysisAudio{Transcript: segments, TranscriptComplete: true},
	}}}
	original, err := json.Marshal(analysis)
	if err != nil {
		t.Fatal(err)
	}
	inspection, err := filteredInspectionJSON(project{}, []string{familyCut, familyTransition}, analysis)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Analysis struct {
			Sources []struct {
				Audio struct {
					Transcript         [][]any `json:"transcript"`
					TranscriptComplete bool    `json:"transcriptComplete"`
				} `json:"audio"`
			} `json:"sources"`
		} `json:"analysis"`
	}
	if err := json.Unmarshal(inspection, &decoded); err != nil {
		t.Fatal(err)
	}
	entries := decoded.Analysis.Sources[0].Audio.Transcript
	if len(entries) != len(segments) || entries[0][2] != "Important spoken thought" || entries[0][3] != "speaker-1" || !decoded.Analysis.Sources[0].Audio.TranscriptComplete {
		t.Fatalf("transcript data lost: %+v", entries)
	}
	compact, err := json.Marshal(executorMediaAnalysis(analysis))
	if err != nil {
		t.Fatal(err)
	}
	if len(compact) >= len(original)*3/4 {
		t.Fatalf("transcript context was not reduced: original=%d compact=%d", len(original), len(compact))
	}
}

func TestCutAndTransitionExecutorPromptIsFocused(t *testing.T) {
	focused := executorSystemPrompt([]string{toolCut, toolTransition})
	if len(focused) >= len(systemPrompt())/2 || !strings.Contains(focused, "10-15 second") || !strings.Contains(focused, "adjacent video clips") {
		t.Fatalf("cut/transition prompt is too large or missing editing rules: %s", focused)
	}
	if strings.Contains(focused, "TEXT TO SPEECH") || strings.Contains(focused, "AI IMAGES") {
		t.Fatal("cut/transition prompt includes unrelated work")
	}
}

func multiToolResponse(calls ...openrouter.ToolCall) openrouter.ChatCompletionResponse {
	var response openrouter.ChatCompletionResponse
	response.Choices = append(response.Choices, struct {
		Index        int                        `json:"index"`
		Message      openrouter.ResponseMessage `json:"message"`
		FinishReason string                     `json:"finish_reason"`
	}{Message: openrouter.ResponseMessage{Role: "assistant", Content: json.RawMessage("null"), ToolCalls: calls}})
	return response
}

func fragmentCall(id, name, arguments string) openrouter.ToolCall {
	call := openrouter.ToolCall{ID: id, Type: "function"}
	call.Function.Name = name
	call.Function.Arguments = arguments
	return call
}

func TestMergeExecutorCallsMergesParallelFragments(t *testing.T) {
	response := multiToolResponse(
		fragmentCall("c1", toolLook, `{"mode":"execute","summary":"Vintage finish","operations":[{"type":"apply_preset","clipId":"c1","presetId":"fine-film"}]}`),
		fragmentCall("c2", toolCaption, `{"mode":"execute","summary":"Vintage finish","operations":[{"type":"add_text","start":0,"duration":3,"text":"Hook","textPresetId":"active-word"}]}`),
	)
	plan, err := mergeExecutorCalls(response)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Operations) != 2 || plan.Summary != "Vintage finish" {
		t.Fatalf("merged plan = %+v", plan)
	}
}

func TestMergeExecutorCallsRejectsCrossFamilyOperations(t *testing.T) {
	response := multiToolResponse(
		fragmentCall("c1", toolCut, `{"mode":"execute","summary":"Sneaky","operations":[{"type":"apply_preset","clipId":"c1","presetId":"fine-film"}]}`),
	)
	if _, err := mergeExecutorCalls(response); err == nil || !strings.Contains(err.Error(), "cannot carry") {
		t.Fatalf("error = %v", err)
	}

	response = multiToolResponse(fragmentCall("c1", "nope_tool", `{"mode":"execute","summary":"x"}`))
	if _, err := mergeExecutorCalls(response); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("error = %v", err)
	}
}

func TestParseJevToolSelectionRejectsInvalidResponses(t *testing.T) {
	valid := jevResponse(toolSelection{Families: []string{familyCut}})
	for _, mutate := range []func(*typesafe.Response){
		func(response *typesafe.Response) { delete(response.Answers, "tool_cut") },
		func(response *typesafe.Response) { response.Answers["tool_cut"] = typesafe.Answer{Type: "choice"} },
		func(response *typesafe.Response) { delete(response.Answers, "analysis_transcript") },
		func(response *typesafe.Response) {
			negative := -0.2
			response.Answers["tool_cut"] = typesafe.Answer{Type: "noul", Noul: &negative}
		},
		func(response *typesafe.Response) {
			zero := 0.0
			response.Answers["tool_cut"] = typesafe.Answer{Type: "noul", Noul: &zero}
		},
	} {
		response := jevResponse(toolSelection{Families: []string{familyCut}})
		mutate(&response)
		if _, err := parseJevToolSelection(response); err == nil {
			t.Fatalf("invalid Jev response must fail: %+v", response)
		}
	}
	if _, err := parseJevToolSelection(valid); err != nil {
		t.Fatal(err)
	}
}

func TestJevSelectsFamiliesIndependentlyAtDecisionThreshold(t *testing.T) {
	response := jevResponse(toolSelection{Families: []string{familyCut}})
	low, high := 0.49, 0.50
	response.Answers["tool_text"] = typesafe.Answer{Type: "noul", Noul: &high}
	response.Answers["tool_caption"] = typesafe.Answer{Type: "noul", Noul: &low}
	selection, err := parseJevToolSelection(response)
	if err != nil {
		t.Fatal(err)
	}
	if !oneOf(familyText, selection.Families...) || oneOf(familyCaption, selection.Families...) {
		t.Fatalf("independent tool decisions = %+v", selection.Families)
	}
}

func jevResponse(selection toolSelection) typesafe.Response {
	response := typesafe.Response{Model: "typesafe/jev-1.13-20260917", Answers: make(map[string]typesafe.Answer)}
	set := func(key string, selected bool) {
		probability := 0.01
		if selected {
			probability = 0.99
		}
		response.Answers[key] = typesafe.Answer{Type: "noul", Noul: &probability}
	}
	for _, family := range allExecutorFamilies {
		set("tool_"+family, oneOf(family, selection.Families...))
	}
	set("analysis_transcript", selection.Analysis.NeedTranscript)
	return response
}

func mockJevRouter(t *testing.T, selection toolSelection) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/systemone" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("unexpected Jev request: %s %s", r.URL.Path, r.Header.Get("Authorization"))
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var request typesafe.Request
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		if request.Model != "typesafe/jev-1.13" || len(request.Questions) != len(familyDecisions)+1 || request.Questions["tool_caption"].Type != "noul" || request.Questions["analysis_transcript"].Type != "noul" {
			t.Errorf("Jev routing request = %+v", request)
		}
		if err := json.NewEncoder(w).Encode(jevResponse(selection)); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(server.Close)
	t.Setenv("OPENROUTER_JEV_BASE_URL", server.URL)
	t.Setenv("OPENROUTER_JEV_MODEL", "typesafe/jev-1.13")
}

func TestParseProviderOnlyDedupesAndTrims(t *testing.T) {
	got := parseProviderOnly(" groq, groq,,deepseek ")
	if len(got) != 2 || got[0] != "groq" || got[1] != "deepseek" {
		t.Fatalf("providers = %+v", got)
	}
	if len(parseProviderOnly("  , ")) != 0 {
		t.Fatal("blank must parse to empty")
	}
}

func TestAIProviderPreferencesDefaultsToAutoRouting(t *testing.T) {
	t.Setenv("OPENROUTER_PROVIDER_ONLY", "")
	t.Setenv("OPENROUTER_PROVIDER_AUTO", "")
	if prefs := aiProviderPreferences(); prefs != nil {
		t.Fatalf("empty override must auto-route (nil), got %+v", prefs)
	}

	t.Setenv("OPENROUTER_PROVIDER_ONLY", "groq, deepseek")
	prefs := aiProviderPreferences()
	if prefs == nil || len(prefs.Only) != 2 || !prefs.AllowFallbacks {
		t.Fatalf("override prefs = %+v", prefs)
	}

	t.Setenv("OPENROUTER_PROVIDER_ONLY", "")
	t.Setenv("OPENROUTER_PROVIDER_AUTO", "false")
	prefs = aiProviderPreferences()
	if prefs == nil || len(prefs.Only) == 0 {
		t.Fatalf("legacy pool prefs = %+v", prefs)
	}
}
