package mcpserver

import (
	"context"
	"net/http"
	"testing"
)

func TestProjectSummaryVerifiesSavedTimelineWithoutDuplicatingCaptionBodies(t *testing.T) {
	const body = `{"id":"owned","version":4,"state":{"schemaVersion":1,"media":[{}],"timeline":{"channels":[{"clips":[{}]}],"textItems":[{"text":"intact"}]}},"presentation":{"lastRender":{"jobId":"render-job","filename":"render.mp4","document":{"texts":[{"text":"intact"}]},"composition":{"id":"composition","duration":56.736,"output":{"resolution":"1080p"}}}}}`
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		return Response{StatusCode: 200, Body: []byte(body)}, nil
	})
	for _, full := range []bool{false, true} {
		result, output := callTool(t, handler, "get_project", map[string]any{"projectId": "owned", "fullResult": full})
		if result.IsError {
			t.Fatal(result)
		}
		fields := output.Data.(map[string]any)
		if (fields["state"] != nil) != full {
			t.Fatal(fields)
		}
		if !full {
			saved := fields["savedTimeline"].(map[string]any)
			render := fields["lastRender"].(map[string]any)
			if saved["present"] != true || saved["clips"] != float64(1) || saved["texts"] != float64(1) || render["jobId"] != "render-job" || render["document"] != nil {
				t.Fatal(fields)
			}
		}
	}
}
