package mcpserver

import (
	"context"
	"net/http"
	"testing"
)

func TestMediaConsentNeverAccessesAPIBeforeApproval(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("unapproved access reached API")
		return Response{}, nil
	})
	for _, test := range []struct {
		name string
		args map[string]any
	}{
		{"list_media", map[string]any{"projectId": "owned", "userApproved": false}},
		{"get_asset_metadata", map[string]any{"projectId": "owned", "files": []any{}, "userApproved": false}},
		{"get_media_download", map[string]any{"projectId": "owned", "file": "clip.mp4", "userApproved": false}},
		{"get_video_result", map[string]any{"projectId": "owned", "jobId": testJobID, "userApproved": false}},
		{"render_video", map[string]any{"projectId": "owned", "composition": "document: {}", "idempotencyKey": "one", "userApproved": false}},
		{"generate_assets", map[string]any{"projectId": "owned", "composition": "document: {}", "idempotencyKey": "one", "userApproved": false}},
		{"compile_scene", map[string]any{"projectId": "owned", "component": "<p>Scene</p>", "duration": 2, "width": 320, "height": 180, "fps": 30, "idempotencyKey": "one", "userApproved": false}},
		{"get_scene_source", map[string]any{"projectId": "owned", "file": "scene.scene.json", "userApproved": false}},
		{"set_download_preferences", map[string]any{"directory": "C:\\Videos", "userApproved": false}},
		{"revoke_delivery_link", map[string]any{"projectId": "owned", "linkId": "link", "userApproved": false}},
	} {
		result, _ := callTool(t, handler, test.name, test.args)
		if !result.IsError {
			t.Fatalf("accepted unapproved %s", test.name)
		}
		delete(test.args, "userApproved")
		result, _ = callTool(t, handler, test.name, test.args)
		if !result.IsError {
			t.Fatalf("accepted omitted approval for %s", test.name)
		}
	}
	result, output := callTool(t, handler, "request_media_access", map[string]any{"projectId": "owned", "purpose": "list"})
	if result.IsError || output.Data.(map[string]any)["accessPerformed"] != false {
		t.Fatal("requesting consent must not grant access", result, output)
	}
}

func TestApprovedMediaDownloadsRespectStorageAndPreferences(t *testing.T) {
	for _, storage := range []string{"volume"} {
		t.Run(storage, func(t *testing.T) {
			var paths []string
			handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
				paths = append(paths, request.Path)
				switch request.Path {
				case "/v1/projects/owned/media/delivery-links":
					if request.Method != "POST" || string(request.Body) != `{"file":"clip.mp4","storage":"`+storage+`"}` {
						t.Fatal("changed download scope", request)
					}
					return Response{StatusCode: 201, Body: []byte(`{"url":"https://api.example/deliveries/opaque","authentication":"none"}`)}, nil
				case "/v1/preferences/downloads":
					return Response{StatusCode: 200, Body: []byte(`{"directory":"/home/user/Videos"}`)}, nil
				default:
					t.Fatalf("unexpected path: %s", request.Path)
					return Response{}, nil
				}
			})
			result, output := callTool(t, handler, "get_media_download", map[string]any{"projectId": "owned", "file": "clip.mp4", "storage": storage, "delivery": "local", "userApproved": true})
			if result.IsError {
				t.Fatal(result)
			}
			data := output.Data.(map[string]any)
			download := data["download"].(map[string]any)
			if download["url"] != "https://api.example/deliveries/opaque" || len(paths) != 2 {
				t.Fatal(paths, download)
			}
			if data["destination"].(map[string]any)["directory"] != "/home/user/Videos" {
				t.Fatal(data)
			}
		})
	}
}

func TestLinkDeliveryDoesNotRequireALocalDirectoryOrExposeS3(t *testing.T) {
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		if request.Path != "/v1/projects/owned/media/delivery-links" {
			t.Fatal("link delivery queried local preferences or a raw signed URL", request.Path)
		}
		return Response{StatusCode: 201, Body: []byte(`{"url":"https://api.example/deliveries/opaque","expiresAt":"2026-10-24T13:00:00Z"}`)}, nil
	})
	result, output := callTool(t, handler, "get_media_download", map[string]any{"projectId": "owned", "file": "clip.mp4", "userApproved": true})
	data := output.Data.(map[string]any)
	if result.IsError || data["delivery"] != "link" || data["destination"] != nil {
		t.Fatal(result, output)
	}
}

func TestInvalidMediaArgumentsDoNotReachAPI(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("invalid media arguments reached API")
		return Response{}, nil
	})
	for _, name := range []string{"../private.mp4", "https://evil.test/clip.mp4", ".private.mp4", "a\\b.mp4", "clip\r\n.mp4"} {
		result, _ := callTool(t, handler, "get_media_download", map[string]any{"projectId": "owned", "file": name, "userApproved": true})
		if !result.IsError {
			t.Fatal("accepted", name)
		}
	}
	for _, args := range []map[string]any{
		{"projectId": "owned", "storage": "bucket-root", "userApproved": true},
		{"projectId": "owned", "limit": 101, "userApproved": true},
		{"projectId": "owned", "offset": -1, "userApproved": true},
	} {
		result, _ := callTool(t, handler, "list_media", args)
		if !result.IsError {
			t.Fatal("accepted", args)
		}
	}
}
