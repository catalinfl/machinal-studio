package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"

	"github.com/gofiber/fiber/v2"
)

func TestIsFastRequest(t *testing.T) {
	if !isFastRequest("1", false) || !isFastRequest("true", false) || !isFastRequest("fast", false) {
		t.Fatal("query fast flags must be recognized")
	}
	if isFastRequest("", false) || isFastRequest("0", false) {
		t.Fatal("empty/0 must not be fast")
	}
	if !isFastRequest("", true) {
		t.Fatal("body fast=true must be fast")
	}
}

func TestAnalysisScopeRequestedForAnySignal(t *testing.T) {
	if (analysisScope{}).requested() {
		t.Fatal("empty scope must not request analysis")
	}
	for _, scope := range []analysisScope{{NeedSignals: true}, {NeedVision: true}, {NeedTranscript: true}} {
		if !scope.requested() {
			t.Fatalf("scope %+v must request analysis", scope)
		}
	}
}

func TestEffectiveLimitsRespectEnv(t *testing.T) {
	t.Setenv("AI_ANALYSIS_SOURCES", "1")
	t.Setenv("AI_VISION_FRAMES", "2")
	t.Setenv("AI_ANALYSIS_MAX_MINUTES", "5")
	if effectiveMaxAnalysisSources() != 1 || effectiveMaxVisionFrames() != 2 || effectiveMaxAnalysisDuration() != 300 {
		t.Fatalf("env limits not applied: %d %d %.0f",
			effectiveMaxAnalysisSources(), effectiveMaxVisionFrames(), effectiveMaxAnalysisDuration())
	}
	t.Setenv("AI_ANALYSIS_SOURCES", "99")
	if effectiveMaxAnalysisSources() != maxAnalysisSources {
		t.Fatalf("sources must clamp to hard cap %d", maxAnalysisSources)
	}
}

func TestResolveRouterModel(t *testing.T) {
	t.Setenv("OPENROUTER_JEV_MODEL", "~typesafe/jev-latest")
	if resolveRouterModel() != "~typesafe/jev-latest" {
		t.Fatal("router model override must win")
	}
	t.Setenv("OPENROUTER_JEV_MODEL", "")
	if resolveRouterModel() != "typesafe/jev-1.13" {
		t.Fatal("router model must default to Jev 1.13")
	}
}

func TestFastEditUsesRouterWithoutUnrequestedAnalysis(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch calls {
		case 1:
			writeToolCallResponse(t, w, "edit-1", toolCut, `{"mode":"execute","summary":"Trimmed.","operations":[]}`)
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
	body := `{"instruction":"Remove seconds 2 to 4","revision":"r1","fast":true,"project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[{"id":"v1","type":"video","locked":false,"clips":[{"id":"c1","name":"clip.mp4","start":0,"end":10,"sourceIn":0,"sourceOut":10,"rate":1}]}],"effects":[],"texts":[]}}`
	request := httptest.NewRequest(http.MethodPost, "/ai/edit?fast=1", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if calls != 1 {
		t.Fatalf("fast path must make one OpenRouter executor call, got %d", calls)
	}
}

func TestFastEditRunsAnalysisWhenRouterRequestsIt(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var decoded openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&decoded); err != nil {
			t.Fatal(err)
		}
		switch calls {
		case 1:
			if len(decoded.Tools) != 3 || !strings.Contains(decoded.Messages[1].TextContent(), `"requested":true`) {
				t.Fatalf("fast executor missing tools or analysis: %+v", decoded)
			}
			writeToolCallResponse(t, w, "edit-1", toolCut, `{"mode":"execute","summary":"Done.","operations":[]}`)
		default:
			t.Fatalf("unexpected provider call %d", calls)
		}
	}))
	defer provider.Close()

	t.Setenv("OPENROUTER_API_KEY", "secret")
	t.Setenv("OPENROUTER_MODEL", "test/model")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL)
	mockJevRouter(t, toolSelection{Families: []string{familyCut, familyCaption, familyText}, Analysis: analysisScope{NeedTranscript: true}})
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"Fă clipul să spună o poveste și pune-i cuvinte pe ecran","revision":"r1","fast":true,"project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[{"id":"v1","type":"video","locked":false,"clips":[{"id":"c1","name":"clip.mp4","start":0,"end":10,"sourceIn":0,"sourceOut":10,"rate":1}]}],"effects":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK || calls != 1 {
		t.Fatalf("status = %d, calls = %d, want one OpenRouter executor call", response.StatusCode, calls)
	}
}

func TestJevAndExecutorUseSameOpenRouterKey(t *testing.T) {
	jevCalls, executorCalls := 0, 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer one-openrouter-key" {
			t.Errorf("wrong Authorization on %s", r.URL.Path)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/v1/systemone":
			jevCalls++
			var request struct {
				Model     string                     `json:"model"`
				Questions map[string]json.RawMessage `json:"questions"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			if request.Model != "typesafe/jev-1.13" || len(request.Questions) != len(familyDecisions)+1 {
				t.Errorf("Jev request = %+v", request)
			}
			if err := json.NewEncoder(w).Encode(jevResponse(toolSelection{Families: []string{familyCut}})); err != nil {
				t.Error(err)
			}
		case "/v1/chat/completions":
			executorCalls++
			writeToolCallResponse(t, w, "edit-1", toolCut, `{"mode":"execute","summary":"Cut.","operations":[]}`)
		default:
			t.Errorf("unexpected OpenRouter path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer provider.Close()
	t.Setenv("OPENROUTER_API_KEY", "one-openrouter-key")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL+"/v1")
	t.Setenv("OPENROUTER_JEV_BASE_URL", "")
	t.Setenv("OPENROUTER_JEV_MODEL", "")
	t.Setenv("OPENROUTER_MODEL", "test/model")
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"Remove seconds 2 to 4","revision":"r1","fast":true,"project":{"duration":10,"fps":30,"aspect":"landscape","tracks":[{"id":"v1","type":"video","locked":false,"clips":[{"id":"c1","name":"clip.mp4","start":0,"end":10,"sourceIn":0,"sourceOut":10,"rate":1}]}],"effects":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK || jevCalls != 1 || executorCalls != 1 {
		t.Fatalf("status=%d jev=%d executor=%d", response.StatusCode, jevCalls, executorCalls)
	}
}

func TestRouterFailureStopsBeforeExecutor(t *testing.T) {
	for _, fast := range []bool{false, true} {
		for _, invalidReply := range []bool{false, true} {
			calls := 0
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls++
				t.Error("executor must not run after Jev fails")
			}))
			routerCalls := 0
			jev := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				routerCalls++
				if invalidReply {
					_, _ = w.Write([]byte(`{"model":"jev-1.13.0","answers":{"tool_cut":{"type":"noul","noul":0.99}}}`))
					return
				}
				w.WriteHeader(http.StatusBadRequest)
			}))
			t.Setenv("OPENROUTER_JEV_BASE_URL", jev.URL)
			t.Setenv("OPENROUTER_API_KEY", "secret")
			t.Setenv("OPENROUTER_MODEL", "test/model")
			t.Setenv("OPENROUTER_BASE_URL", provider.URL)
			app := fiber.New()
			app.Post("/ai/edit", Edit)
			body, err := json.Marshal(map[string]any{
				"instruction": "Fă editul să curgă natural", "revision": "r1", "fast": fast,
				"project": map[string]any{"duration": 10, "fps": 30, "aspect": "landscape", "tracks": []any{}, "effects": []any{}, "texts": []any{}},
			})
			if err != nil {
				t.Fatal(err)
			}
			response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(string(body))))
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != fiber.StatusBadGateway || calls != 0 || routerCalls != 1 {
				t.Errorf("fast=%v invalid=%v: status=%d executor=%d router=%d, want 502 and one Jev call", fast, invalidReply, response.StatusCode, calls, routerCalls)
			}
			provider.Close()
			jev.Close()
		}
	}
}

func TestEditWithoutOpenRouterKeyFailsBeforeExecutor(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENROUTER_MODEL", "test/model")
	app := fiber.New()
	app.Post("/ai/edit", Edit)
	body := `{"instruction":"Cut this clip","revision":"r1","fast":true,"project":{"duration":0,"fps":30,"aspect":"landscape","tracks":[],"effects":[],"texts":[]}}`
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/ai/edit", strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
}
