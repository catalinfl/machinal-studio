package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestSceneInspectionRequiresSpecificConsentBeforeDispatch(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("unapproved inspection dispatched")
		return Response{}, nil
	})
	result, _ := callTool(t, handler, "inspect_scene", map[string]any{"projectId": "owned", "file": "test.scene.json", "sourceVersion": "sha256:" + strings.Repeat("a", 64), "frames": []int{0}, "userApproved": false})
	if !result.IsError {
		t.Fatal("inspection did not require consent")
	}
}

func TestSceneInspectionReturnsActualMCPImagesWithoutDuplicatedBase64InMetadata(t *testing.T) {
	version := "sha256:" + strings.Repeat("a", 64)
	file := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		if request.Path != "/v1/projects/owned/scenes/inspect" || request.Method != http.MethodPost {
			t.Fatal(request)
		}
		var body map[string]any
		if err := json.Unmarshal(request.Body, &body); err != nil {
			t.Fatal(err)
		}
		if body["sourceVersion"] != version || body["userApproved"] != nil {
			t.Fatal(body)
		}
		return Response{StatusCode: 200, Body: []byte(`{"file":"` + file + `","sourceVersion":"` + version + `","evidence":{"frames":[{"frame":15,"time":0.5,"mimeType":"image/jpeg","data":"/9j/2Q=="}],"motionVerified":false,"audioVerified":false}}`)}, nil
	})
	result, output := callTool(t, handler, "inspect_scene", map[string]any{"projectId": "owned", "file": file, "sourceVersion": version, "frames": []int{15}, "userApproved": true})
	if result.IsError || len(result.Content) != 2 {
		t.Fatal(result)
	}
	image, ok := result.Content[1].(*mcp.ImageContent)
	if !ok || image.MIMEType != "image/jpeg" || len(image.Data) != 4 {
		t.Fatal("missing native MCP image", result.Content)
	}
	encoded, err := json.Marshal(output.Data)
	if err != nil || strings.Contains(string(encoded), "/9j/2Q==") || strings.Contains(string(encoded), `"data":`) {
		t.Fatal("image bytes duplicated into metadata", string(encoded), err)
	}
}
