package mcpserver

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestSoundToolsRequireSeparateScopeAndUseOnlyOwnedAPIRoutes(t *testing.T) {
	calls := 0
	handler := NewHandler(func(_ context.Context, headers http.Header, request Request) (Response, error) {
		calls++
		if headers.Get("Authorization") == "" {
			t.Fatal("missing internal authentication")
		}
		if request.Method == "GET" && request.Path != "/v1/sounds/search?license=cc0&limit=8&page=1&query=click" {
			t.Fatal(request)
		}
		if request.Method == "POST" && (request.Path != "/v1/projects/owned/sounds/import" || strings.Contains(string(request.Body), "userApproved")) {
			t.Fatal(request)
		}
		return Response{StatusCode: 200, Body: []byte(`{"sounds":[],"audioVerified":false}`)}, nil
	})
	id := "3849018d-0ac8-4f6b-b44d-5ec26a4b32af"
	version := "sha256:" + strings.Repeat("a", 64)
	for _, item := range []struct {
		name  string
		input map[string]any
	}{
		{"search_sound_effects", map[string]any{"query": "click", "userApproved": false}},
		{"search_sound_effects", map[string]any{"query": "click", "license": "by-nc", "userApproved": true}},
		{"import_sound_effect", map[string]any{"projectId": "owned", "id": id, "sourceVersion": version, "userApproved": false}},
		{"import_sound_effect", map[string]any{"projectId": "../other", "id": id, "sourceVersion": version, "userApproved": true}},
		{"import_sound_effect", map[string]any{"projectId": "owned", "id": "https://internal/", "sourceVersion": version, "userApproved": true}},
	} {
		result, _ := callTool(t, handler, item.name, item.input)
		if !result.IsError {
			t.Fatal("accepted invalid/unauthorized scope", item)
		}
	}
	if calls != 0 {
		t.Fatal("rejected tools reached API")
	}
	for _, item := range []struct {
		name  string
		input map[string]any
	}{
		{"search_sound_effects", map[string]any{"query": "click", "userApproved": true}},
		{"import_sound_effect", map[string]any{"projectId": "owned", "id": id, "sourceVersion": version, "userApproved": true}},
	} {
		result, output := callTool(t, handler, item.name, item.input)
		if result.IsError || output.StatusCode != 200 {
			t.Fatal(result, output)
		}
	}
	if calls != 2 {
		t.Fatal("unexpected calls", calls)
	}
}
