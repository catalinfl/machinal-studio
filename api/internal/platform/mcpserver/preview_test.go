package mcpserver

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestPreviewRejectsUnapprovedStaleOrUnboundedWorkBeforeDispatch(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("invalid preview dispatched")
		return Response{}, nil
	})
	for _, mutate := range []func(map[string]any){
		func(args map[string]any) { args["userApproved"] = false },
		func(args map[string]any) { args["duration"] = 16 },
		func(args map[string]any) { args["start"] = -1 },
		func(args map[string]any) { args["expectedCompositionVersion"] = contentVersion([]byte("old")) },
		func(args map[string]any) { delete(args, "expectedCompositionVersion") },
	} {
		args := map[string]any{"projectId": "owned", "composition": "recipe", "idempotencyKey": "preview-once", "userApproved": true, "start": 1.5, "duration": 2, "expectedCompositionVersion": contentVersion([]byte("recipe"))}
		mutate(args)
		result, _ := callTool(t, handler, "render_preview", args)
		if !result.IsError {
			t.Fatal("invalid preview accepted", args)
		}
	}
}

func TestPreviewPreservesExactYAMLAndUsesExistingRenderQueue(t *testing.T) {
	yaml := "document:\n  version: 2\n# Romanian copy: Mișcare\n"
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		if request.Path != "/v1/projects/owned/renders/preview?previewDuration=2&previewStart=1.5" || request.IdempotencyKey != "preview-once" || string(request.Body) != yaml || request.ContentType != "application/yaml" {
			t.Fatal("preview rewrote the recipe or changed dispatch", request)
		}
		return Response{StatusCode: 202, Body: []byte(`{"id":"0123456789abcdef0123456789abcdef","status":"queued"}`)}, nil
	})
	result, output := callTool(t, handler, "render_preview", map[string]any{"projectId": "owned", "composition": yaml, "idempotencyKey": "preview-once", "userApproved": true, "start": 1.5, "duration": 2, "expectedCompositionVersion": contentVersion([]byte(yaml))})
	if result.IsError || output.StatusCode != 202 {
		t.Fatal(result, output)
	}
}

func TestParameterToolRequiresConsentAndDoesNotTransmitReplacementCode(t *testing.T) {
	calls := 0
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		calls++
		if request.Path != "/v1/projects/owned/scenes/compile" || !strings.Contains(string(request.Body), `"parameterPatch"`) || strings.Contains(string(request.Body), "replacement") {
			t.Fatal(request)
		}
		return Response{StatusCode: 202, Body: []byte(`{"status":"queued"}`)}, nil
	})
	args := map[string]any{"projectId": "owned", "file": "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json", "sourceVersion": "sha256:" + strings.Repeat("a", 64), "patch": map[string]any{"receiver": map[string]any{"x": 120}}, "idempotencyKey": "parameters-once", "userApproved": false}
	result, _ := callTool(t, handler, "edit_scene_parameters", args)
	if !result.IsError || calls != 0 {
		t.Fatal("unapproved edit dispatched")
	}
	args["userApproved"] = true
	result, output := callTool(t, handler, "edit_scene_parameters", args)
	if result.IsError || output.StatusCode != 202 || calls != 1 {
		t.Fatal(result, output, calls)
	}
}
