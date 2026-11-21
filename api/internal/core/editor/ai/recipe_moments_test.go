package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/subtitles"
	"ffmpeg-go-server/internal/integrations/openrouter"

	"github.com/gofiber/fiber/v2"
)

const twoMinuteEdit = "cut and let only important parts (final video must be around 2 minutes), add 2s random transitions, a random zoom style, captions in romanian"

func twoMinuteInput() compiler.Input {
	video := document.Clip{ID: "video", AssetID: "source", Start: 0, InPoint: 0, OutPoint: 763 * document.Second, PlaybackRate: 1, Volume: 100, Opacity: 1, Transform: document.IdentityTransform(), LinkedClipID: "audio"}
	audio := video
	audio.ID, audio.LinkedClipID = "audio", "video"
	return compiler.Input{
		Document: document.Document{Version: 3, Mode: "assemble", Output: document.Output{Aspect: "landscape", Resolution: "1080p", FPS: 30, Format: "mp4", Quality: "normal"}},
		Snapshot: &composition.Snapshot{Revision: "r1", SelectedIDs: []string{"video"}, Tracks: []document.Track{{ID: "v1", Type: "video", Clips: []document.Clip{video}}, {ID: "a1", Type: "audio", Clips: []document.Clip{audio}}}},
		Assets:   []document.Asset{{ID: "source", File: "recording.mp4", Kind: "video", Duration: 763 * document.Second, Version: "v1", HasAudio: true}},
	}
}

func threeSpokenMoments() recipeAnalysis {
	result := recipeAnalysis{Requested: true, segments: map[string][]subtitles.TranscriptSegment{"video": {}}}
	for index, pair := range [][2]float64{{100, 142}, {300, 342}, {650, 690}} {
		result.Moments = append(result.Moments, recipeMoment{ID: fmt.Sprintf("m%03d", index+1), ClipID: "video", From: document.Seconds(pair[0]), To: document.Seconds(pair[1]), Text: "Meaningful recorded speech"})
		result.segments["video"] = append(result.segments["video"], subtitles.TranscriptSegment{Start: pair[0], End: pair[1], Text: "Meaningful recorded speech"})
	}
	return result
}

func TestRecipeNormalizesModelErrorsBeforeCompilation(t *testing.T) {
	input := twoMinuteInput()
	analysis := threeSpokenMoments()
	model := dslTestResponse(dslCall("1", recipeToolName, map[string]any{
		"mode": "execute", "summary": "Summarize the recording", "moments": []map[string]any{{"id": "m001", "score": 90}, {"id": "m002", "score": 80}, {"id": "m003", "score": 70}},
		"recipe": map[string]any{"mode": "modify", "montage": map[string]any{
			"target":         map[string]any{"kind": "clip", "selected": true},
			"targetDuration": 0.002, "tolerance": 5,
			"ranges":     []map[string]any{{"clipId": "video", "from": 101.33, "to": 140.99}},
			"candidates": []map[string]any{{"clipId": "video", "from": 300.18, "to": 342}},
		}, "after": []map[string]any{{"id": "captions", "type": "captions.generate", "language": "en"}}},
	}))
	plan, result, err := validateRecipeResponse(model, input, compiler.New(), analysis, twoMinuteEdit, recipeProject(input, 0))
	if err != nil {
		t.Fatal(err)
	}
	if result.Composition != nil || len(result.Requirements) != 1 {
		t.Fatalf("expected a valid, pending caption job: %+v", result)
	}
	m := plan.Recipe.Montage
	if m.TargetDuration != 120*document.Second || m.Between == nil || m.Between.Duration != 2*document.Second || !m.Between.Random || m.Motion == nil || m.Motion.Family != "zoom" {
		t.Fatalf("model timing/style was not normalized: %+v", m)
	}
	if len(m.Ranges) != 0 || len(m.Candidates) != 3 || m.Target.Kind != "video" || len(m.Target.IDs) != 1 || m.Target.IDs[0] != "video" {
		t.Fatalf("model target/timestamps were trusted: %+v", m)
	}
	if plan.Recipe.After[0].Language != "ro" || plan.Recipe.After[0].Input != "montage" {
		t.Fatalf("caption request was not preserved: %+v", plan.Recipe.After)
	}
}

func TestRecipeBuildsEnoughCandidatesWhenModelSelectsTooFew(t *testing.T) {
	input := twoMinuteInput()
	analysis := recipeAnalysis{Requested: true, segments: map[string][]subtitles.TranscriptSegment{"video": {}}}
	for index := 0; index < 40; index++ {
		from := float64(index * 15)
		analysis.Moments = append(analysis.Moments, recipeMoment{ID: fmt.Sprintf("m%03d", index+1), ClipID: "video", From: document.Seconds(from), To: document.Seconds(from + 12), Text: "Coherent sentence"})
		analysis.segments["video"] = append(analysis.segments["video"], subtitles.TranscriptSegment{Start: from, End: from + 12, Text: "Coherent sentence"})
	}
	model := dslTestResponse(dslCall("1", recipeToolName, map[string]any{
		"mode": "execute", "summary": "Select the highlights", "moments": []map[string]any{{"id": "m004", "score": 95}},
		"recipe": map[string]any{"mode": "modify", "montage": map[string]any{"target": map[string]any{"kind": "video"}, "targetDuration": 0.002}},
	}))
	plan, result, err := validateRecipeResponse(model, input, compiler.New(), analysis, twoMinuteEdit, recipeProject(input, 0))
	if err != nil {
		t.Fatal(err)
	}
	if result.Composition != nil || len(result.Requirements) != 1 {
		t.Fatalf("caption job was not scheduled: %+v", result)
	}
	preview := input
	preview.Document = plan.Recipe
	preview.Document.After = nil
	compiled := compiler.New().Compile(preview)
	if compiled.Composition == nil || compiled.Composition.Duration < 115*document.Second || compiled.Composition.Duration > 125*document.Second {
		t.Fatalf("edit did not reach 2 minutes: %+v", compiled)
	}
	if len(plan.Recipe.Montage.Candidates) != 40 || plan.Recipe.Montage.Candidates[3].Score != 95 {
		t.Fatalf("model choices were not ranked against full evidence: %+v", plan.Recipe.Montage.Candidates)
	}
}

func TestRecipeGroupsTranscriptWithoutFillerOrPartialBoundaries(t *testing.T) {
	segments := []subtitles.TranscriptSegment{
		{Start: 0, End: 1, Text: "Thank you."}, {Start: 10, End: 15, Text: "The first complete idea"},
		{Start: 16, End: 21, Text: "continues to its conclusion"}, {Start: 30, End: 31, Text: "Bye."},
		{Start: 40, End: 48, Text: "Another meaningful sentence"},
	}
	moments := groupRecipeMoments("video", segments, 0)
	if len(moments) != 2 || moments[0].From != 10*document.Second || moments[0].To != 21*document.Second || moments[1].From != 40*document.Second {
		t.Fatalf("invalid moment boundaries: %+v", moments)
	}
	if strings.Contains(strings.ToLower(moments[0].Text), "thank you") {
		t.Fatal("filler leaked into the ranked moment")
	}
}

func TestFinalDurationAndTransitionAreSeparate(t *testing.T) {
	duration, ok := requestedFinalDuration(twoMinuteEdit)
	if !ok || duration != 120*document.Second {
		t.Fatalf("final duration=%v, found=%t", duration, ok)
	}
	transition, ok := requestedMontageTransition(twoMinuteEdit)
	if !ok || transition != 2*document.Second {
		t.Fatalf("transition=%v, found=%t", transition, ok)
	}
}

func TestExplicitSourceRangeIsPreserved(t *testing.T) {
	analysis := threeSpokenMoments()
	input := twoMinuteInput()
	instruction := "keep the source from 101s to 140s"
	montage := document.Montage{
		Target: document.Selector{Kind: "clip", Selected: true},
		Ranges: []document.MontageRange{{ClipID: "video", From: 101 * document.Second, To: 140 * document.Second}},
	}
	if !hasExplicitSourceRanges(instruction) {
		t.Fatal("explicit source window not detected")
	}
	if err := resolveRecipeMontage(&montage, nil, analysis, instruction, recipeProject(input, 0)); err != nil {
		t.Fatal(err)
	}
	if err := validateRecipeEvidence(montage, analysis, true); err != nil {
		t.Fatal(err)
	}
	if len(montage.Ranges) != 1 || montage.Ranges[0].From != 101*document.Second || len(montage.Candidates) != 0 {
		t.Fatalf("explicit range was rewritten: %+v", montage)
	}
}

func TestEditCompositionUsesMomentIDsAndReturnsPendingCaptionRecipe(t *testing.T) {
	previous := analyzeRecipeWindow
	analyzeRecipeWindow = func(_ context.Context, _, _ string, start, duration float64, language string) ([]subtitles.TranscriptSegment, error) {
		if start != 0 || duration != 763 || language != "ro" {
			t.Errorf("unexpected analysis window or language: %v %v %s", start, duration, language)
		}
		return threeSpokenMoments().segments["video"], nil
	}
	defer func() { analyzeRecipeWindow = previous }()
	mockJevRouter(t, toolSelection{Families: []string{familyCut}, Analysis: analysisScope{NeedTranscript: true}})
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		if len(request.Tools) != 1 || request.Tools[0].Function.Name != recipeToolName || request.Reasoning == nil || request.MaxTokens == 0 {
			t.Errorf("not a bounded DSL request: %+v", request)
		}
		recipeFields := request.Tools[0].Function.Parameters["properties"].(map[string]any)["recipe"].(map[string]any)["properties"].(map[string]any)
		montageFields := recipeFields["montage"].(map[string]any)["properties"].(map[string]any)
		if required := request.Tools[0].Function.Parameters["required"].([]any); len(required) != 4 {
			t.Errorf("automatic montage must require ranked moment IDs: %+v", required)
		}
		if _, exists := montageFields["candidates"]; exists {
			t.Error("automatic edit schema still asks the model to copy transcript timestamps")
		}
		if !strings.Contains(request.Messages[1].TextContent(), `"id":"m001"`) {
			t.Error("analyzed moment IDs not in prompt")
		}
		writeToolCallResponse(t, w, "recipe-1", recipeToolName, `{"mode":"execute","summary":"Two-minute highlights with zoom, transitions and Romanian captions","moments":[{"id":"m001","score":95},{"id":"m002","score":90},{"id":"m003","score":80}],"recipe":{"mode":"modify","montage":{"target":{"kind":"clip","selected":true},"targetDuration":0.002,"candidates":[{"clipId":"video","from":101.2,"to":141.9}],"ranges":[{"clipId":"video","from":300.1,"to":342}]}}}`)
	}))
	defer provider.Close()
	t.Setenv("OPENROUTER_API_KEY", "secret")
	t.Setenv("OPENROUTER_MODEL", "test/model")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL)
	input := twoMinuteInput()
	payload, err := json.Marshal(map[string]any{"instruction": twoMinuteEdit, "project": input, "playhead": 0})
	if err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Post("/ai/compositions", EditComposition)
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/compositions", bytes.NewReader(payload)))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result recipeResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK || calls != 1 || len(result.Requirements) != 1 || len(result.Recipe.Montage.Candidates) != 3 {
		t.Fatalf("status=%d model calls=%d result=%+v", response.StatusCode, calls, result)
	}
	if result.Recipe.Montage.TargetDuration != 120*document.Second || result.Recipe.After[0].Language != "ro" || result.Recipe.Montage.Between.Duration != 2*document.Second {
		t.Fatalf("explicit instruction was not preserved: %+v", result.Recipe)
	}
}
