package mcpserver

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
)

func TestLocalMediaApprovalGuardsRunBeforeAPICalls(t *testing.T) {
	called := false
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		called = true
		return Response{StatusCode: 200, Body: []byte(`{}`)}, nil
	})
	for _, tool := range []string{"list_local_media", "inspect_local_media", "import_local_media"} {
		args := map[string]any{"projectId": "owned", "rootId": "fans", "userApproved": false}
		if tool != "list_local_media" {
			args["files"] = []any{map[string]any{"file": "photo.png"}}
		}
		result, _ := callTool(t, handler, tool, args)
		if !result.IsError || called {
			t.Fatal("approval guard called API", tool, result)
		}
	}
}

func TestLocalMediaUsesOnlyProjectScopedVersionedRoutes(t *testing.T) {
	var received Request
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		received = request
		return Response{StatusCode: 200, Body: []byte(`{"files":[]}`)}, nil
	})
	result, _ := callTool(t, handler, "list_local_media", map[string]any{"projectId": "owned", "rootId": "fans", "directory": "photos & birds", "userApproved": true})
	if result.IsError || received.Method != "GET" || received.Path != "/v1/projects/owned/media/local?directory=photos+%26+birds&limit=25&offset=0&rootId=fans" {
		t.Fatal(result, received)
	}
	result, _ = callTool(t, handler, "import_local_media", map[string]any{"projectId": "owned", "rootId": "fans", "userApproved": true, "files": []any{map[string]any{"file": "photo.png"}}})
	if result.IsError || received.Method != "POST" || received.Path != "/v1/projects/owned/media/local/import" || strings.Contains(string(received.Body), "projectId") || strings.Contains(string(received.Body), "userApproved") {
		t.Fatal(result, received)
	}
}

func TestLocalInspectionRejectsMalformedAndOversizedEvidence(t *testing.T) {
	for _, value := range []any{
		nil,
		map[string]any{"images": []any{}},
		map[string]any{"images": []any{"not-metadata"}},
		map[string]any{"images": []any{map[string]any{"mimeType": "image/png", "data": "aaaa"}}},
		map[string]any{"images": []any{map[string]any{"mimeType": "image/jpeg", "data": "not-base64"}}},
		map[string]any{"images": []any{map[string]any{"mimeType": "image/jpeg", "data": base64.StdEncoding.EncodeToString(make([]byte, (128<<10)+1))}}},
	} {
		if _, err := localMediaImages(value); err == nil {
			t.Fatal("malformed image evidence accepted")
		}
	}
}

func TestLocalMediaGuidancePreservesNoUploadAndConsentBoundaries(t *testing.T) {
	requireClientLibrary(t)
	guide, err := clientReferenceFixtures.ReadFile("guides/media.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, phrase := range []string{"list_local_media", "inspect_local_media", "import_local_media", "LOCAL_MEDIA_ROOTS_JSON", "read-only", "not zero-copy", "without", "sourceVersion", "separate approval", "do not silently upload"} {
		if !strings.Contains(string(guide), phrase) {
			t.Fatal("media guidance missing", phrase)
		}
	}
}
