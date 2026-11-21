package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/typesafe"
)

func TestOptionalChoiceRoutingRetainsAPIAuthenticationBillingAndNoExecution(t *testing.T) {
	fixture := newMCPFixture(t)
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/systemone" || r.Header.Get("Authorization") != "Bearer router-provider-key" {
			t.Error("unexpected provider endpoint or customer credential forwarded")
		}
		var request typesafe.Request
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		question := request.Questions["next_tool"]
		if question.Type != "choice" || question.Criteria["defer"] == "" {
			t.Error("missing bounded choice question")
		}
		probabilities := make(map[string]float64, len(question.Criteria))
		for name := range question.Criteria {
			probabilities[name] = 0
		}
		probabilities["validate_recipe"] = 1
		confidence := 0.95
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"id": "routing-generation", "usage": map[string]any{"cost": 0.01},
			"answers": map[string]typesafe.Answer{"next_tool": {
				Type: "choice", Choice: "validate_recipe", Confidence: &confidence, Probabilities: probabilities,
			}},
		}); err != nil {
			t.Error(err)
		}
	}))
	defer provider.Close()
	t.Setenv("OPENROUTER_API_KEY", "router-provider-key")
	t.Setenv("OPENROUTER_JEV_BASE_URL", provider.URL)
	post := func(key string) *http.Response {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, "/v1/ai/tool-selection", strings.NewReader(`{"prompt":"Validate the recipe","strategy":"choice"}`))
		request.Header.Set("Content-Type", "application/json")
		if key != "" {
			request.Header.Set("Authorization", "Bearer "+key)
		}
		response, err := fixture.app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { response.Body.Close() })
		return response
	}
	if response := post(""); response.StatusCode != http.StatusUnauthorized || calls != 0 {
		t.Fatal("routing bypassed authentication", response.StatusCode, calls)
	}
	fixture.unpaid.Store(true)
	if response := post(mcpAliceKey); response.StatusCode != http.StatusPaymentRequired || calls != 0 {
		t.Fatal("routing bypassed active membership", response.StatusCode, calls)
	}
	fixture.unpaid.Store(false)
	fixture.revoked.Store(true)
	if response := post(mcpAliceKey); response.StatusCode != http.StatusUnauthorized || calls != 0 {
		t.Fatal("routing bypassed key revocation", response.StatusCode, calls)
	}
	fixture.revoked.Store(false)
	before, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil {
		t.Fatal(err)
	}
	response := post(mcpAliceKey)
	var result struct {
		Executed bool `json:"executed"`
		Cost     struct {
			OperationID string  `json:"operationId"`
			Status      string  `json:"status"`
			Known       float64 `json:"knownCredits"`
		} `json:"cost"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || calls != 1 || result.Executed || len(fixture.jobs.items) != 0 || result.Cost.Status != "final" || result.Cost.Known <= 0 {
		t.Fatalf("status=%d calls=%d result=%+v jobs=%d", response.StatusCode, calls, result, len(fixture.jobs.items))
	}
	after, err := fixture.billing.Store.Balance("mcpalice", true)
	if err != nil || len(result.Cost.OperationID) != 32 || after.Remaining != before.Remaining-result.Cost.Known || after.UsagePending || after.Reserved != 0 {
		t.Fatal("routing lost credit accounting", before, after, result.Cost, err)
	}
}
