package toolrouting

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/typesafe"

	"github.com/gofiber/fiber/v2"
)

func nextToolResponse(choice string, confidence float64) typesafe.Response {
	probabilities := make(map[string]float64, len(Catalog)+1)
	for name := range choiceRequest("", "").Questions[nextToolQuestion].Criteria {
		probabilities[name] = 0
	}
	probabilities[choice] = 1
	return typesafe.Response{Answers: map[string]typesafe.Answer{nextToolQuestion: {
		Type: "choice", Choice: choice, Confidence: &confidence, Probabilities: probabilities,
	}}}
}

func TestChoiceRequestOffersOnlyKnownToolsAndAnExplicitDefer(t *testing.T) {
	request := choiceRequest("Inspect this source", "router-model")
	question := request.Questions[nextToolQuestion]
	if request.Model != "router-model" || len(request.Questions) != 1 || question.Type != "choice" || len(question.Criteria) != len(Catalog)+1 {
		t.Fatalf("unexpected request: %+v", request)
	}
	if question.Criteria[deferChoice] == "" || question.Criteria["suggest_tools"] != "" {
		t.Fatal("missing fallback or recursive routing choice")
	}
	for _, tool := range Catalog {
		if question.Criteria[tool.Name] != tool.Intent {
			t.Fatalf("stale choice %s", tool.Name)
		}
	}
}

func TestChoiceRoutingDefersOnUncertainty(t *testing.T) {
	for _, tc := range []struct {
		name        string
		choice      string
		confidence  float64
		probability float64
		want        int
	}{
		{"confident", "validate_recipe", 0.95, 1, 1},
		{"boundary", "validate_recipe", minimumConfidence, minimumConfidence, 1},
		{"low confidence", "render_video", 0.79, 1, 0},
		{"low probability", "render_video", 1, 0.79, 0},
		{"defer", deferChoice, 1, 1, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := nextToolResponse(tc.choice, tc.confidence)
			response.Answers[nextToolQuestion].Probabilities[tc.choice] = tc.probability
			if tc.choice != deferChoice {
				response.Answers[nextToolQuestion].Probabilities[deferChoice] = 1 - tc.probability
			}
			candidates, err := routingCandidates(response, choiceStrategy)
			if err != nil || len(candidates) != tc.want {
				t.Fatalf("candidates=%v err=%v", candidates, err)
			}
		})
	}
}

func TestChoiceRoutingRejectsMalformedOrUnlistedAnswers(t *testing.T) {
	for _, mutate := range []func(*typesafe.Answer){
		func(answer *typesafe.Answer) { answer.Type = "noul" },
		func(answer *typesafe.Answer) { answer.Choice = "execute_shell" },
		func(answer *typesafe.Answer) { answer.Confidence = nil },
		func(answer *typesafe.Answer) { value := math.NaN(); answer.Confidence = &value },
		func(answer *typesafe.Answer) { value := 1.1; answer.Confidence = &value },
		func(answer *typesafe.Answer) { delete(answer.Probabilities, "get_credits") },
		func(answer *typesafe.Answer) { answer.Probabilities["execute_shell"] = 0 },
		func(answer *typesafe.Answer) { answer.Probabilities["get_credits"] = math.Inf(1) },
		func(answer *typesafe.Answer) { answer.Probabilities["get_credits"] = -0.1 },
		func(answer *typesafe.Answer) { answer.Probabilities["get_credits"] = 0.5 },
	} {
		response := nextToolResponse("validate_recipe", 1)
		answer := response.Answers[nextToolQuestion]
		mutate(&answer)
		response.Answers[nextToolQuestion] = answer
		if _, err := routingCandidates(response, choiceStrategy); err == nil {
			t.Fatalf("accepted invalid answer: %+v", answer)
		}
	}
	if _, err := routingCandidates(typesafe.Response{}, choiceStrategy); err == nil {
		t.Fatal("accepted missing answer")
	}
}

func TestChoiceEndpointMakesOneProviderCallAndExecutesNothing(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request typesafe.Request
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if len(request.Questions) != 1 || request.Questions[nextToolQuestion].Type != "choice" || r.Header.Get("Authorization") != "Bearer provider-key" {
			t.Errorf("unexpected routing request: %+v", request)
		}
		if err := json.NewEncoder(w).Encode(nextToolResponse("validate_recipe", 0.95)); err != nil {
			t.Error(err)
		}
	}))
	defer provider.Close()
	t.Setenv("OPENROUTER_API_KEY", "provider-key")
	t.Setenv("OPENROUTER_JEV_BASE_URL", provider.URL)
	app := fiber.New()
	app.Post("/suggest", Validate, Select)
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/suggest", strings.NewReader(`{"prompt":"Validate the recipe","strategy":"choice"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result struct {
		Candidates []Candidate `json:"candidates"`
		Strategy   string      `json:"strategy"`
		Executed   bool        `json:"executed"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || calls != 1 || result.Executed || result.Strategy != choiceStrategy || len(result.Candidates) != 1 || result.Candidates[0].Name != "validate_recipe" {
		t.Fatalf("status=%d calls=%d result=%+v", response.StatusCode, calls, result)
	}
}

func TestUnsupportedRoutingStrategyIsRejectedBeforeTheProvider(t *testing.T) {
	app := fiber.New()
	app.Post("/suggest", Validate, func(*fiber.Ctx) error {
		t.Fatal("invalid routing strategy reached execution")
		return nil
	})
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/suggest", strings.NewReader(`{"prompt":"Route","strategy":"execute"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatal(response.StatusCode)
	}
}
