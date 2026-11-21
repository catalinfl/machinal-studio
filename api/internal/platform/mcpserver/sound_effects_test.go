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

func TestSoundWorkflowRequiresImplementationWithoutExpandingConsent(t *testing.T) {
	sources := map[string][]string{
		"bootstrap": {
			"Requested sound effects: read animation-skills/machinal-sound",
			"approved YAML audio tracks", "report a blocker",
		},
		"guides/brief.md": {
			"narration alone does not authorize sound effects", "machinal-sound",
			"real YAML audio tracks", "Never silently deliver an effects-free substitute",
		},
		"guides/production.md": {
			"search_sound_effects", "import_sound_effect", "get_asset_metadata",
			"nonzero clip/track gain", "no mute", "Search approval alone is insufficient",
			"never silently deliver an effects-free substitute", "do not prove that the mix was heard",
		},
		"reference/animation-skills/machinal-sound.md": {
			"do not wait for the user to ask again", "real YAML audio tracks",
			"importable: true", "never infer it from a search approval",
			"Never silently deliver an effects-free substitute",
		},
	}
	for path, requirements := range sources {
		t.Run(path, func(t *testing.T) {
			content := clientPolicyFixture("client-bootstrap.md")
			if path != "bootstrap" {
				data, err := clientReferenceFixtures.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				content = string(data)
			}
			for _, requirement := range requirements {
				if !strings.Contains(content, requirement) {
					t.Errorf("missing sound workflow requirement %q", requirement)
				}
			}
		})
	}
}
