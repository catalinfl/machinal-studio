package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

func TestMediaGuideIsDiscoverableWithoutAccessingCustomerMedia(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("reading media instructions must not access customer data")
		return Response{}, nil
	})
	result, output := callTool(t, handler, "get_editing_reference", map[string]any{"topic": "media"})
	if result.IsError || output.StatusCode != 200 {
		t.Fatal("media reference unavailable", result, output)
	}
	guide := output.Data.(map[string]any)
	if guide["guideUri"] != "machinal://reference/media" {
		t.Fatal("media guide URI missing", guide)
	}
	for _, uri := range []string{"machinal://skills/media", "machinal://reference/media"} {
		_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": uri})
		var resource struct {
			Contents []struct {
				Text string `json:"text"`
			} `json:"contents"`
		}
		if envelope["error"] != nil || json.Unmarshal(envelope["result"], &resource) != nil || len(resource.Contents) != 1 || resource.Contents[0].Text != guide["guide"] {
			t.Fatal("live resource and reference tool diverged", uri)
		}
	}
	content := clientAuthoringGuide(t, "media")
	for _, requirement := range []string{
		"request_media_access", "userApproved", "does not grant", "get_upload_target", "volume only",
		"get_asset_metadata", "get_video_result", "get_media_download", "storage:\"s3\"", "cached:true",
		"get_download_preferences", "set_download_preferences", "data.download.url", "data.destination.directory",
		"Do not attach", "Authorization", "same existing file/job", "LOCAL_MEDIA_ROOTS_JSON", "zero",
		"wait_for_job", "delivery:\"link\"", "delivery:\"local\"", "revoke_delivery_link", "one hour", "Docker",
	} {
		if !strings.Contains(content, requirement) {
			t.Fatalf("media guide lacks required instruction: %q", requirement)
		}
	}
	if !strings.Contains(instructions, "get_editing_reference(topic=media)") || !strings.Contains(recipeGuide, "machinal://skills/media") {
		t.Fatal("MCP initialization/recipe workflow must point agents to the media guide")
	}
}

func TestMediaGuideToolExamplesMatchActualMCPArgumentSchemas(t *testing.T) {
	guide, err := clientReferenceFixtures.ReadFile("guides/media.md")
	if err != nil {
		t.Fatal(err)
	}
	blocks := regexp.MustCompile("(?s)```json\\s*(.*?)\\s*```").FindAllSubmatch(guide, -1)
	if len(blocks) < 8 {
		t.Fatal("media guide needs concrete tool argument examples")
	}
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		return Response{StatusCode: 200, Body: []byte(`{"status":"queued","directory":""}`)}, nil
	})
	for _, block := range blocks {
		var example struct {
			Tool      string         `json:"tool"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(block[1], &example); err != nil {
			t.Fatal(err)
		}
		result, _ := callTool(t, handler, example.Tool, example.Arguments)
		if result.IsError {
			t.Fatalf("documented arguments rejected by %s: %+v", example.Tool, result)
		}
	}
}
