package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ffmpeg-go-server/internal/core/editor/subtitles"
	"ffmpeg-go-server/internal/integrations/openrouter"
)

func TestMediaAnalysisToolHasNoModelControlledArguments(t *testing.T) {
	tool := mediaAnalysisTool()
	if tool.Function.Name != mediaAnalysisToolName {
		t.Fatalf("tool name = %q", tool.Function.Name)
	}
	if tool.Function.Parameters["additionalProperties"] != false {
		t.Fatalf("tool parameters = %+v", tool.Function.Parameters)
	}
	properties, ok := tool.Function.Parameters["properties"].(map[string]any)
	if !ok || len(properties) != 0 {
		t.Fatalf("tool properties = %+v", tool.Function.Parameters["properties"])
	}
}

func TestOrderedAnalysisSourcesDoesNotIncludeUnrelatedMedia(t *testing.T) {
	project := analysisValidationProject()
	project.Sources = append(project.Sources,
		mediaSource{ID: "other", Name: "other.mp4", Kind: mediaKindVideo, Duration: 10, TimelineClipIDs: []string{"other-clip"}},
		mediaSource{ID: "bin", Name: "bin.mp4", Kind: mediaKindVideo, Duration: 10},
	)
	project.Tracks[0].Clips = append(project.Tracks[0].Clips, clip{
		ID: "other-clip", Name: "other.mp4", SourceID: "other", MediaKind: mediaKindVideo,
		Start: 10, End: 20, SourceIn: 0, SourceOut: 10, Rate: 1,
	})
	project.Focus.SelectedClipIDs = []string{"clip"}

	selected := orderedAnalysisSources(editRequest{Instruction: "Keep the best moments", Project: project})
	if len(selected) != 1 || selected[0].ID != "source" {
		t.Fatalf("selected sources = %+v", selected)
	}

	mentioned := orderedAnalysisSources(editRequest{Instruction: "Analyze bin.mp4", Project: project})
	if len(mentioned) != 1 || mentioned[0].ID != "bin" {
		t.Fatalf("mentioned sources = %+v", mentioned)
	}
}

func TestParseVisualDiagnosticsBuildsScenesAndQualityRanges(t *testing.T) {
	output := strings.Join([]string{
		"[Parsed_metadata_5] frame:0 pts:0 pts_time:0",
		"lavfi.signalstats.YDIF=2.0",
		"[Parsed_metadata_5] frame:1 pts:1 pts_time:0.5",
		"lavfi.signalstats.YDIF=18.0",
		"[Parsed_showinfo_7] n:0 pts:5 pts_time:2.5 duration:0.5",
		"[blackdetect] black_start:3 black_end:4 black_duration:1",
		"[freezedetect] lavfi.freezedetect.freeze_start:6",
		"[freezedetect] lavfi.freezedetect.freeze_end:8",
	}, "\n")

	cuts, motion, blackRanges, freezeRanges := parseVisualDiagnostics(output, 10)
	scenes := buildScenes(cuts, motion, 10)
	if len(scenes) != 2 || scenes[0].Start != 0 || scenes[0].End != 2.5 || scenes[1].End != 10 {
		t.Fatalf("scenes = %+v", scenes)
	}
	if scenes[0].Motion <= 0 || len(blackRanges) != 1 || blackRanges[0] != (analysisTimeRange{Start: 3, End: 4}) {
		t.Fatalf("motion=%v black=%+v", scenes[0].Motion, blackRanges)
	}
	if len(freezeRanges) != 1 || freezeRanges[0] != (analysisTimeRange{Start: 6, End: 8}) {
		t.Fatalf("freeze ranges = %+v", freezeRanges)
	}
}

func TestParseAudioDiagnosticsFindsSilenceAndEnergy(t *testing.T) {
	output := strings.Join([]string{
		"[Parsed_ametadata_3] frame:0 pts:0 pts_time:0",
		"lavfi.astats.Overall.RMS_level=-30",
		"[silencedetect] silence_start:1.25",
		"[Parsed_ametadata_3] frame:1 pts:8000 pts_time:0.5",
		"lavfi.astats.Overall.RMS_level=-12",
		"[silencedetect] silence_end:2.5 | silence_duration:1.25",
	}, "\n")

	silences, energy := parseAudioDiagnostics(output, 4)
	if len(silences) != 1 || silences[0] != (analysisTimeRange{Start: 1.25, End: 2.5}) {
		t.Fatalf("silences = %+v", silences)
	}
	windows := buildEnergyWindows(energy, 4)
	if len(windows) == 0 || windows[0].Score <= 0 || windows[0].Score >= 1 {
		t.Fatalf("energy windows = %+v", windows)
	}
}

func TestContentAwareCutRejectsMiddleOfTranscriptSegment(t *testing.T) {
	project := analysisValidationProject()
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{
		SourceID:         "source",
		AnalyzedDuration: 10,
		Available:        true,
		Audio: &analysisAudio{TranscriptComplete: true, Transcript: []analysisTranscriptEntry{{
			Start: 1,
			End:   4,
			Text:  "One complete thought",
		}}},
	}}}

	invalid := editPlan{Operations: []editOperation{{
		Type: "delete_range", Start: floatPtr(2), End: floatPtr(5),
	}}}
	if err := validatePlanUsingMediaAnalysis(invalid, project, analysis); err == nil || !strings.Contains(err.Error(), "transcript segment") {
		t.Fatalf("error = %v", err)
	}

	valid := editPlan{Operations: []editOperation{{
		Type: "delete_range", Start: floatPtr(1), End: floatPtr(5),
	}}}
	if err := validatePlanUsingMediaAnalysis(valid, project, analysis); err != nil {
		t.Fatalf("aligned transcript cut: %v", err)
	}

	invalidSourceWindow := editPlan{Operations: []editOperation{{
		Type: "add_media", SourceID: "source", SourceIn: floatPtr(2), SourceOut: floatPtr(5),
	}}}
	if err := validatePlanUsingMediaAnalysis(invalidSourceWindow, project, analysis); err == nil || !strings.Contains(err.Error(), "source boundary") {
		t.Fatalf("source-window error = %v", err)
	}
}

func TestContentAwareVisualCutRequiresDetectedBoundary(t *testing.T) {
	project := analysisValidationProject()
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{
		SourceID:         "source",
		SourceName:       "clip.mp4",
		AnalyzedDuration: 10,
		Available:        true,
		Scenes: []analysisScene{
			{Start: 0, End: 4},
			{Start: 4, End: 10},
		},
	}}}

	invalid := editPlan{Operations: []editOperation{{
		Type: "delete_range", Start: floatPtr(2), End: floatPtr(4),
	}}}
	if err := validatePlanUsingMediaAnalysis(invalid, project, analysis); err == nil || !strings.Contains(err.Error(), "lacks a complete transcript or detected visual boundary") {
		t.Fatalf("error = %v", err)
	}

	valid := editPlan{Operations: []editOperation{{
		Type: "delete_range", Start: floatPtr(0), End: floatPtr(4),
	}}}
	if err := validatePlanUsingMediaAnalysis(valid, project, analysis); err != nil {
		t.Fatalf("aligned visual cut: %v", err)
	}
}

func TestContentPlanCannotEditWhenAnalysisIsUnavailable(t *testing.T) {
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{SourceID: "source"}}}
	// Partial source windows still need content: interior boundaries cannot
	// be aligned without analysis.
	partial := editPlan{Operations: []editOperation{{
		Type: "add_media", SourceID: "source", SourceIn: floatPtr(2), SourceOut: floatPtr(5),
	}}}
	if err := validatePlanUsingMediaAnalysis(partial, analysisValidationProject(), analysis); err == nil || !strings.Contains(err.Error(), "available analysis") {
		t.Fatalf("error = %v", err)
	}
	// Hallucinated captions need a transcript.
	captionText := "invented spoken words here"
	caption := editPlan{Operations: []editOperation{{
		Type: "add_text", Start: floatPtr(0), Duration: floatPtr(1), Text: &captionText, TextPresetID: "active-word",
	}}}
	if err := validatePlanUsingMediaAnalysis(caption, analysisValidationProject(), analysis); err == nil || !strings.Contains(err.Error(), "transcript") {
		t.Fatalf("error = %v", err)
	}
}

func TestMetadataOnlyPlanPassesWithoutAvailableAnalysis(t *testing.T) {
	// User scenario: "toate video-urile din media bin + tranzitie 1s + captions".
	// Full-range adds and transitions need only Media Bin metadata; only the
	// captions must wait for transcript analysis.
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{SourceID: "source"}}}
	project := analysisValidationProject()
	zero, ten, one := 0.0, 10.0, 1.0
	plan := editPlan{Operations: []editOperation{
		{Type: "add_media", SourceID: "source", ResultID: "vid1", ChannelID: "video", Start: &zero, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(true)},
		{Type: "add_transition", ChannelID: "video", LeftClipID: "clip", RightClipID: "vid1", EffectID: "cross-dissolve", Duration: &one},
		{Type: "add_text", Start: &zero, Duration: &one, Text: stringPtr("Hook")},
	}}
	if err := validatePlanUsingMediaAnalysis(plan, project, analysis); err != nil {
		t.Fatalf("metadata-only plan blocked without analysis: %v", err)
	}
}

func TestContentAwareSplitMapsTimelineToSourceTime(t *testing.T) {
	project := analysisValidationProject()
	project.Tracks[0].Clips[0].SourceIn = 1
	project.Tracks[0].Clips[0].SourceOut = 9
	project.Tracks[0].Clips[0].Rate = 2
	project.Tracks[0].Clips[0].End = 4
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{
		SourceID: "source", AnalyzedDuration: 10, Available: true,
		Audio: &analysisAudio{TranscriptComplete: true, Transcript: []analysisTranscriptEntry{{Start: 2, End: 4, Text: "Keep together"}}},
	}}}
	plan := editPlan{Operations: []editOperation{{Type: "split_clip", ClipID: "clip", Time: floatPtr(1)}}}
	if err := validatePlanUsingMediaAnalysis(plan, project, analysis); err == nil || !strings.Contains(err.Error(), "transcript segment") {
		t.Fatalf("split error = %v", err)
	}
}

func TestContentAwareBoundaryAcceptsDetectedSilenceWithoutSceneCuts(t *testing.T) {
	project := analysisValidationProject()
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{
		SourceID: "source", AnalyzedDuration: 10, Available: true,
		Scenes: []analysisScene{{Start: 0, End: 10}},
		Audio:  &analysisAudio{Silences: []analysisTimeRange{{Start: 2, End: 3}}},
	}}}
	plan := editPlan{Operations: []editOperation{{Type: "split_clip", ClipID: "clip", Time: floatPtr(2)}}}
	if err := validatePlanUsingMediaAnalysis(plan, project, analysis); err != nil {
		t.Fatalf("silence boundary: %v", err)
	}
}

func TestContentAwareWholeClipDeletionRequiresItsSourceAnalysis(t *testing.T) {
	project := analysisValidationProject()
	project.Sources = append(project.Sources, mediaSource{
		ID: "other", Name: "other.mp4", Kind: mediaKindVideo, Duration: 10, TimelineClipIDs: []string{"other-clip"},
	})
	project.Tracks[0].Clips = append(project.Tracks[0].Clips, clip{
		ID: "other-clip", Name: "other.mp4", SourceID: "other", MediaKind: mediaKindVideo,
		Start: 10, End: 20, SourceIn: 0, SourceOut: 10, Rate: 1,
	})
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{
		SourceID: "source", AnalyzedDuration: 10, Available: true,
		Audio: &analysisAudio{TranscriptComplete: true},
	}}}
	plan := editPlan{Operations: []editOperation{{Type: "delete_clip", ClipID: "other-clip"}}}
	if err := validatePlanUsingMediaAnalysis(plan, project, analysis); err == nil || !strings.Contains(err.Error(), "other.mp4") {
		t.Fatalf("delete error = %v", err)
	}
}

func TestBestEffortPlanCannotBypassContentValidation(t *testing.T) {
	project := analysisValidationProject()
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{
		SourceID: "source", AnalyzedDuration: 10, Available: true,
		Audio: &analysisAudio{TranscriptComplete: true, Transcript: []analysisTranscriptEntry{{Start: 1, End: 4, Text: "Keep together"}}},
	}}}
	zero, two, five := 0.0, 2.0, 5.0
	plan := editPlan{Summary: "Unsafe highlight", Operations: []editOperation{{
		Type: "add_media", SourceID: "source", ResultID: "highlight", ChannelID: "video",
		Start: &zero, SourceIn: &two, SourceOut: &five, IncludeAudio: boolPtr(true),
	}}}
	if fallback := buildContentAwareFallbackPlan(plan, project, "Keep the best moments", analysis); len(fallback.Operations) != 0 {
		t.Fatalf("unsafe fallback = %+v", fallback)
	}
}

func TestInspectionIncludesOnlyRequestedMediaAnalysis(t *testing.T) {
	project := analysisValidationProject()
	withoutAnalysis, err := inspectionJSON(project, projectMediaAnalysis{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(withoutAnalysis), `"analysis"`) {
		t.Fatalf("unexpected analysis payload: %s", withoutAnalysis)
	}

	withAnalysis, err := inspectionJSON(project, projectMediaAnalysis{Requested: true, Limitations: []string{"test limitation"}})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(withAnalysis, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded["analysis"]) == 0 || !strings.Contains(string(decoded["analysis"]), "test limitation") {
		t.Fatalf("analysis payload = %s", withAnalysis)
	}
}

func TestHighlightPlanUsesSessionFramesAndSpeechToCutTimeline(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "clip.mp4")
	if err := os.WriteFile(path, []byte("cached media"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENROUTER_VISION_MODEL", "vision/model")
	t.Setenv("OPENROUTER_STT_MODEL", "stt/model")
	instruction := "Pastreaza doar partile importante din clip.mp4"
	scope := fullAnalysisScope()
	key := mediaAnalysisCacheKey(path, info, mediaKindVideo, 10, scope)
	storeCachedMediaAnalysis(key, sourceMediaAnalysis{
		Available: true, AnalyzedDuration: 10,
		Scenes: []analysisScene{{Start: 0, End: 4}, {Start: 4, End: 10}},
		Frames: []frameObservation{{SourceTime: 6, Description: "the main demonstration", Importance: 0.9, Quality: 0.9}},
		Audio: &analysisAudio{TranscriptComplete: true, Transcript: []analysisTranscriptEntry{
			{Start: 0, End: 4, Text: "setup"},
			{Start: 4, End: 10, Text: "the most important result"},
		}},
	})
	t.Cleanup(func() {
		analysisCache.Lock()
		delete(analysisCache.entries, key)
		analysisCache.Unlock()
	})

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			return
		}
		context := payload.Messages[1].TextContent()
		for _, evidence := range []string{"main demonstration", "most important result", `"representativeFrames"`, `"transcript"`} {
			if !strings.Contains(context, evidence) {
				t.Errorf("missing %q from executor context", evidence)
			}
		}
		writeToolCallResponse(t, w, "cut-1", toolCut, `{"mode":"execute","summary":"Kept the important result","operations":[{"type":"delete_range","start":0,"end":4}]}`)
	}))
	defer provider.Close()
	client := openrouter.Client{APIKey: "secret", BaseURL: provider.URL, HTTPClient: provider.Client()}
	project := analysisValidationProject()
	project.FPS, project.Aspect = 30, "landscape"
	request := editRequest{Instruction: instruction, Project: project}
	analysis := analyzeProjectMediaScoped(context.Background(), client, request, scope, analysisMediaLocation{root: root})
	if len(analysis.Sources) != 1 || len(analysis.Sources[0].Frames) != 1 || analysis.Sources[0].Audio == nil || len(analysis.Sources[0].Audio.Transcript) != 2 {
		t.Fatalf("session analysis = %+v", analysis)
	}
	selection := toolSelection{Families: []string{familyCut}, Analysis: scope}
	plan, err := runExecutorOnce(context.Background(), client, "edit/model", nil, request, selection, analysis, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateExecutorPlan(plan, request, analysis); err != nil {
		t.Fatalf("invalid content-aware plan: %v", err)
	}
	if len(plan.Operations) != 1 || plan.Operations[0].Type != "delete_range" || *plan.Operations[0].End != 4 {
		t.Fatalf("highlight cut = %+v", plan.Operations)
	}
}

func TestMediaAnalysisCacheSeparatesVisionAndTranscriptScopes(t *testing.T) {
	info, err := os.Stat(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	audioOnly := mediaAnalysisCacheKey("clip.mp4", info, mediaKindVideo, 10, analysisScope{NeedSignals: true, NeedTranscript: true})
	withFrames := mediaAnalysisCacheKey("clip.mp4", info, mediaKindVideo, 10, fullAnalysisScope())
	if audioOnly == withFrames {
		t.Fatal("audio-only analysis must not hide later frame analysis")
	}
	visionOnly := mediaAnalysisCacheKey("clip.mp4", info, mediaKindVideo, 10, analysisScope{NeedVision: true})
	visionWithSignals := mediaAnalysisCacheKey("clip.mp4", info, mediaKindVideo, 10, analysisScope{NeedSignals: true, NeedVision: true})
	if visionOnly == visionWithSignals {
		t.Fatal("vision-only analysis must not cache as vision plus signals")
	}
}

func TestTranscriptOnlyAnalysisKeepsWordsWithoutAudioSignals(t *testing.T) {
	result := sourceMediaAnalysis{}
	signals := mediaSignalResults{
		transcriptionConfigured: true,
		transcript:              []subtitles.TranscriptSegment{{Start: 1, End: 3, Text: "important words"}},
	}
	applyAudioResults(&result, mediaSource{Kind: mediaKindVideo}, signals, analysisScope{NeedTranscript: true})
	if result.Audio == nil || len(result.Audio.Transcript) != 1 || result.Audio.Transcript[0].Text != "important words" || !result.Audio.TranscriptComplete {
		t.Fatalf("transcript-only result = %+v", result.Audio)
	}
	if len(result.Audio.Energy) != 0 || len(result.Audio.Silences) != 0 {
		t.Fatalf("transcript-only result must not contain signals: %+v", result.Audio)
	}
}

func TestTranscriptHighlightsCanUseNamedClipsForTransitions(t *testing.T) {
	project := analysisValidationProject()
	project.Duration = 45
	project.Sources[0].Duration = 45
	project.Tracks[0].Clips[0].End = 45
	project.Tracks[0].Clips[0].SourceOut = 45
	analysis := projectMediaAnalysis{Requested: true, Sources: []sourceMediaAnalysis{{
		SourceID: "source", AnalyzedDuration: 45, Available: true,
		Audio: &analysisAudio{TranscriptComplete: true, Transcript: []analysisTranscriptEntry{
			{Start: 0, End: 12, Text: "first thought"},
			{Start: 15, End: 27, Text: "second thought"},
			{Start: 30, End: 42, Text: "final thought"},
		}},
	}}}
	includeAudio := true
	plan := editPlan{Mode: planModeEdit, Summary: "Selected three highlights with transitions", Operations: []editOperation{
		{Type: "delete_clip", ClipID: "clip"},
		{Type: "add_media", SourceID: "source", ResultID: "part1", ChannelID: "video", Start: floatPtr(0), SourceIn: floatPtr(0), SourceOut: floatPtr(12), IncludeAudio: &includeAudio},
		{Type: "add_media", SourceID: "source", ResultID: "part2", ChannelID: "video", Start: floatPtr(10), SourceIn: floatPtr(15), SourceOut: floatPtr(27), IncludeAudio: &includeAudio},
		{Type: "add_media", SourceID: "source", ResultID: "part3", ChannelID: "video", Start: floatPtr(20), SourceIn: floatPtr(30), SourceOut: floatPtr(42), IncludeAudio: &includeAudio},
		{Type: "add_transition", ChannelID: "video", LeftClipID: "part1", RightClipID: "part2", EffectID: "cross-dissolve", Duration: floatPtr(2)},
		{Type: "add_transition", ChannelID: "video", LeftClipID: "part2", RightClipID: "part3", EffectID: "wipe-left", Duration: floatPtr(2)},
	}}
	if err := validateExecutorPlan(plan, editRequest{Instruction: "Summarize the important moments, use 10-15 second cuts and 2s transitions", Project: project}, analysis); err != nil {
		t.Fatalf("valid named highlight plan rejected: %v", err)
	}
	romanianInstruction := "Alege momentele cele mai importante din video-ul de pe timeline, vreau cut-uri de 10-15 secunde, si intre tranzitii de 2s, le alegi tu care sa fie. Ideea e sa ai lucrurile importante legate de virus si povestea"
	if err := validateExecutorPlan(plan, editRequest{Instruction: romanianInstruction, Project: project}, analysis); err != nil {
		t.Fatalf("valid Romanian highlight plan rejected: %v", err)
	}
}

func TestFrameAnalysisRejectsPartialToolResults(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeToolCallResponse(t, w, "vision-1", visionAnalysisToolName, `{"frames":[{"index":0,"description":"Person speaking","people":["person"],"objects":[],"actions":["speaking"],"expressions":["focused"],"ocr":[],"quality":0.8,"importance":0.7,"novelty":0.5,"reason":"Clear subject"}]}`)
	}))
	defer provider.Close()
	client := openrouter.Client{APIKey: "secret", BaseURL: provider.URL, HTTPClient: provider.Client()}
	frames := []sampledFrame{
		{Index: 0, SourceTime: 0, DataURL: "data:image/jpeg;base64,AA=="},
		{Index: 1, SourceTime: 1, DataURL: "data:image/jpeg;base64,AA=="},
	}
	if _, err := requestFrameAnalysis(context.Background(), client, "vision/model", frames); err == nil || !strings.Contains(err.Error(), "1 observations for 2 frames") {
		t.Fatalf("error = %v", err)
	}
}

func TestFrameAnalysisToleratesRepeatedIndexWithFullCoverage(t *testing.T) {
	// Small vision models sometimes repeat an index while still covering
	// every frame (3 observations for 2 frames, one repeat). Dedupe must
	// recover the batch instead of discarding the whole source analysis.
	obs := func(index int) string {
		return fmt.Sprintf(`{"index":%d,"description":"Frame %d","people":[],"objects":[],"actions":[],"expressions":[],"ocr":[],"quality":0.8,"importance":0.7,"novelty":0.5,"reason":"Clear frame"}`, index, index)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeToolCallResponse(t, w, "vision-1", visionAnalysisToolName, `{"frames":[`+obs(0)+`,`+obs(1)+`,`+obs(0)+`]}`)
	}))
	defer provider.Close()
	client := openrouter.Client{APIKey: "secret", BaseURL: provider.URL, HTTPClient: provider.Client()}
	frames := []sampledFrame{
		{Index: 0, SourceTime: 0, DataURL: "data:image/jpeg;base64,AA=="},
		{Index: 1, SourceTime: 1, DataURL: "data:image/jpeg;base64,AA=="},
	}
	observations, err := requestFrameAnalysis(context.Background(), client, "vision/model", frames)
	if err != nil {
		t.Fatal(err)
	}
	if len(observations) != 2 {
		t.Fatalf("observations = %d, want 2", len(observations))
	}
}

func TestFrameAnalysisRunsLargeBatchesConcurrently(t *testing.T) {
	framePattern := regexp.MustCompile(`Frame ([0-9]+) at source time`)
	var active, maximum int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&active, 1)
		defer atomic.AddInt32(&active, -1)
		for observed := atomic.LoadInt32(&maximum); current > observed && !atomic.CompareAndSwapInt32(&maximum, observed, current); observed = atomic.LoadInt32(&maximum) {
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			return
		}
		matches := framePattern.FindAllSubmatch(body, -1)
		observations := make([]string, 0, len(matches))
		for _, match := range matches {
			index, _ := strconv.Atoi(string(match[1]))
			observations = append(observations, fmt.Sprintf(`{"index":%d,"description":"Frame %d","people":[],"objects":[],"actions":[],"expressions":[],"ocr":[],"quality":0.8,"importance":0.7,"novelty":0.5,"reason":"Clear frame"}`, index, index))
		}
		time.Sleep(30 * time.Millisecond)
		writeToolCallResponse(t, w, "vision-batch", visionAnalysisToolName, `{"frames":[`+strings.Join(observations, ",")+`]}`)
	}))
	defer provider.Close()

	client := openrouter.Client{APIKey: "secret", BaseURL: provider.URL, HTTPClient: provider.Client()}
	frames := make([]sampledFrame, maxVisionFrames)
	for index := range frames {
		frames[index] = sampledFrame{Index: index, SourceTime: float64(index), DataURL: "data:image/jpeg;base64,AA=="}
	}
	observations, err := requestFrameAnalysis(context.Background(), client, "vision/model", frames)
	if err != nil {
		t.Fatal(err)
	}
	if len(observations) != len(frames) {
		t.Fatalf("observations = %d, want %d", len(observations), len(frames))
	}
	if atomic.LoadInt32(&maximum) < 2 {
		t.Fatalf("maximum concurrent requests = %d, want at least 2", maximum)
	}
}

func analysisValidationProject() project {
	return project{
		Duration: 10,
		Sources: []mediaSource{{
			ID: "source", Name: "clip.mp4", Kind: mediaKindVideo, Duration: 10, TimelineClipIDs: []string{"clip"},
		}},
		Tracks: []track{{
			ID: "video", Type: trackTypeVideo, Clips: []clip{{
				ID: "clip", Name: "clip.mp4", SourceID: "source", MediaKind: mediaKindVideo,
				Start: 0, End: 10, SourceIn: 0, SourceOut: 10, Rate: 1,
			}},
		}},
	}
}
