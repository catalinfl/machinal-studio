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

func relevanceResponse(score float64) typesafe.Response {
	response := typesafe.Response{Answers: make(map[string]typesafe.Answer)}
	for _, tool := range Catalog {
		value := score
		response.Answers[tool.Name] = typesafe.Answer{Type: "noul", Noul: &value}
	}
	return response
}

func TestSuggestionsAreBoundedAndOnlyKnownToolsCanBeReturned(t *testing.T) {
	response := relevanceResponse(0.7)
	malicious := 1.0
	response.Answers["execute_shell"] = typesafe.Answer{Type: "noul", Noul: &malicious}
	candidates, err := parseCandidates(response)
	if err != nil || len(candidates) != maxCandidates {
		t.Fatal(candidates, err)
	}
	for _, candidate := range candidates {
		if candidate.Name == "execute_shell" || candidate.Name == "suggest_tools" {
			t.Fatal("unknown or recursive tool suggested")
		}
	}
	for _, value := range []float64{-0.1, 1.1, math.NaN(), math.Inf(1)} {
		response = relevanceResponse(value)
		if _, err := parseCandidates(response); err == nil {
			t.Fatal("invalid score accepted", value)
		}
	}
	if _, err := parseCandidates(typesafe.Response{}); err == nil {
		t.Fatal("missing answers accepted")
	}
}

func TestRouterUsesServerOpenRouterKeyAndNeverExecutesSuggestions(t *testing.T) {
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/systemone" || r.Header.Get("Authorization") != "Bearer provider-key" {
			t.Error("wrong router endpoint or credential")
		}
		var request typesafe.Request
		if json.NewDecoder(r.Body).Decode(&request) != nil || request.Model != "typesafe/jev-1.13" || len(request.Questions) != len(Catalog) {
			t.Error("invalid routing request", request)
		}
		response := relevanceResponse(0.1)
		value := 0.95
		response.Answers["get_video_result"] = typesafe.Answer{Type: "noul", Noul: &value}
		json.NewEncoder(w).Encode(response)
	}))
	defer provider.Close()
	t.Setenv("OPENROUTER_API_KEY", "provider-key")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL+"/v1")
	t.Setenv("OPENROUTER_JEV_BASE_URL", "")
	t.Setenv("OPENROUTER_JEV_MODEL", "")
	app := fiber.New()
	app.Post("/suggest", Validate, Select)
	response, err := app.Test(httptest.NewRequest("POST", "/suggest", strings.NewReader(`{"prompt":"Dă-mi linkul video-ului final"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result struct {
		Candidates []Candidate `json:"candidates"`
		Executed   bool        `json:"executed"`
	}
	if json.NewDecoder(response.Body).Decode(&result) != nil || response.StatusCode != 200 || calls != 1 || result.Executed || len(result.Candidates) != 1 || result.Candidates[0].Name != "get_video_result" {
		t.Fatal(response.StatusCode, result, calls)
	}
}
