package typesafe

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEvaluateSendsTypedQuestionsAndReadsAnswers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/systemone" || r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("unexpected TypeSafe request: %s %s", r.Method, r.URL.Path)
		}
		var request Request
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.Model != "typesafe/jev-1.13" || request.Questions["tool_cut"].Type != "noul" {
			t.Errorf("request = %+v", request)
		}
		_, _ = w.Write([]byte(`{"model":"typesafe/jev-1.13-20260917","answers":{"tool_cut":{"type":"noul","noul":0.93}}}`))
	}))
	defer server.Close()
	client := Client{APIKey: "secret", BaseURL: server.URL}
	response, err := client.Evaluate(context.Background(), Request{
		Model: "typesafe/jev-1.13", State: "Cut this clip",
		Questions: map[string]Question{"tool_cut": {Type: "noul", Instructions: "Does the edit require a cut?"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Model != "typesafe/jev-1.13-20260917" || response.Answers["tool_cut"].Noul == nil || *response.Answers["tool_cut"].Noul != 0.93 {
		t.Fatalf("response = %+v", response)
	}
}

func TestEvaluateRetriesRateLimitThenReturnsResult(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(`{"model":"typesafe/jev-1.13-20260917","answers":{"tool_cut":{"type":"noul","noul":0.91}}}`))
	}))
	defer server.Close()
	client := Client{APIKey: "secret", BaseURL: server.URL, MaxAttempts: 2}
	if _, err := client.Evaluate(context.Background(), Request{Model: "typesafe/jev-1.13"}); err != nil || calls != 2 {
		t.Fatalf("calls=%d error=%v", calls, err)
	}
}

func TestEvaluateReturnsStatusWithoutSendingKeyToCaller(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"detail":"secret"}`))
	}))
	defer server.Close()
	_, err := (Client{APIKey: "secret", BaseURL: server.URL}).Evaluate(context.Background(), Request{Model: "typesafe/jev-1.13"})
	var status *StatusError
	if !errors.As(err, &status) || status.Code != http.StatusUnauthorized || err.Error() != "OpenRouter Jev returned HTTP 401" {
		t.Fatalf("error = %v", err)
	}
}
