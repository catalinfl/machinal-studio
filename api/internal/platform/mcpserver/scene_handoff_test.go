package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestSceneHandoffRequiresConsentForBothNamedScenesBeforeDispatch(t *testing.T) {
	version := "sha256:" + strings.Repeat("a", 64)
	args := map[string]any{"projectId": "owned", "file": "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json", "sourceVersion": version,
		"handoff":        map[string]any{"sourceFile": "ai_scene_abcdef0123456789abcdef0123456789_01.scene.json", "sourceVersion": version, "frame": 59, "objects": map[string]string{"receiver": "signal"}},
		"idempotencyKey": "handoff-once", "userApproved": false}
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("unapproved handoff dispatched")
		return Response{}, nil
	})
	result, _ := callTool(t, handler, "handoff_scene", args)
	if !result.IsError {
		t.Fatal("handoff did not require explicit source/edit consent")
	}
	args["userApproved"] = true
	args["handoff"].(map[string]any)["frame"] = -1
	result, _ = callTool(t, handler, "handoff_scene", args)
	if !result.IsError {
		t.Fatal("invalid frame dispatched")
	}
}

func TestSceneHandoffDispatchesImmutableVersionedCompileWithoutReplacementCode(t *testing.T) {
	version := "sha256:" + strings.Repeat("a", 64)
	file := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		if request.Path != "/v1/projects/owned/scenes/compile" || request.Method != http.MethodPost || request.IdempotencyKey != "handoff-once" {
			t.Fatal(request)
		}
		var body map[string]any
		if err := json.Unmarshal(request.Body, &body); err != nil {
			t.Fatal(err)
		}
		handoff := body["handoff"].(map[string]any)
		if body["sourceFile"] != file || body["sourceVersion"] != version || body["userApproved"] != nil || body["component"] != "" || handoff["frame"] != float64(59) {
			t.Fatal(body)
		}
		return Response{StatusCode: 202, Body: []byte(`{"id":"queued"}`)}, nil
	})
	result, output := callTool(t, handler, "handoff_scene", map[string]any{"projectId": "owned", "file": file, "sourceVersion": version,
		"handoff": map[string]any{"sourceFile": file, "sourceVersion": version, "frame": 59, "objects": map[string]string{"receiver": "signal"}}, "idempotencyKey": "handoff-once", "userApproved": true})
	if result.IsError || output.StatusCode != 202 {
		t.Fatal(result, output)
	}
}
