package ai

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"

	"github.com/gofiber/fiber/v2"
)

func TestEditToolExposesEveryClipPreset(t *testing.T) {
	if len(clipPresets) != 60 {
		t.Fatalf("clip preset count = %d, want 60", len(clipPresets))
	}

	schema, err := json.Marshal(editTool(project{}).Function.Parameters)
	if err != nil {
		t.Fatal(err)
	}
	schemaText := string(schema)
	seen := make(map[string]bool, len(clipPresets))
	for _, preset := range clipPresets {
		if seen[preset.ID] {
			t.Fatalf("duplicate clip preset %q", preset.ID)
		}
		seen[preset.ID] = true
		if !strings.Contains(schemaText, `"`+preset.ID+`"`) {
			t.Fatalf("clip preset %q is missing from the edit tool schema", preset.ID)
		}
	}
}

func TestEditToolExposesEveryShortFormTextPreset(t *testing.T) {
	if len(textPresets) != 21 {
		t.Fatalf("text preset count = %d, want 21", len(textPresets))
	}

	schema, err := json.Marshal(editTool(project{}).Function.Parameters)
	if err != nil {
		t.Fatal(err)
	}
	schemaText := string(schema)
	seen := make(map[string]bool, len(textPresets))
	for _, preset := range textPresets {
		if seen[preset.ID] {
			t.Fatalf("duplicate text preset %q", preset.ID)
		}
		seen[preset.ID] = true
		if !strings.Contains(schemaText, `"`+preset.ID+`"`) {
			t.Fatalf("text preset %q is missing from the edit tool schema", preset.ID)
		}
	}
	for _, field := range []string{`"textPresetId"`, `"isCaption"`, `"highlightMode"`, `"highlightColor"`, `"highlightBackgroundColor"`, `"highlightBackgroundOpacity"`, `"highlightAnimation"`, `"animation"`} {
		if !strings.Contains(schemaText, field) {
			t.Fatalf("active-word schema is missing %s", field)
		}
	}
}

func TestValidatePlanAllowsActiveWordAndShortFormText(t *testing.T) {
	start, duration, animationDuration := 0.0, 3.0, 0.25
	text := "Make every second count"
	isCaption := true
	highlightMode, highlightColor, animation := "word", "#fff36d", "rise"
	plan := editPlan{Operations: []editOperation{{
		Type: "add_text", Start: &start, Duration: &duration, Text: &text, TextPresetID: "active-word",
		Style: &textStyle{
			IsCaption: &isCaption, HighlightMode: &highlightMode, HighlightColor: &highlightColor,
			Animation: &animation, AnimationDuration: &animationDuration,
		},
	}}}
	project := project{Duration: 5, Aspect: "landscape", Tracks: []track{{ID: "v1", Type: "video"}}}

	if err := validatePlan(plan, project); err != nil {
		t.Fatalf("validate active-word text: %v", err)
	}
	plan.Operations[0].TextPresetID = "missing"
	if err := validatePlan(plan, project); err == nil || !strings.Contains(err.Error(), "unknown text preset") {
		t.Fatalf("unknown text preset error = %v", err)
	}
}

func TestTransitionCatalogContainsEveryCustomPreset(t *testing.T) {
	if got := len(transitionPresets); got != 76 {
		t.Fatalf("transition preset count = %d, want 76", got)
	}

	customPresets := map[string]string{
		"whip-pan-left": "custom-whip-left", "whip-pan-right": "custom-whip-right",
		"whip-pan-up": "custom-whip-up", "whip-pan-down": "custom-whip-down",
		"zoom-blur-in": "custom-zoom-blur-in", "zoom-blur-out": "custom-zoom-blur-out",
		"spin-zoom": "custom-spin-zoom", "camera-roll": "custom-camera-roll",
		"lens-warp": "custom-lens-warp", "stretch-horizontal": "custom-stretch-h",
		"stretch-vertical": "custom-stretch-v", "ripple-warp": "custom-ripple",
		"liquid-wave": "custom-liquid", "kaleidoscope-reveal": "custom-kaleidoscope",
		"rgb-split-transition": "custom-rgb-split", "digital-glitch-transition": "custom-digital-glitch",
		"vhs-tracking-transition": "custom-vhs-tracking", "datamosh-transition": "custom-datamosh",
		"tv-static-transition": "custom-tv-static", "scanline-reveal": "custom-scanline",
		"pixel-sort-reveal": "custom-pixel-sort", "light-leak-transition": "custom-light-leak",
		"film-burn-transition": "custom-film-burn", "flash-bulb-transition": "custom-flash-bulb",
		"luma-fade": "custom-luma-fade", "chroma-fade": "custom-chroma-fade",
		"ink-bleed-reveal": "custom-ink-bleed", "page-turn-2d": "custom-page-turn",
		"split-panels": "custom-split-panels", "shutter-snap": "custom-shutter-snap",
	}
	for id, wantToken := range customPresets {
		if gotToken := transitionPresets[id]; gotToken != wantToken {
			t.Errorf("transition preset %q = %q, want %q", id, gotToken, wantToken)
		}
	}
}

func TestEditCallsOpenRouterAndReturnsValidatedPlan(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.Model != "test/model" {
			t.Fatalf("unexpected model: %+v", request.Model)
		}
		if request.Provider != nil {
			t.Fatalf("default routing must auto-route (nil provider), got %+v", request.Provider)
		}
		switch calls {
		case 1:
			names := make([]string, 0, len(request.Tools))
			for _, tool := range request.Tools {
				names = append(names, tool.Function.Name)
			}
			if !slices.Contains(names, toolCut) || !slices.Contains(names, toolTrim) ||
				slices.Contains(names, toolLook) || slices.Contains(names, toolImage) {
				t.Fatalf("executor tools are not filtered to cut+trim: %+v", names)
			}
			if request.ToolChoice.Mode != "required" || !request.ParallelToolCalls || len(request.Messages) != 2 {
				t.Fatalf("unexpected planning request: %+v", request)
			}
			if strings.Contains(request.Messages[1].TextContent(), "scrubBlobUrl") {
				t.Fatal("browser media data leaked into AI context")
			}
			if !strings.Contains(request.Messages[1].TextContent(), `"catalogs"`) || !strings.Contains(request.Messages[1].TextContent(), `"project"`) {
				t.Fatalf("editor context was not sent to the model: %+v", request.Messages)
			}
			toolJSON, err := json.Marshal(request.Tools)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(toolJSON), `"const":"undo"`) {
				t.Fatal("normal edit tool exposes undo")
			}
			if !strings.Contains(string(toolJSON), `"mode"`) || !strings.Contains(string(toolJSON), `"recommend"`) {
				t.Fatal("edit tool does not expose recommendation mode")
			}
			arguments := `{"mode":"execute","summary":"Removed the pause","operations":[{"type":"delete_range","start":2,"end":4}]}`
			writeToolCallResponse(t, w, "edit-1", toolCut, arguments)
		default:
			t.Fatalf("unexpected provider call %d", calls)
		}
	}))
	defer provider.Close()

	t.Setenv("OPENROUTER_API_KEY", "secret")
	t.Setenv("OPENROUTER_MODEL", "test/model")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL)
	mockJevRouter(t, toolSelection{Families: []string{familyCut, familyTrim}})
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"Remove seconds 2 to 4","revision":"abc123","project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[{"id":"v1","type":"video","locked":false,"clips":[{"id":"c1","name":"clip.mp4","start":0,"end":10,"sourceIn":0,"sourceOut":10,"rate":1}]}],"effects":[],"texts":[]}}`
	request := httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var plan editPlan
	if err := json.NewDecoder(response.Body).Decode(&plan); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || plan.Revision != "abc123" || len(plan.Operations) != 1 || plan.Operations[0].Type != "delete_range" {
		t.Fatalf("unexpected plan: %+v", plan)
	}
}

func TestEditExecutesMediaAnalysisToolBeforePlanning(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		switch calls {
		case 1:
			names := make([]string, 0, len(request.Tools))
			for _, tool := range request.Tools {
				names = append(names, tool.Function.Name)
			}
			if !slices.Contains(names, toolCut) || !slices.Contains(names, toolAddMedia) {
				t.Fatalf("executor tools are not filtered to cut+media: %+v", names)
			}
			if request.ToolChoice.Mode != "required" {
				t.Fatalf("unexpected edit choice: %+v", request.ToolChoice)
			}
			if len(request.Messages) != 2 {
				t.Fatalf("analysis result was not folded into the executor context: %+v", request.Messages)
			}
			result := request.Messages[1].TextContent()
			if !strings.Contains(result, `"requested":true`) || !strings.Contains(result, "No analyzable Media Bin source") {
				t.Fatalf("analysis result = %s", result)
			}
			writeToolCallResponse(t, w, "edit-1", toolCut, `{"mode":"execute","summary":"No analyzable media was available.","operations":[]}`)
		default:
			t.Fatalf("unexpected provider call %d", calls)
		}
	}))
	defer provider.Close()

	t.Setenv("OPENROUTER_API_KEY", "secret")
	t.Setenv("OPENROUTER_MODEL", "test/model")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL)
	mockJevRouter(t, toolSelection{Families: []string{familyCut, familyMedia}, Analysis: analysisScope{NeedTranscript: true}})
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"Cut the boring parts","revision":"rev","project":{"duration":0,"fps":30,"aspect":"landscape","tracks":[],"effects":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK || calls != 1 {
		t.Fatalf("status = %d, provider calls = %d", response.StatusCode, calls)
	}
}

func TestEditReturnsExecutableRecommendationWithoutChangingItsMode(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		switch calls {
		case 1:
			names := make([]string, 0, len(request.Tools))
			for _, tool := range request.Tools {
				names = append(names, tool.Function.Name)
			}
			if !slices.Contains(names, toolLook) {
				t.Fatalf("preset request did not expose clip_look: %+v", names)
			}
			writeToolCallResponse(t, w, "recommend-1", toolLook, `{"mode":"recommend","summary":"Use fine-film on the selected clip for a restrained vintage finish.","operations":[{"type":"apply_preset","clipId":"c1","presetId":"fine-film"}]}`)
		default:
			t.Fatalf("unexpected provider call %d", calls)
		}
	}))
	defer provider.Close()

	t.Setenv("OPENROUTER_API_KEY", "secret")
	t.Setenv("OPENROUTER_MODEL", "test/model")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL)
	mockJevRouter(t, toolSelection{Families: []string{familyPreset}})
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"Ce preset recomanzi pentru clipul selectat?","revision":"rev","project":{"duration":10,"fps":30,"aspect":"landscape","focus":{"selectedClipIds":["c1"]},"tracks":[{"id":"v1","type":"video","locked":false,"clips":[{"id":"c1","name":"clip.mp4","mediaKind":"video","start":0,"end":10,"sourceIn":0,"sourceOut":10,"rate":1}]}],"effects":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	var plan editPlan
	if err := json.NewDecoder(response.Body).Decode(&plan); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK || calls != 1 || plan.Mode != planModeRecommend || len(plan.Operations) != 1 {
		t.Fatalf("unexpected recommendation: status=%d calls=%d plan=%+v", response.StatusCode, calls, plan)
	}
}

func TestEditRepairsOneRejectedPlan(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		switch calls {
		case 1:
			writeToolCallResponse(t, w, "edit-bad", toolCut, `{"mode":"execute","summary":"Bad range","operations":[{"type":"delete_range","start":2,"end":20}]}`)
		case 2:
			names := make([]string, 0, len(request.Tools))
			for _, tool := range request.Tools {
				names = append(names, tool.Function.Name)
			}
			if len(names) != 1 || names[0] != toolCut {
				t.Fatalf("repair did not keep the focused toolbox: %+v", names)
			}
			if len(request.Messages) != 3 || !strings.Contains(request.Messages[2].TextContent(), `"status":"rejected"`) || !strings.Contains(request.Messages[2].TextContent(), `"end":20`) {
				t.Fatalf("validation result was not returned to the model: %+v", request.Messages)
			}
			writeToolCallResponse(t, w, "edit-good", toolCut, `{"mode":"execute","summary":"Removed pause","operations":[{"type":"delete_range","start":2,"end":4}]}`)
		default:
			t.Fatalf("unexpected provider call %d", calls)
		}
	}))
	defer provider.Close()

	t.Setenv("OPENROUTER_API_KEY", "secret")
	t.Setenv("OPENROUTER_MODEL", "test/model")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL)
	mockJevRouter(t, toolSelection{Families: []string{familyCut}})
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"Remove seconds 2 to 4","revision":"abc123","project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[{"id":"v1","type":"video","locked":false,"clips":[{"id":"c1","name":"clip.mp4","start":0,"end":10,"sourceIn":0,"sourceOut":10,"rate":1}]}],"effects":[],"transitions":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK || calls != 2 {
		t.Fatalf("status = %d, provider calls = %d", response.StatusCode, calls)
	}
}

func TestEditReturnsSafeNoOpWhenRepairIsStillInvalid(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch calls {
		case 1:
			writeToolCallResponse(t, w, "edit-invalid", toolCut, `{"mode":"execute","summary":"Unsafe range","operations":[{"type":"delete_range","start":2,"end":20}]}`)
		case 2:
			writeToolCallResponse(t, w, "edit-invalid", toolCut, `{"mode":"execute","summary":"Unsafe range","operations":[{"type":"delete_range","start":2,"end":20}]}`)
		default:
			t.Fatalf("unexpected provider call %d", calls)
		}
	}))
	defer provider.Close()

	t.Setenv("OPENROUTER_API_KEY", "secret")
	t.Setenv("OPENROUTER_MODEL", "test/model")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL)
	mockJevRouter(t, toolSelection{Families: []string{familyCut}})
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"Improve this edit","revision":"abc123","project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[{"id":"v1","type":"video","locked":false,"clips":[{"id":"c1","name":"clip.mp4","start":0,"end":10,"sourceIn":0,"sourceOut":10,"rate":1}]}],"effects":[],"transitions":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK || calls != 2 {
		t.Fatalf("status = %d, provider calls = %d", response.StatusCode, calls)
	}
	var plan editPlan
	if err := json.NewDecoder(response.Body).Decode(&plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Operations) != 0 || !strings.Contains(plan.Summary, "No safe timeline changes") || !strings.Contains(plan.Summary, "invalid delete range") {
		t.Fatalf("unexpected fallback plan: %+v", plan)
	}
}

func TestBestEffortPlanNeverSalvagesUndoOrDestructiveOperations(t *testing.T) {
	start, end := 1.0, 2.0
	project := project{Duration: 4, Tracks: []track{{ID: "v1", Type: "video", Clips: []clip{{
		ID: "clip", Start: 0, End: 4, SourceIn: 0, SourceOut: 4, Rate: 1,
	}}}}}
	for _, plan := range []editPlan{
		{Summary: "Undo", Operations: []editOperation{{Type: "undo"}}},
		{Summary: "Partial delete", Operations: []editOperation{
			{Type: "delete_range", Start: &start, End: &end},
			{Type: "add_text", Start: floatPtr(0), Duration: floatPtr(1), Text: stringPtr("Replacement")},
			{Type: "delete_clip", ClipID: "missing"},
		}},
	} {
		fallback := bestEffortPlan(plan, project, "Improve this edit")
		if len(fallback.Operations) != 0 {
			t.Fatalf("unsafe fallback operations = %+v", fallback.Operations)
		}
	}
}

func TestBestEffortPlanKeepsAValidSafePrefix(t *testing.T) {
	start, duration := 0.0, 2.0
	text := "Opening"
	project := project{Duration: 4, Tracks: []track{{ID: "v1", Type: "video"}}}
	plan := editPlan{Summary: "Add an opening", Operations: []editOperation{
		{Type: "add_text", Start: &start, Duration: &duration, Text: &text},
		{Type: "add_effect", ChannelID: "missing", EffectID: "sepia", Start: &start, Duration: &duration},
	}}

	fallback := bestEffortPlan(plan, project, "Add an opening title")
	if len(fallback.Operations) != 1 || fallback.Operations[0].Type != "add_text" {
		t.Fatalf("safe fallback operations = %+v", fallback.Operations)
	}
}

func TestEditHandlesStandaloneUndoWithoutProvider(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENROUTER_MODEL", "")
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"undo last 2 edits","revision":"abc123","project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[],"effects":[],"transitions":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var plan editPlan
	if err := json.NewDecoder(response.Body).Decode(&plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Operations) != 1 || plan.Operations[0].Type != "undo" || plan.Operations[0].Count == nil || *plan.Operations[0].Count != 2 {
		t.Fatalf("unexpected plan: %+v", plan)
	}
}

func TestEditRejectsUndoCombinedWithAnotherRequest(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENROUTER_MODEL", "")
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"undo and add a title","revision":"abc123","project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[],"effects":[],"transitions":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

func TestProjectPreservesEditorContextForProvider(t *testing.T) {
	body := `{"instruction":"Style it","revision":"rev","project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[{"id":"v","type":"video","locked":false,"clips":[{"id":"c1","name":"clip.mp4","mediaKind":"video","start":0,"end":6,"sourceIn":0,"sourceOut":6,"rate":1,"volume":80,"transform":{"zoomX":1.2},"transformKeyframes":[{"time":0,"transform":{"zoomX":1.2}},{"time":2,"transform":{"zoomX":1.4}}],"motionPreset":"zoom-in"},{"id":"c2","name":"clip.mp4","mediaKind":"video","start":5,"end":10,"sourceIn":5,"sourceOut":10,"rate":1}]}],"effects":[{"id":"fx1","trackId":"v","preset":"sepia","start":0,"duration":2,"ownerClipId":"c1","clipLookId":"fine-film"}],"transitions":[{"id":"t1","trackId":"v","leftClipId":"c1","rightClipId":"c2","preset":"cross-dissolve","duration":1}],"texts":[]}}`
	var request editRequest
	if err := json.Unmarshal([]byte(body), &request); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(request.Project)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"mediaKind", "volume", "transform", "transformKeyframes", "motionPreset", "clipLookId", "transitions"} {
		if !strings.Contains(string(encoded), `"`+field+`"`) {
			t.Fatalf("provider context dropped %s: %s", field, encoded)
		}
	}
}

func TestEditRejectsUnconfiguredProvider(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENROUTER_MODEL", "")
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"Remove seconds 2 to 4","revision":"abc123","project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[],"effects":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

func TestEditRejectsInvalidRequestBeforeProviderLookup(t *testing.T) {
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	request := httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(`{}`))
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

func TestValidatePlanRejectsUnknownPresetAndOverlappingDeletes(t *testing.T) {
	startA, endA, startB, endB := 1.0, 3.0, 2.0, 4.0
	project := project{
		Duration: 10,
		Tracks:   []track{{ID: "v1", Type: "video"}},
	}
	plan := editPlan{Operations: []editOperation{
		{Type: "delete_range", Start: &startA, End: &endA},
		{Type: "delete_range", Start: &startB, End: &endB},
	}}
	if err := validatePlan(plan, project); err == nil || !strings.Contains(err.Error(), "overlap") {
		t.Fatalf("error = %v", err)
	}

	start, duration := 0.0, 2.0
	plan = editPlan{Operations: []editOperation{{
		Type: "add_effect", ChannelID: "v1", EffectID: "arbitrary-filter", Start: &start, Duration: &duration,
	}}}
	if err := validatePlan(plan, project); err == nil || !strings.Contains(err.Error(), "unknown effect") {
		t.Fatalf("error = %v", err)
	}
}

func TestValidatePlanNewMediaClipAndTransitionOperations(t *testing.T) {
	project := project{
		Duration: 12,
		FPS:      30,
		Aspect:   "landscape",
		Sources:  []mediaSource{{ID: "source-1", Name: "source.mp4", Kind: "video", Duration: 8, Width: 1920, Height: 1080}},
		Tracks: []track{
			{ID: "v1", Type: "video", Clips: []clip{
				{ID: "left", Name: "source.mp4", Start: 0, End: 4, SourceIn: 0, SourceOut: 4, Rate: 1},
				{ID: "right", Name: "source.mp4", Start: 4, End: 8, SourceIn: 4, SourceOut: 8, Rate: 1},
			}},
		},
	}
	start, sourceIn, sourceOut, rate, volume, duration := 8.0, 0.0, 2.0, 1.0, 120.0, 1.0
	zeroDelta := 0.0
	plan := editPlan{Operations: []editOperation{
		{Type: "add_media", SourceID: "source-1", ResultID: "new-video", ChannelID: "v1", Start: &start, SourceIn: &sourceIn, SourceOut: &sourceOut, PlaybackRate: &rate, Volume: &volume, IncludeAudio: boolPtr(false)},
		{Type: "move_clip", ClipID: "right", Delta: &zeroDelta},
		{Type: "update_clip", ClipID: "left", Volume: &volume},
		{Type: "apply_preset", ClipID: "left", PresetID: "fine-film"},
		{Type: "add_transition", ChannelID: "v1", LeftClipID: "left", RightClipID: "right", EffectID: "cross-dissolve", Duration: &duration},
		{Type: "update_transition", ChannelID: "v1", LeftClipID: "left", RightClipID: "right", EffectID: "wipe-left", Duration: &duration},
		{Type: "delete_clip", ClipID: "left"},
	}}
	if err := validatePlan(plan, project); err != nil {
		t.Fatalf("validate new operations: %v", err)
	}
}

func TestValidatePlanAddsTrimmedVideoAndReplacementAudio(t *testing.T) {
	project := project{
		Duration: 0,
		FPS:      30,
		Aspect:   "landscape",
		Sources: []mediaSource{
			{ID: "nature", Name: "1 Minute - Nature.mp4", Kind: "video", Duration: 60},
			{ID: "music", Name: "Assassination Red Magick.mp3", Kind: "audio", Duration: 180},
		},
		Tracks: []track{
			{ID: "v1", Type: "video"},
			{ID: "a1", Type: "audio"},
		},
	}
	start, sourceIn, sourceOut := 0.0, 5.0, 10.0
	plan := editPlan{Operations: []editOperation{
		{
			Type: "add_media", SourceID: "nature", ResultID: "new-video", ChannelID: "v1", Start: &start,
			SourceIn: &sourceIn, SourceOut: &sourceOut, IncludeAudio: boolPtr(false),
		},
		{
			Type: "add_media", SourceID: "music", ResultID: "new-music", ChannelID: "a1", Start: &start,
			SourceIn: &sourceIn, SourceOut: &sourceOut, IncludeAudio: boolPtr(false),
		},
	}}
	if err := validatePlan(plan, project); err != nil {
		t.Fatalf("validate replacement audio plan: %v", err)
	}
	if prompt := systemPrompt(); !strings.Contains(prompt, "includeAudio") || !strings.Contains(prompt, "sourceId") {
		t.Fatalf("AI prompt does not explain source matching and source audio replacement")
	}
	schema, err := json.Marshal(editTool(project))
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{`"sourceId"`, `"sourceIn"`, `"sourceOut"`, `"includeAudio"`, `"remove_source_audio"`, `"split_clip"`} {
		if !strings.Contains(string(schema), required) {
			t.Fatalf("AI tool schema is missing %s", required)
		}
	}
	if strings.Contains(string(schema), `"sourceName"`) {
		t.Fatal("AI tool schema still uses unstable source names")
	}
}

func TestValidatePlanSupportsRazorAndSourceAudioRemoval(t *testing.T) {
	project := project{
		Duration: 10,
		FPS:      30,
		Aspect:   "landscape",
		Tracks: []track{
			{ID: "v1", Type: "video", Clips: []clip{{ID: "video", Name: "clip.mp4", Start: 0, End: 10, SourceIn: 0, SourceOut: 10, Rate: 1, LinkedID: "audio"}}},
			{ID: "a1", Type: "audio", Clips: []clip{{ID: "audio", Name: "clip.mp4", MediaKind: "audio", Start: 0, End: 10, SourceIn: 0, SourceOut: 10, Rate: 1, LinkedID: "video"}}},
		},
	}
	cut := 5.0
	plan := editPlan{Operations: []editOperation{
		{Type: "split_clip", ClipID: "video", Time: &cut},
		{Type: "remove_source_audio", ClipID: "video"},
	}}
	if err := validatePlan(plan, project); err != nil {
		t.Fatalf("validate razor and source-audio removal: %v", err)
	}
	plan = editPlan{Operations: []editOperation{{Type: "delete_clip", ClipID: "audio"}}}
	if err := validatePlan(plan, project); err == nil || !strings.Contains(err.Error(), "remove_source_audio") {
		t.Fatalf("linked audio deletion error = %v", err)
	}
	plan.Operations = append(plan.Operations, editOperation{Type: "remove_source_audio", ClipID: "audio"})
	normalized := normalizePlanForInstruction("Sterge sunetul original", plan, project)
	if len(normalized.Operations) != 1 || normalized.Operations[0].Type != "remove_source_audio" || normalized.Operations[0].ClipID != "video" {
		t.Fatalf("normalized operations = %+v", normalized.Operations)
	}
	trimIn, trimOut := 5.0, 10.0
	plan = editPlan{Operations: []editOperation{{Type: "update_clip", ClipID: "video", InPoint: &trimIn, OutPoint: &trimOut}}}
	instruction := "Pastreaza Nature de la 5 la 10 secunde si elimina sunetul original"
	if err := validateInstructionCompliance(instruction, plan, project); err == nil || !strings.Contains(err.Error(), "remove_source_audio") {
		t.Fatalf("semantic source-audio error = %v", err)
	}
	plan.Operations = append(plan.Operations, editOperation{Type: "remove_source_audio", ClipID: "video"})
	if err := validateInstructionCompliance(instruction, plan, project); err != nil {
		t.Fatalf("valid semantic source-audio plan: %v", err)
	}
	volume := 0.0
	missingTrim := editPlan{Operations: []editOperation{
		{Type: "remove_source_audio", ClipID: "video"},
		{Type: "update_clip", ClipID: "video", Volume: &volume},
	}}
	if err := validateInstructionCompliance(instruction, missingTrim, project); err == nil || !strings.Contains(err.Error(), "source window") {
		t.Fatalf("semantic source-window error = %v", err)
	}
}

func TestNormalizeLinkedVideoDeletionAlsoRemovesItsAudio(t *testing.T) {
	project := project{
		Duration: 20,
		Tracks: []track{
			{ID: "v1", Type: trackTypeVideo, Clips: []clip{{ID: "video", Name: "FF.mp4", Start: 0, End: 20, SourceIn: 0, SourceOut: 20, Rate: 1, LinkedID: "audio"}}},
			{ID: "a1", Type: trackTypeAudio, Clips: []clip{{ID: "audio", Name: "FF.mp4", Start: 0, End: 20, SourceIn: 0, SourceOut: 20, Rate: 1, LinkedID: "video"}}},
		},
	}
	for _, operations := range [][]editOperation{
		{{Type: "delete_clip", ClipID: "video"}, {Type: "delete_clip", ClipID: "audio"}},
		{{Type: "delete_clip", ClipID: "audio"}, {Type: "delete_clip", ClipID: "video"}},
	} {
		plan := normalizePlanForInstruction("Keep only highlights", editPlan{Operations: operations}, project)
		if len(plan.Operations) != 1 || plan.Operations[0].Type != "delete_clip" || plan.Operations[0].ClipID != "video" {
			t.Fatalf("normalized linked deletion = %+v", plan.Operations)
		}
		if err := validatePlan(plan, project); err != nil {
			t.Fatalf("validate linked deletion: %v", err)
		}
		if clips := finalClipTargets(plan, project); len(clips) != 0 {
			t.Fatalf("deleted clip survived final timeline: %+v", clips)
		}
		if existingClipSurvivesPlan(plan, project.Tracks[1], project.Tracks[1].Clips[0]) {
			t.Fatal("linked audio survived its video deletion")
		}
		if err := validatePlan(editPlan{Operations: operations}, project); err == nil {
			t.Fatal("unnormalized double deletion passed validation")
		}
	}
	project.Tracks[1].Locked = true
	plan := editPlan{Operations: []editOperation{{Type: "delete_clip", ClipID: "video"}}}
	if err := validatePlan(plan, project); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatalf("locked linked audio deletion error = %v", err)
	}
}

func TestValidatePlanRejectsUndoMixedWithEdits(t *testing.T) {
	project := project{Duration: 10, Tracks: []track{{ID: "v1", Type: "video"}}}
	start, end := 1.0, 2.0
	plan := editPlan{Operations: []editOperation{
		{Type: "delete_range", Start: &start, End: &end},
		{Type: "undo"},
	}}
	if err := validatePlan(plan, project); err == nil || !strings.Contains(err.Error(), "only operation") {
		t.Fatalf("error = %v", err)
	}
}

func TestValidatePlanRejectsInvalidNewOperations(t *testing.T) {
	sourceProject := project{
		Duration: 10,
		Tracks:   []track{{ID: "v1", Type: "video", Clips: []clip{{ID: "c1", Name: "clip.mp4", Start: 0, End: 4, SourceIn: 0, SourceOut: 4, Rate: 1}}}},
		Sources:  []mediaSource{{ID: "s1", Name: "clip.mp4", Kind: "video", Duration: 4, Width: 1920, Height: 1080}},
	}
	start, delta := 1.0, 2.0
	tests := []struct {
		name  string
		plan  editPlan
		input project
		want  string
	}{
		{
			name:  "missing source list",
			plan:  editPlan{Operations: []editOperation{{Type: "add_media", SourceID: "s1", ResultID: "new-clip", ChannelID: "v1", Start: &start, SourceIn: &start, SourceOut: &delta, IncludeAudio: boolPtr(false)}}},
			input: project{Duration: 10, Tracks: sourceProject.Tracks},
			want:  "sourceId",
		},
		{
			name:  "move has two positions",
			plan:  editPlan{Operations: []editOperation{{Type: "move_clip", ClipID: "c1", Start: &start, Delta: &delta}}},
			input: sourceProject,
			want:  "exactly one",
		},
		{
			name:  "unknown clip preset",
			plan:  editPlan{Operations: []editOperation{{Type: "apply_preset", ClipID: "c1", PresetID: "not-a-preset"}}},
			input: sourceProject,
			want:  "unknown clip preset",
		},
		{
			name:  "transform out of range",
			plan:  editPlan{Operations: []editOperation{{Type: "update_clip", ClipID: "c1", Transform: &transform{ZoomX: floatPtr(41)}}}},
			input: sourceProject,
			want:  "zoom",
		},
		{
			name:  "undo out of range",
			plan:  editPlan{Operations: []editOperation{{Type: "undo", Count: intPtr(101)}}},
			input: sourceProject,
			want:  "between",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validatePlan(test.plan, test.input)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestValidateInstructionComplianceIncludesEveryImageMusicAndTransitions(t *testing.T) {
	project := project{
		Sources: []mediaSource{
			{ID: "photo-1", Name: "Beach.jpg", Kind: "image", Duration: 10},
			{ID: "photo-2", Name: "Forest.png", Kind: "image", Duration: 10},
			{ID: "song", Name: "Summer Song.mp3", Kind: "audio", Duration: 30},
			{ID: "other-song", Name: "Other Song.mp3", Kind: "audio", Duration: 30},
		},
		Tracks: []track{{ID: "v1", Type: "video"}, {ID: "a1", Type: "audio"}},
	}
	zero, nine, ten, nineteen := 0.0, 9.0, 10.0, 19.0
	one := 1.0
	plan := editPlan{Operations: []editOperation{
		{Type: "add_media", SourceID: "photo-1", ResultID: "photo1", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false)},
		{Type: "add_media", SourceID: "photo-2", ResultID: "photo2", ChannelID: "v1", Start: &nine, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false)},
		{Type: "add_media", SourceID: "song", ResultID: "music", ChannelID: "a1", Start: &zero, SourceIn: &zero, SourceOut: &nineteen, IncludeAudio: boolPtr(false)},
		{Type: "add_transition", ChannelID: "v1", LeftClipID: "photo1", RightClipID: "photo2", EffectID: "cross-dissolve", Duration: &one},
	}}
	instruction := "Foloseste 10s din fiecare poza cu tranzitie de 1s intre ele si piesa Summer Song"
	if err := validatePlan(plan, project); err != nil {
		t.Fatalf("validate compound media plan: %v", err)
	}
	if err := validateInstructionCompliance(instruction, plan, project); err != nil {
		t.Fatalf("validate requested media: %v", err)
	}

	missingImage := plan
	missingImage.Operations = slices.Delete(append([]editOperation(nil), plan.Operations...), 1, 2)
	if err := validateInstructionCompliance(instruction, missingImage, project); err == nil || !strings.Contains(err.Error(), "Forest.png") {
		t.Fatalf("missing-image error = %v", err)
	}

	wrongSource := plan
	wrongSource.Operations = append([]editOperation(nil), plan.Operations...)
	wrongSource.Operations[2].SourceID = "other-song"
	if err := validateInstructionCompliance(instruction, wrongSource, project); err == nil || !strings.Contains(err.Error(), "specific audio") {
		t.Fatalf("wrong-source error = %v", err)
	}

	missingTransition := plan
	missingTransition.Operations = append([]editOperation(nil), plan.Operations[:3]...)
	if err := validateInstructionCompliance(instruction, missingTransition, project); err == nil || !strings.Contains(err.Error(), "transition between every") {
		t.Fatalf("missing-transition error = %v", err)
	}

	wrongImageDuration := plan
	wrongImageDuration.Operations = append([]editOperation(nil), plan.Operations...)
	nineSeconds := 9.0
	wrongImageDuration.Operations[0].SourceOut = &nineSeconds
	if err := validateInstructionCompliance(instruction, wrongImageDuration, project); err == nil || !strings.Contains(err.Error(), "10 seconds from each image") {
		t.Fatalf("image-duration error = %v", err)
	}
}

func TestNormalizePlanScopesMusicUnlessCompleteSongIsExplicit(t *testing.T) {
	project := project{
		Sources: []mediaSource{
			{ID: "photo", Name: "Beach.jpg", Kind: "image", Duration: 10},
			{ID: "song", Name: "Summer Song.mp3", Kind: "audio", Duration: 60},
		},
		Tracks: []track{{ID: "v1", Type: "video"}, {ID: "a1", Type: "audio"}},
	}
	zero, ten, twenty := 0.0, 10.0, 20.0
	newPlan := func() editPlan {
		return editPlan{Operations: []editOperation{
			{Type: "add_media", SourceID: "photo", ResultID: "photo1", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false)},
			{Type: "add_media", SourceID: "song", ResultID: "music", ChannelID: "a1", Start: &zero, SourceIn: &zero, SourceOut: &twenty, IncludeAudio: boolPtr(false)},
		}}
	}
	instruction := "Pune piesa Summer Song peste imagini"

	normalized := normalizePlanForInstruction(instruction, newPlan(), project)
	if normalized.Operations[1].SourceOut == nil || *normalized.Operations[1].SourceOut != 10 || normalized.Operations[1].PlaybackRate == nil || *normalized.Operations[1].PlaybackRate != 1 {
		t.Fatalf("normalized song operation = %+v", normalized.Operations[1])
	}
	if err := validateInstructionCompliance(instruction, normalized, project); err != nil {
		t.Fatalf("validate scoped song: %v", err)
	}

	complete := normalizePlanForInstruction("Pune toata piesa Summer Song", newPlan(), project)
	if complete.Operations[1].SourceOut == nil || *complete.Operations[1].SourceOut != 60 {
		t.Fatalf("explicit complete song was trimmed: %+v", complete.Operations[1])
	}

	limited := normalizePlanForInstruction("Pune Summer Song pentru 20 secunde", newPlan(), project)
	if limited.Operations[1].SourceOut == nil || *limited.Operations[1].SourceOut != 20 {
		t.Fatalf("explicit audio duration was overwritten: %+v", limited.Operations[1])
	}
	rejectedComplete := normalizePlanForInstruction("Pune Summer Song, dar nu pastra toata piesa", newPlan(), project)
	if rejectedComplete.Operations[1].SourceOut == nil || *rejectedComplete.Operations[1].SourceOut != 20 {
		t.Fatalf("audio completeness negation was ignored: %+v", rejectedComplete.Operations[1])
	}
}

func TestDefaultAudioScopeDoesNotTreatRemovalAsPlacement(t *testing.T) {
	for _, instruction := range []string{"Remove audio from the selected clip", "Sterge sunetul original"} {
		if requestsDefaultScopedAudio(instruction) {
			t.Fatalf("audio removal was classified as placement: %q", instruction)
		}
	}
}

func TestNormalizePlanScopesMusicToSelectedVisualClip(t *testing.T) {
	zero, five, eight, twelve, sixty := 0.0, 5.0, 8.0, 12.0, 60.0
	project := project{
		Focus: focus{SelectedClipIDs: []string{"selected"}},
		Sources: []mediaSource{
			{ID: "song", Name: "Summer Song.mp3", Kind: mediaKindAudio, Duration: 60},
		},
		Tracks: []track{
			{ID: "v1", Type: trackTypeVideo, Clips: []clip{
				{ID: "first", MediaKind: mediaKindVideo, Start: zero, End: five, SourceIn: zero, SourceOut: five, Rate: 1},
				{ID: "selected", MediaKind: mediaKindVideo, Start: eight, End: twelve, SourceIn: zero, SourceOut: 4, Rate: 1},
			}},
			{ID: "a1", Type: trackTypeAudio},
		},
	}
	plan := editPlan{Operations: []editOperation{{
		Type: "add_media", SourceID: "song", ResultID: "music", ChannelID: "a1",
		Start: &zero, SourceIn: &zero, SourceOut: &sixty, IncludeAudio: boolPtr(false),
	}}}
	instruction := "Adauga melodia Summer Song pe clipul selectat"

	normalized := normalizePlanForInstruction(instruction, plan, project)
	operation := normalized.Operations[0]
	if operation.Start == nil || !approxEqual(*operation.Start, 8) || operation.SourceOut == nil || !approxEqual(*operation.SourceOut, 4) {
		t.Fatalf("selected clip audio scope = %+v", operation)
	}
	if err := validatePlan(normalized, project); err != nil {
		t.Fatalf("validate selected clip audio plan: %v", err)
	}
	if err := validateInstructionCompliance(instruction, normalized, project); err != nil {
		t.Fatalf("validate selected clip audio: %v", err)
	}
}

func TestValidateDelegatedPresetsRejectsOneLookForEveryImage(t *testing.T) {
	project := project{
		Sources: []mediaSource{
			{ID: "photo-1", Name: "Beach.jpg", Kind: "image", Duration: 10},
			{ID: "photo-2", Name: "Forest.jpg", Kind: "image", Duration: 10},
			{ID: "photo-3", Name: "City.jpg", Kind: "image", Duration: 10},
		},
		Tracks: []track{{ID: "v1", Type: "video"}},
	}
	zero, ten, twenty := 0.0, 10.0, 20.0
	plan := editPlan{Operations: []editOperation{
		{Type: "add_media", SourceID: "photo-1", ResultID: "photo1", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false)},
		{Type: "add_media", SourceID: "photo-2", ResultID: "photo2", ChannelID: "v1", Start: &ten, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false)},
		{Type: "add_media", SourceID: "photo-3", ResultID: "photo3", ChannelID: "v1", Start: &twenty, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false)},
		{Type: "apply_preset", ClipID: "photo1", PresetID: "balanced-enhance"},
		{Type: "apply_preset", ClipID: "photo2", PresetID: "balanced-enhance"},
		{Type: "apply_preset", ClipID: "photo3", PresetID: "balanced-enhance"},
	}}
	instruction := "Adauga toate imaginile si alege tu preseturi pentru ele"

	if err := validateInstructionCompliance(instruction, plan, project); err == nil || !strings.Contains(err.Error(), "one preset was repeated") {
		t.Fatalf("delegated preset error = %v", err)
	}
	plan.Operations[4].PresetID = "fine-film"
	if err := validateInstructionCompliance(instruction, plan, project); err != nil {
		t.Fatalf("validate varied presets: %v", err)
	}
}

func TestNormalizePlanBuildsJunctionsForCompoundSlideshow(t *testing.T) {
	project := project{
		Sources: []mediaSource{
			{ID: "nature", Name: "1 Minute Nature.mp4", Kind: "video", Duration: 60},
			{ID: "song", Name: "Assassination Song.mp3", Kind: "audio", Duration: 60},
			{ID: "photo-1", Name: "Beach.jpg", Kind: "image", Duration: 10},
			{ID: "photo-2", Name: "Forest.jpg", Kind: "image", Duration: 10},
			{ID: "photo-3", Name: "Mountain.jpg", Kind: "image", Duration: 10},
		},
		Tracks: []track{{ID: "v1", Type: "video"}, {ID: "a1", Type: "audio"}},
	}
	zero, ten, twentyFive, forty, fiftyTwo := 0.0, 10.0, 25.0, 40.0, 52.0
	one, imageRate := 1.0, 2.0/3.0
	plan := editPlan{Operations: []editOperation{
		{Type: "add_media", SourceID: "nature", ResultID: "nature-video", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false)},
		{Type: "add_media", SourceID: "song", ResultID: "music", ChannelID: "a1", Start: &ten, SourceIn: &zero, SourceOut: &fiftyTwo, IncludeAudio: boolPtr(false)},
		{Type: "add_media", SourceID: "photo-1", ResultID: "photo1", ChannelID: "v1", Start: &ten, SourceIn: &zero, SourceOut: &ten, PlaybackRate: &imageRate, IncludeAudio: boolPtr(false)},
		{Type: "add_media", SourceID: "photo-2", ResultID: "photo2", ChannelID: "v1", Start: &twentyFive, SourceIn: &zero, SourceOut: &ten, PlaybackRate: &imageRate, IncludeAudio: boolPtr(false)},
		{Type: "add_media", SourceID: "photo-3", ResultID: "photo3", ChannelID: "v1", Start: &forty, SourceIn: &zero, SourceOut: &ten, PlaybackRate: &imageRate, IncludeAudio: boolPtr(false)},
		{Type: "apply_preset", ClipID: "nature-video", PresetID: "balanced-enhance"},
		{Type: "apply_preset", ClipID: "photo1", PresetID: "balanced-enhance"},
		{Type: "apply_preset", ClipID: "photo2", PresetID: "balanced-enhance"},
		{Type: "apply_preset", ClipID: "photo3", PresetID: "balanced-enhance"},
		{Type: "add_transition", ChannelID: "v1", LeftClipID: "nature-video", RightClipID: "photo1", EffectID: "wipe-left", Duration: &one},
		{Type: "add_transition", ChannelID: "v1", LeftClipID: "photo1", RightClipID: "photo2", EffectID: "wipe-left", Duration: &one},
		{Type: "add_transition", ChannelID: "v1", LeftClipID: "photo2", RightClipID: "photo3", EffectID: "wipe-left", Duration: &one},
	}}

	instruction := "Add 1 Minute Nature, only first 10 seconds, then Assassination Song with all photos for 15s every photo and 1s transitions with wipe left. Add a preset for all clips."
	if duration, ok := requestedTransitionDuration(instruction); !ok || duration != 1 {
		t.Fatalf("requested transition duration = %v, %v", duration, ok)
	}
	normalized := normalizePlanForInstruction(instruction, plan, project)
	starts := []float64{*normalized.Operations[2].Start, *normalized.Operations[3].Start, *normalized.Operations[4].Start}
	if !slices.Equal(starts, []float64{9, 23, 37}) {
		t.Fatalf("normalized photo starts = %v", starts)
	}
	if err := validatePlan(normalized, project); err != nil {
		t.Fatalf("validate normalized slideshow: %v", err)
	}
	if err := validateInstructionCompliance(instruction, normalized, project); err != nil {
		t.Fatalf("validate normalized instruction: %v", err)
	}
}

func TestNormalizePlanCutsImageScopedMusic(t *testing.T) {
	project := project{
		Sources: []mediaSource{
			{ID: "photo-1", Name: "Beach.jpg", Kind: mediaKindImage, Duration: 10},
			{ID: "photo-2", Name: "Forest.jpg", Kind: mediaKindImage, Duration: 10},
			{ID: "photo-3", Name: "Mountain.jpg", Kind: mediaKindImage, Duration: 10},
			{ID: "song", Name: "Assassination Red Magick.mp3", Kind: mediaKindAudio, Duration: 60},
		},
		Tracks: []track{{ID: "v1", Type: trackTypeVideo}, {ID: "a1", Type: trackTypeAudio}},
	}
	zero, ten, sixty := 0.0, 10.0, 60.0
	plan := editPlan{Summary: "Add a slideshow", Operations: []editOperation{
		{Type: "add_media", SourceID: "photo-1", ResultID: "photo1", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false)},
		{Type: "apply_preset", ClipID: "photo1", PresetID: "fine-film"},
		{Type: "add_media", SourceID: "song", ResultID: "music", ChannelID: "a1", Start: &zero, SourceIn: &zero, SourceOut: &sixty, IncludeAudio: boolPtr(false)},
	}}
	instruction := "Add all images, add presets for transformations, not effects and all transitions 2s between images, images must have 10s and also song assassination played, but only during showing images"

	if duration, ok := requestedImageDuration(instruction); !ok || duration != 10 {
		t.Fatalf("requested image duration = %v, %v", duration, ok)
	}
	if !requestsMotionPresets(instruction) || requestsClipLooks(instruction) || !rejectsEffects(instruction) || !requestsImageScopedAudio(instruction) {
		t.Fatalf("compound intent was not classified correctly")
	}
	normalized := normalizePlanForInstruction(instruction, plan, project)
	imageStarts := make(map[string]float64)
	motions := make(map[string]string)
	transitionCount := 0
	audioDuration := -1.0
	for _, operation := range normalized.Operations {
		switch operation.Type {
		case "add_media":
			source, _ := sourceByID(project.Sources, operation.SourceID)
			if source.Kind == mediaKindImage {
				imageStarts[source.ID] = *operation.Start
				if duration := (*operation.SourceOut - *operation.SourceIn) / valueOr(operation.PlaybackRate, 1); !approxEqual(duration, 10) {
					t.Fatalf("image duration = %v for %+v", duration, operation)
				}
			} else if source.ID == "song" {
				audioDuration = (*operation.SourceOut - *operation.SourceIn) / valueOr(operation.PlaybackRate, 1)
				if !approxEqual(*operation.Start, 0) {
					t.Fatalf("audio start = %v", *operation.Start)
				}
			}
		case "update_clip":
			if operation.MotionPreset != "" {
				motions[operation.ClipID] = operation.MotionPreset
			}
		case "add_transition", "update_transition":
			transitionCount++
			if operation.Duration == nil || !approxEqual(*operation.Duration, 2) {
				t.Fatalf("transition duration = %v", operation.Duration)
			}
		case "add_effect", "update_effect", "delete_effect", "apply_preset":
			t.Fatalf("effect operation survived normalization: %+v", operation)
		}
	}
	if !approxEqual(imageStarts["photo-1"], 0) || !approxEqual(imageStarts["photo-2"], 8) || !approxEqual(imageStarts["photo-3"], 16) {
		t.Fatalf("image starts = %v", imageStarts)
	}
	if len(motions) != 3 || transitionCount != 2 || !approxEqual(audioDuration, 26) {
		t.Fatalf("motions = %v, transitions = %d, audio duration = %v", motions, transitionCount, audioDuration)
	}
	if err := validatePlan(normalized, project); err != nil {
		t.Fatalf("validate normalized slideshow: %v", err)
	}
	if err := validateInstructionCompliance(instruction, normalized, project); err != nil {
		t.Fatalf("validate normalized music cut: %v", err)
	}
	prompt := systemPrompt()
	for _, requirement := range []string{"fit audio to the targeted final visual interval", "transition overlaps", "sourceOut=min(source duration, visual interval duration)"} {
		if !strings.Contains(prompt, requirement) {
			t.Fatalf("AI prompt is missing scoped music instruction %q", requirement)
		}
	}
}

func TestNormalizePlanHandlesTwoSecondImagesWithOneSecondTransitions(t *testing.T) {
	project := project{
		Sources: []mediaSource{
			{ID: "photo-1", Name: "Beach.jpg", Kind: "image", Duration: 10},
			{ID: "photo-2", Name: "Forest.jpg", Kind: "image", Duration: 10},
			{ID: "photo-3", Name: "Mountain.jpg", Kind: "image", Duration: 10},
		},
		Tracks: []track{{ID: "v1", Type: "video"}},
	}
	zero, ten := 0.0, 10.0
	plan := editPlan{Summary: "Add photos", Operations: []editOperation{{
		Type: "add_media", SourceID: "photo-1", ResultID: "photo1", ChannelID: "v1",
		Start: &zero, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false),
	}}}
	instruction := "Add all images with transition of 2s and 1s of transition between them."
	if duration, ok := requestedImageDuration(instruction); !ok || duration != 2 {
		t.Fatalf("requested image duration = %v, %v", duration, ok)
	}
	if duration, ok := requestedTransitionDuration(instruction); !ok || duration != 1 {
		t.Fatalf("requested transition duration = %v, %v", duration, ok)
	}

	normalized := normalizePlanForInstruction(instruction, plan, project)
	starts := make(map[string]float64)
	addCount, transitionCount := 0, 0
	for _, operation := range normalized.Operations {
		switch operation.Type {
		case "add_media":
			addCount++
			starts[operation.SourceID] = *operation.Start
			duration := (*operation.SourceOut - *operation.SourceIn) / valueOr(operation.PlaybackRate, 1)
			if math.Abs(duration-2) > 0.001 {
				t.Fatalf("image operation duration = %v", duration)
			}
		case "add_transition":
			transitionCount++
			if operation.Duration == nil || *operation.Duration != 1 {
				t.Fatalf("transition duration = %v", operation.Duration)
			}
		}
	}
	if addCount != 3 || transitionCount != 2 || starts["photo-1"] != 0 || starts["photo-2"] != 1 || starts["photo-3"] != 2 {
		t.Fatalf("normalized operations = %+v", normalized.Operations)
	}
	if err := validatePlan(normalized, project); err != nil {
		t.Fatalf("validate executable slideshow: %v", err)
	}
	if err := validateInstructionCompliance(instruction, normalized, project); err != nil {
		t.Fatalf("validate slideshow instruction: %v", err)
	}
}

func TestDurationParsingDoesNotBorrowImageOrMusicTimingForTransitions(t *testing.T) {
	imageDuration, hasImageDuration := requestedImageDuration("Show every image for 5 seconds with transitions between them")
	if !hasImageDuration || imageDuration != 5 {
		t.Fatalf("image duration = %v, %v", imageDuration, hasImageDuration)
	}
	if transitionDuration, ok := requestedTransitionDuration("Show every image for 5 seconds with transitions between them"); ok {
		t.Fatalf("unexpected transition duration = %v", transitionDuration)
	}
	if transitionDuration, ok := requestedTransitionDuration("All images with 1s transitions and music for 30s"); !ok || transitionDuration != 1 {
		t.Fatalf("transition duration = %v, %v", transitionDuration, ok)
	}
	if imageDuration, ok := requestedImageDuration("All images with 1s transitions and music for 30s"); ok {
		t.Fatalf("unexpected image duration = %v", imageDuration)
	}
	if transitionDuration, ok := requestedTransitionDuration("Use a 1 second transition between every image"); !ok || transitionDuration != 1 {
		t.Fatalf("word-form transition duration = %v, %v", transitionDuration, ok)
	}
	if transitionDuration, ok := requestedTransitionDuration("Use a 1-second transition between every image"); !ok || transitionDuration != 1 {
		t.Fatalf("hyphenated transition duration = %v, %v", transitionDuration, ok)
	}
	transitionWording := "All images should have 2-second transitions"
	if imageDuration, ok := requestedImageDuration(transitionWording); ok {
		t.Fatalf("transition duration was parsed as image duration = %v", imageDuration)
	}
	if transitionDuration, ok := requestedTransitionDuration(transitionWording); !ok || transitionDuration != 2 {
		t.Fatalf("qualified transition duration = %v, %v", transitionDuration, ok)
	}
	if requestsImageScopedAudio("Show all images for the duration of 10 seconds each and play song Assassination") {
		t.Fatal("image duration was parsed as an audio scope")
	}
	mediaBinWording := "Add all Media Bin images, 10 seconds each"
	if !requestsEveryImage(mediaBinWording) {
		t.Fatal("Media Bin all-image wording was not recognized")
	}
	if imageDuration, ok := requestedImageDuration(mediaBinWording); !ok || imageDuration != 10 {
		t.Fatalf("Media Bin image duration = %v, %v", imageDuration, ok)
	}
	sourceInstruction := "Add all images with motion presets and play song assassination only during showing images"
	if !instructionMentionsSource(sourceInstruction, "Assassination Red Magick.mp3") || instructionMentionsSource(sourceInstruction, "Motion Theme.mp3") || instructionMentionsSource(sourceInstruction, "Image Sequence Bed.mp3") {
		t.Fatal("partial source matching selected an editing term instead of the named song")
	}
	ambiguousProject := project{Sources: []mediaSource{
		{ID: "primary", Name: "Assassination Red Magick.mp3", Kind: mediaKindAudio, Duration: 60},
		{ID: "alternate", Name: "Assassination Instrumental.mp3", Kind: mediaKindAudio, Duration: 60},
	}}
	matchingSongs := imageScopedAudioSources(sourceInstruction, ambiguousProject)
	if len(matchingSongs) != 0 {
		t.Fatalf("ambiguous song match was selected by source order: %+v", matchingSongs)
	}
	if err := validateInstructionCompliance(sourceInstruction, editPlan{}, ambiguousProject); err == nil || !strings.Contains(err.Error(), "multiple audio sources") {
		t.Fatalf("ambiguous song validation error = %v", err)
	}
}

func TestValidatesNamedVideosWithIndependentRomanianSourceRanges(t *testing.T) {
	instruction := "Vreau video-ul cu Dostoevski (de la sec 3 la secunda 8) si cel cu Aldous Huxley 2 (de la secunda 1 la secunda 10), tranzitie de 3s cu un efect de Circle Iris Open intre ele, adauga ce preseturi vrei, cu melodia Assasination pe parcursul video-ului"
	project := project{
		Sources: []mediaSource{
			{ID: "huxley-1", Name: "Aldous Huxley 1.mp4", Kind: mediaKindVideo, Duration: 41.6},
			{ID: "huxley-2", Name: "Aldous Huxley 2.mp4", Kind: mediaKindVideo, Duration: 32.896},
			{ID: "dostoevski", Name: "Fyodor Dostoevski.mp4", Kind: mediaKindVideo, Duration: 30.058},
			{ID: "song", Name: "Assassination Red Magick Faction.mp3", Kind: mediaKindAudio, Duration: 1200},
		},
		Tracks: []track{{ID: "v1", Type: trackTypeVideo}, {ID: "a1", Type: trackTypeAudio}},
	}

	mentioned := specificallyMentionedSourceIDs(instruction, project.Sources)
	if !mentioned["dostoevski"] || !mentioned["huxley-2"] || mentioned["huxley-1"] {
		t.Fatalf("matched sources = %v", mentioned)
	}
	ranges := requestedSourceRanges(instruction)
	if len(ranges) != 2 || ranges[0].SourceIn != 3 || ranges[0].SourceOut != 8 || ranges[1].SourceIn != 1 || ranges[1].SourceOut != 10 {
		t.Fatalf("source ranges = %+v", ranges)
	}
	if !requestsVisualScopedAudio(instruction) || !requestsLimitedAudio(instruction) {
		t.Fatal("video-scoped song was not recognized as limited audio")
	}

	zero, one, three, eight, ten := 0.0, 1.0, 3.0, 8.0, 10.0
	transitionDuration, huxleyStart, finalDuration := 2.45, 2.55, 11.55
	plan := editPlan{Summary: "Uses the maximum safe 2.45s circle transition", Operations: []editOperation{
		{Type: "add_media", SourceID: "dostoevski", ResultID: "dost", ChannelID: "v1", Start: &zero, SourceIn: &three, SourceOut: &eight, IncludeAudio: boolPtr(true)},
		{Type: "add_media", SourceID: "huxley-2", ResultID: "hux", ChannelID: "v1", Start: &huxleyStart, SourceIn: &one, SourceOut: &ten, IncludeAudio: boolPtr(true)},
		{Type: "add_transition", ChannelID: "v1", LeftClipID: "dost", RightClipID: "hux", EffectID: "circle", Duration: &transitionDuration},
		{Type: "apply_preset", ClipID: "dost", PresetID: "fine-film"},
		{Type: "apply_preset", ClipID: "hux", PresetID: "teal-amber"},
		{Type: "add_media", SourceID: "song", ResultID: "music", ChannelID: "a1", Start: &zero, SourceIn: &zero, SourceOut: &finalDuration, IncludeAudio: boolPtr(false)},
	}}
	plan = normalizePlanForInstruction(instruction, plan, project)
	if err := validatePlan(plan, project); err != nil {
		t.Fatalf("valid compound plan structure: %v", err)
	}
	if err := validateInstructionCompliance(instruction, plan, project); err != nil {
		t.Fatalf("valid compound plan: %v", err)
	}

	invalid := plan
	invalid.Operations = append([]editOperation(nil), plan.Operations...)
	invalid.Operations[0].SourceOut = floatPtr(9.1)
	if err := validateInstructionCompliance(instruction, invalid, project); err == nil || !strings.Contains(err.Error(), "3 to 8 seconds") {
		t.Fatalf("changed explicit source range error = %v", err)
	}

	repair := repairPlanAction(fmt.Errorf("operation 3: transition duration 3s exceeds the 2.45s limit for these clips"))
	for _, requirement := range []string{"Reduce the transition", "recompute audio", "Do not lengthen either source range"} {
		if !strings.Contains(repair, requirement) {
			t.Fatalf("repair action is missing %q: %s", requirement, repair)
		}
	}
	prompt := systemPrompt()
	for _, requirement := range []string{"Explicit source ranges are hard constraints", "use the maximum valid duration", "complete final visual timeline"} {
		if !strings.Contains(prompt, requirement) {
			t.Fatalf("system prompt is missing %q", requirement)
		}
	}
}

func TestSourceRangesDoNotTreatSegmentDurationsAsSourceWindows(t *testing.T) {
	tests := []struct {
		instruction string
		want        []sourceRangeCandidate
	}{
		{instruction: "Vreau cut-uri de 10-15 secunde si tranzitii de 2s"},
		{instruction: "Choose 10-15 second cuts with 2s transitions"},
		{instruction: "Alege momente de 10-15 secunde fiecare"},
		{instruction: "Pastreaza din Nature.mp4 de la sec 3 la secunda 8 si fa cut-uri de 10-15 secunde", want: []sourceRangeCandidate{{SourceIn: 3, SourceOut: 8}}},
		{instruction: "Pastreaza Nature.mp4 10-15 secunde", want: []sourceRangeCandidate{{SourceIn: 10, SourceOut: 15}}},
	}
	for _, test := range tests {
		t.Run(test.instruction, func(t *testing.T) {
			ranges := requestedSourceRanges(test.instruction)
			if len(ranges) != len(test.want) {
				t.Fatalf("source ranges = %+v, want %+v", ranges, test.want)
			}
			for index, want := range test.want {
				if ranges[index].SourceIn != want.SourceIn || ranges[index].SourceOut != want.SourceOut {
					t.Fatalf("source ranges = %+v, want %+v", ranges, test.want)
				}
			}
		})
	}
}

func TestNormalizePlanUsesExistingTimelineImageWithoutDuplicatingIt(t *testing.T) {
	project := project{
		Duration: 2,
		Sources: []mediaSource{
			{ID: "photo-1", Name: "Beach.jpg", Kind: "image", Duration: 10, TimelineClipIDs: []string{"existing"}},
			{ID: "photo-2", Name: "Forest.jpg", Kind: "image", Duration: 10},
		},
		Tracks: []track{{ID: "v1", Type: "video", Clips: []clip{{
			ID: "existing", Name: "Beach.jpg", SourceID: "photo-1", SourceDuration: 10, MediaKind: "image",
			Start: 0, End: 2, SourceIn: 0, SourceOut: 2, Rate: 1,
		}}}},
	}
	zero, two := 0.0, 2.0
	plan := editPlan{Operations: []editOperation{
		{Type: "add_media", SourceID: "photo-1", ResultID: "duplicate", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &two, IncludeAudio: boolPtr(false)},
		{Type: "apply_preset", ClipID: "duplicate", PresetID: "fine-film"},
	}}
	instruction := "Add all images, images must have 10s and transitions 2s between images"
	normalized := normalizePlanForInstruction(instruction, plan, project)
	addedSources := make([]string, 0)
	updatedExisting := false
	transitionCount := 0
	for _, operation := range normalized.Operations {
		if operation.Type == "add_media" {
			addedSources = append(addedSources, operation.SourceID)
			if operation.SourceID == "photo-2" && (operation.Start == nil || !approxEqual(*operation.Start, 8)) {
				t.Fatalf("new image start was not realigned after existing image retiming: %+v", operation)
			}
		}
		if operation.Type == "update_clip" && operation.ClipID == "existing" && operation.OutPoint != nil && operation.PlaybackRate != nil {
			updatedExisting = approxEqual(*operation.OutPoint, 10) && approxEqual(*operation.PlaybackRate, 1)
		}
		if operation.Type == "add_transition" || operation.Type == "update_transition" {
			transitionCount++
		}
		if operation.Type == "apply_preset" && operation.ClipID != "existing" {
			t.Fatalf("preset target was not rewritten: %+v", operation)
		}
	}
	if !slices.Equal(addedSources, []string{"photo-2"}) {
		t.Fatalf("added sources = %v", addedSources)
	}
	if !updatedExisting {
		t.Fatalf("existing image timing was not normalized: %+v", normalized.Operations)
	}
	if transitionCount != 1 {
		t.Fatalf("transition count = %d", transitionCount)
	}
	if err := validatePlan(normalized, project); err != nil {
		t.Fatalf("validate existing-media plan: %v", err)
	}
	if err := validateInstructionCompliance(instruction, normalized, project); err != nil {
		t.Fatalf("validate existing-media instruction: %v", err)
	}
}

func TestNormalizePlanReaddsAnImageRemovedByDeleteRange(t *testing.T) {
	project := project{
		Duration: 2,
		Sources:  []mediaSource{{ID: "photo", Name: "Beach.jpg", Kind: "image", Duration: 10, TimelineClipIDs: []string{"existing"}}},
		Tracks: []track{{ID: "v1", Type: "video", Clips: []clip{{
			ID: "existing", Name: "Beach.jpg", SourceID: "photo", SourceDuration: 10, MediaKind: "image",
			Start: 0, End: 2, SourceIn: 0, SourceOut: 2, Rate: 1,
		}}}},
	}
	zero, two := 0.0, 2.0
	plan := editPlan{Operations: []editOperation{
		{Type: "delete_range", Start: &zero, End: &two},
		{Type: "add_media", SourceID: "photo", ResultID: "replacement", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &two, IncludeAudio: boolPtr(false)},
	}}
	normalized := normalizePlanForInstruction("Replace the timeline with all images", plan, project)
	if len(normalized.Operations) != 2 || normalized.Operations[1].Type != "add_media" {
		t.Fatalf("replacement media was removed: %+v", normalized.Operations)
	}
	if err := validatePlan(normalized, project); err != nil {
		t.Fatalf("validate replacement plan: %v", err)
	}
	if err := validateInstructionCompliance("Replace the timeline with all images", normalized, project); err != nil {
		t.Fatalf("validate replacement instruction: %v", err)
	}
}

func TestNormalizePlanReaddsImageRemovedByMultipleDeleteRanges(t *testing.T) {
	project := project{
		Duration: 4,
		Sources:  []mediaSource{{ID: "photo", Name: "Beach.jpg", Kind: "image", Duration: 10, TimelineClipIDs: []string{"existing"}}},
		Tracks: []track{{ID: "v1", Type: "video", Clips: []clip{{
			ID: "existing", Name: "Beach.jpg", SourceID: "photo", MediaKind: "image",
			Start: 0, End: 4, SourceIn: 0, SourceOut: 4, Rate: 1,
		}}}},
	}
	zero, two, four := 0.0, 2.0, 4.0
	plan := editPlan{Operations: []editOperation{
		{Type: "delete_range", Start: &zero, End: &two},
		{Type: "delete_range", Start: &two, End: &four},
		{Type: "add_media", SourceID: "photo", ResultID: "replacement", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &four, IncludeAudio: boolPtr(false)},
	}}
	normalized := normalizePlanForInstruction("Replace the timeline with all images", plan, project)
	addCount := 0
	for _, operation := range normalized.Operations {
		if operation.Type == "add_media" {
			addCount++
		}
	}
	if addCount != 1 {
		t.Fatalf("replacement was removed after multiple ranges: %+v", normalized.Operations)
	}
	if err := validateInstructionCompliance("Replace the timeline with all images", normalized, project); err != nil {
		t.Fatalf("validate multi-range replacement: %v", err)
	}
}

func TestValidatePlanUsesPostDeleteClipAdjacency(t *testing.T) {
	project := project{Duration: 6, Tracks: []track{{ID: "v1", Type: "video", Clips: []clip{
		{ID: "left", MediaKind: "image", Start: 0, End: 2, SourceIn: 0, SourceOut: 2, Rate: 1},
		{ID: "middle", MediaKind: "video", Start: 2, End: 4, SourceIn: 0, SourceOut: 2, Rate: 1},
		{ID: "right", MediaKind: "image", Start: 4, End: 6, SourceIn: 0, SourceOut: 2, Rate: 1},
	}}}}
	two, four, one := 2.0, 4.0, 1.0
	plan := editPlan{Operations: []editOperation{
		{Type: "delete_range", Start: &two, End: &four},
		{Type: "add_transition", ChannelID: "v1", LeftClipID: "left", RightClipID: "right", EffectID: "cross-dissolve", Duration: &one},
	}}
	if err := validatePlan(plan, project); err != nil {
		t.Fatalf("post-delete transition should validate: %v", err)
	}
}

func TestDeleteRangeSimulationIsDeterministicAndSkipsLockedTracks(t *testing.T) {
	three, five := 3.0, 5.0
	plan := editPlan{Operations: []editOperation{{Type: "delete_range", Start: &three, End: &five}}}
	project := project{Tracks: []track{
		{ID: "v1", Type: "video", Clips: []clip{{ID: "split", Start: 0, End: 10, SourceIn: 0, SourceOut: 10, Rate: 1}}},
		{ID: "locked", Type: "video", Locked: true, Clips: []clip{{ID: "keep", Start: 3, End: 5, SourceIn: 0, SourceOut: 2, Rate: 1}}},
	}}
	clips := clipsAfterDeleteRanges(plan, project)
	if clips["split"].Clip.End != 3 {
		t.Fatalf("left fragment = %+v", clips["split"].Clip)
	}
	fragments := 0
	for id, target := range clips {
		if strings.HasPrefix(id, "__delete_fragment_") {
			fragments++
			if target.Clip.Start != 3 || target.Clip.End != 8 {
				t.Fatalf("right fragment = %+v", target.Clip)
			}
		}
	}
	if fragments != 1 || clips["keep"].Clip.Start != 3 || clips["keep"].Clip.End != 5 {
		t.Fatalf("simulated clips = %+v", clips)
	}
}

func TestNormalizePlanDoesNotTransitionAcrossUnrelatedFootage(t *testing.T) {
	project := project{
		Duration: 10,
		Sources: []mediaSource{
			{ID: "photo-1", Name: "Beach.jpg", Kind: "image", Duration: 10, TimelineClipIDs: []string{"existing-photo"}},
			{ID: "video", Name: "Scene.mp4", Kind: "video", Duration: 8, TimelineClipIDs: []string{"existing-video"}},
			{ID: "photo-2", Name: "Forest.jpg", Kind: "image", Duration: 10},
		},
		Tracks: []track{{ID: "v1", Type: "video", Clips: []clip{
			{ID: "existing-photo", Name: "Beach.jpg", SourceID: "photo-1", MediaKind: "image", Start: 0, End: 2, SourceIn: 0, SourceOut: 2, Rate: 1},
			{ID: "existing-video", Name: "Scene.mp4", SourceID: "video", MediaKind: "video", Start: 2, End: 10, SourceIn: 0, SourceOut: 8, Rate: 1},
		}}},
	}
	zero, ten := 0.0, 10.0
	plan := editPlan{Operations: []editOperation{{
		Type: "add_media", SourceID: "photo-2", ResultID: "new-photo", ChannelID: "v1",
		Start: &ten, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false),
	}}}
	normalized := normalizePlanForInstruction("Add all images with 1s transitions between them", plan, project)
	for _, operation := range normalized.Operations {
		if operation.Type == "add_transition" || operation.Type == "update_transition" {
			t.Fatalf("transition crossed unrelated footage: %+v", operation)
		}
		if operation.Type == "add_media" && operation.Start != nil && *operation.Start != 10 {
			t.Fatalf("new image moved across footage: %+v", operation)
		}
	}
	if err := validateInstructionCompliance("Add all images with 1s transitions between them", normalized, project); err != nil {
		t.Fatalf("validate preserved sequence: %v", err)
	}
}

func TestNormalizePlanResolvesExistingVideoInsteadOfLinkedAudio(t *testing.T) {
	project := project{
		Duration: 4,
		Sources:  []mediaSource{{ID: "scene", Name: "Scene.mp4", Kind: "video", Duration: 4, TimelineClipIDs: []string{"video"}}},
		Tracks: []track{
			{ID: "v1", Type: "video", Clips: []clip{{ID: "video", Name: "Scene.mp4", SourceID: "scene", MediaKind: "video", Start: 0, End: 4, SourceIn: 0, SourceOut: 4, Rate: 1, LinkedID: "audio"}}},
			{ID: "a1", Type: "audio", Clips: []clip{{ID: "audio", Name: "Scene.mp4", SourceID: "scene", MediaKind: "audio", Start: 0, End: 4, SourceIn: 0, SourceOut: 4, Rate: 1, LinkedID: "video"}}},
		},
	}
	zero, four := 0.0, 4.0
	plan := editPlan{Operations: []editOperation{
		{Type: "add_media", SourceID: "scene", ResultID: "duplicate", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &four, IncludeAudio: boolPtr(false)},
		{Type: "apply_preset", ClipID: "duplicate", PresetID: "fine-film"},
	}}
	normalized := normalizePlanForInstruction("Style Scene with fine film", plan, project)
	if len(normalized.Operations) != 1 || normalized.Operations[0].ClipID != "video" {
		t.Fatalf("existing video resolution = %+v", normalized.Operations)
	}
}

func TestNormalizePlanPrefersSelectedTimelineCopy(t *testing.T) {
	project := project{
		Duration: 8,
		Focus:    focus{SelectedClipIDs: []string{"second"}},
		Sources:  []mediaSource{{ID: "scene", Name: "Scene.mp4", Kind: "video", Duration: 4, TimelineClipIDs: []string{"first", "second"}}},
		Tracks: []track{{ID: "v1", Type: "video", Clips: []clip{
			{ID: "first", Name: "Scene.mp4", SourceID: "scene", MediaKind: "video", Start: 0, End: 4, SourceIn: 0, SourceOut: 4, Rate: 1},
			{ID: "second", Name: "Scene.mp4", SourceID: "scene", MediaKind: "video", Start: 4, End: 8, SourceIn: 0, SourceOut: 4, Rate: 1},
		}}},
	}
	zero, four := 0.0, 4.0
	plan := editPlan{Operations: []editOperation{
		{Type: "add_media", SourceID: "scene", ResultID: "duplicate", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &four, IncludeAudio: boolPtr(false)},
		{Type: "apply_preset", ClipID: "duplicate", PresetID: "fine-film"},
	}}
	normalized := normalizePlanForInstruction("Style the selected Scene", plan, project)
	if len(normalized.Operations) != 1 || normalized.Operations[0].ClipID != "second" {
		t.Fatalf("selected copy was not preferred: %+v", normalized.Operations)
	}
}

func TestNormalizePlanKeepsExplicitDuplicateCopies(t *testing.T) {
	project := project{
		Sources: []mediaSource{{ID: "photo", Name: "Beach.jpg", Kind: "image", Duration: 10}},
		Tracks:  []track{{ID: "v1", Type: "video"}},
	}
	zero, two := 0.0, 2.0
	plan := editPlan{Operations: []editOperation{
		{Type: "add_media", SourceID: "photo", ResultID: "copy1", ChannelID: "v1", Start: &zero, SourceIn: &zero, SourceOut: &two, IncludeAudio: boolPtr(false)},
		{Type: "add_media", SourceID: "photo", ResultID: "copy2", ChannelID: "v1", Start: &two, SourceIn: &zero, SourceOut: &two, IncludeAudio: boolPtr(false)},
	}}
	normalized := normalizePlanForInstruction("Add 10 copies of Beach", plan, project)
	if len(normalized.Operations) != 2 {
		t.Fatalf("explicit copies were collapsed: %+v", normalized.Operations)
	}
}

func TestEditToolOmitsAddMediaWhenNoSourcesExist(t *testing.T) {
	schema, err := json.Marshal(editTool(project{}))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(schema), `"const":"add_media"`) || strings.Contains(string(schema), `"enum":[]`) {
		t.Fatalf("empty-source schema exposes invalid add_media: %s", schema)
	}
	plan := normalizePlanForInstruction("Add all images", editPlan{}, project{Tracks: []track{{ID: "v1", Type: "video"}}})
	if len(plan.Operations) != 0 {
		t.Fatalf("empty Media Bin produced operations: %+v", plan.Operations)
	}
	if err := validateInstructionCompliance("Add all images", plan, project{}); err != nil {
		t.Fatalf("empty Media Bin should be a valid no-op: %v", err)
	}
}

func TestValidatePlanAllowsHalfDurationTransitionsForImagesOnly(t *testing.T) {
	duration := 1.0
	transition := editOperation{Type: "add_transition", ChannelID: "v1", LeftClipID: "left", RightClipID: "right", EffectID: "cross-dissolve", Duration: &duration}
	project := project{Duration: 3, Tracks: []track{{ID: "v1", Type: "video", Clips: []clip{
		{ID: "left", MediaKind: "image", Start: 0, End: 2, SourceIn: 0, SourceOut: 2, Rate: 1},
		{ID: "right", MediaKind: "image", Start: 1, End: 3, SourceIn: 0, SourceOut: 2, Rate: 1},
	}}}}
	if err := validatePlan(editPlan{Operations: []editOperation{transition}}, project); err != nil {
		t.Fatalf("image transition should be valid: %v", err)
	}
	project.Tracks[0].Clips[0].MediaKind = "video"
	project.Tracks[0].Clips[1].MediaKind = "video"
	if err := validatePlan(editPlan{Operations: []editOperation{transition}}, project); err == nil || !strings.Contains(err.Error(), "0.95s limit") {
		t.Fatalf("video transition error = %v", err)
	}
}

func TestValidatePlanUsesUpdatedExistingClipForAppendedMedia(t *testing.T) {
	project := project{
		Sources: []mediaSource{
			{ID: "existing-source", Name: "Existing.mp4", Kind: "video", Duration: 20},
			{ID: "next", Name: "Next.jpg", Kind: "image", Duration: 10},
		},
		Tracks: []track{{ID: "v1", Type: "video", Clips: []clip{{
			ID: "existing", Name: "Existing.mp4", SourceID: "existing-source", Start: 0, End: 5, SourceIn: 0, SourceOut: 5, Rate: 1,
		}}}},
	}
	zero, nine, ten, one := 0.0, 9.0, 10.0, 1.0
	plan := editPlan{Operations: []editOperation{
		{Type: "update_clip", ClipID: "existing", OutPoint: &ten},
		{Type: "add_media", SourceID: "next", ResultID: "next-photo", ChannelID: "v1", Start: &nine, SourceIn: &zero, SourceOut: &ten, IncludeAudio: boolPtr(false)},
		{Type: "apply_preset", ClipID: "existing", PresetID: "creator-natural"},
		{Type: "apply_preset", ClipID: "next-photo", PresetID: "creator-natural"},
		{Type: "add_transition", ChannelID: "v1", LeftClipID: "existing", RightClipID: "next-photo", EffectID: "wipe-left", Duration: &one},
	}}

	if err := validatePlan(plan, project); err != nil {
		t.Fatalf("validate mixed existing and appended media plan: %v", err)
	}
}

func TestNormalizeCaptionSplitsLongLinesIntoFiveWordChunks(t *testing.T) {
	start, duration := 0.0, 6.0
	text := "This is a very long caption line that must be split"
	plan := editPlan{Operations: []editOperation{
		{Type: "add_text", Start: &start, Duration: &duration, Text: &text, TextPresetID: "active-word"},
	}}
	project := project{Duration: 10, Tracks: []track{{ID: "v1", Type: "video"}}}

	normalized := normalizePlanForInstruction("Add captions", plan, project)
	if len(normalized.Operations) != 3 {
		t.Fatalf("caption operations = %+v", normalized.Operations)
	}
	for _, operation := range normalized.Operations {
		if words := len(strings.Fields(*operation.Text)); words > 5 {
			t.Fatalf("caption chunk has %d words: %q", words, *operation.Text)
		}
	}
	if err := validatePlan(normalized, project); err != nil {
		t.Fatalf("validate split captions: %v", err)
	}
	if *normalized.Operations[0].Text != "This is a very long" || *normalized.Operations[2].Text != "split" {
		t.Fatalf("caption chunks = %+v", normalized.Operations)
	}

	long := "one two three four five six"
	bad := editPlan{Operations: []editOperation{
		{Type: "add_text", Start: &start, Duration: &duration, Text: &long, TextPresetID: "clean-phrase"},
	}}
	// Normalization splits it, so validate the normalized form instead of the raw model output.
	if err := validatePlan(normalizePlanForInstruction("Add captions", bad, project), project); err != nil {
		t.Fatalf("normalized long caption should validate: %v", err)
	}
}

func writeToolCallResponse(t *testing.T, w http.ResponseWriter, id, name, arguments string) {
	t.Helper()
	response := openrouter.ChatCompletionResponse{}
	response.Choices = append(response.Choices, struct {
		Index        int                        `json:"index"`
		Message      openrouter.ResponseMessage `json:"message"`
		FinishReason string                     `json:"finish_reason"`
	}{Message: openrouter.ResponseMessage{Role: "assistant", Content: json.RawMessage("null"), ToolCalls: []openrouter.ToolCall{{ID: id, Type: "function"}}}})
	response.Choices[0].Message.ToolCalls[0].Function.Name = name
	response.Choices[0].Message.ToolCalls[0].Function.Arguments = arguments
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		t.Fatal(err)
	}
}
