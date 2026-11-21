package scenes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

func TestSceneQualityAndCopyPolicyReachPlannerAndComponentModel(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		system := request.Messages[0].TextContent()
		for _, rule := range []string{"ART DIRECTION AND VISIBLE ACTION", "central hold", "genuine SceneThree", "Do not add AI-production labels", "Ilustrație AI", "outside the component", "never incremental"} {
			if rule == "never incremental" && request.Tools[0].Function.Name == "plan_scenes" {
				continue
			}
			if !strings.Contains(system, rule) {
				t.Errorf("scene model lacks rule %q", rule)
			}
		}
		arguments := `{"component":"<div>Subject only</div>","explanation":"Design notes, not screen copy."}`
		if request.Tools[0].Function.Name == "plan_scenes" {
			arguments = `{"scenes":[{"title":"Subject","brief":"Meaningful subject/action and hold","end":3}]}`
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"tool_calls": []any{map[string]any{"id": "result", "type": "function", "function": map[string]any{"name": request.Tools[0].Function.Name, "arguments": arguments}}}}}}})
	}))
	defer server.Close()
	provider := Provider{Model: "test", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
	request := Request{Prompt: "A mechanical 3D explanation", VisualMode: "3d", Duration: 3, Width: 640, Height: 360, FPS: 30}
	if _, err := provider.component(context.Background(), request, Definition{End: 3}, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.plan(context.Background(), request, nil, 0); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("unexpected provider requests", calls)
	}
}
