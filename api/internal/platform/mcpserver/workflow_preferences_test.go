package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestWorkflowPreferencesRequireApprovalAndForwardOnlySettings(t *testing.T) {
	calls := 0
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		calls++
		if request.Path != "/v1/preferences/workflow" {
			t.Fatal("wrong preference route", request.Path)
		}
		if request.Method == http.MethodPost {
			var fields map[string]any
			if err := json.Unmarshal(request.Body, &fields); err != nil || len(fields) != 2 || fields["sceneMode"] != "3d" || fields["captionMaxWords"] != float64(4) {
				t.Fatalf("preferences or approval assertion were forwarded incorrectly: %s", request.Body)
			}
		}
		return Response{StatusCode: http.StatusOK, Body: []byte(`{"configured":true}`)}, nil
	})
	args := map[string]any{"sceneMode": "3d", "captionMaxWords": 4, "userApproved": false}
	result, _ := callTool(t, handler, "set_workflow_preferences", args)
	if !result.IsError || calls != 0 {
		t.Fatal("saved preferences without approval")
	}
	args["userApproved"] = true
	result, output := callTool(t, handler, "set_workflow_preferences", args)
	if result.IsError || output.StatusCode != 200 || calls != 1 {
		t.Fatal("approved preference update failed", result, output)
	}
	result, output = callTool(t, handler, "get_workflow_preferences", map[string]any{})
	if result.IsError || output.StatusCode != 200 || calls != 2 {
		t.Fatal("could not read preferences", result, output)
	}
}
