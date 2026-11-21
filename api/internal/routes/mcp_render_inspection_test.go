package routes

import (
	"bytes"
	"encoding/json"
	"image/jpeg"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestInspectCompletedMP4ReturnsFrameAndMeasuredMix(t *testing.T) {
	for _, tool := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skip(tool + " required")
		}
	}
	fixture := newMCPFixture(t)
	root, err := storage.EnsureUserDir(fixture.project.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	const file = "render_inspection.mp4"
	cmd := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=96x64:r=10", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "mpeg4", "-c:a", "aac", filepath.Join(root, file))
	if data, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("fixture: %s: %v", data, err)
	}
	id := strings.Repeat("a", 32)
	fixture.jobs.items[id] = jobqueue.Job{ID: id, Owner: "mcpalice", Session: fixture.project.SessionID, Status: "completed", Kind: "automation-render", Result: json.RawMessage(`{"filename":"render_inspection.mp4"}`)}
	args := map[string]any{"projectId": fixture.project.ID, "jobId": id, "times": []float64{0.5}, "audioSeconds": 1, "userApproved": true}
	foreign, out := mcpTool(t, fixture, mcpBobKey, "inspect_render", args)
	if !foreign.IsError || out.StatusCode != 404 {
		t.Fatal(out)
	}
	result, out := mcpTool(t, fixture, mcpAliceKey, "inspect_render", args)
	if result.IsError || len(result.Content) != 2 {
		t.Fatal(out, result)
	}
	frame, ok := result.Content[1].(*mcp.ImageContent)
	if !ok {
		t.Fatal("not an image")
	}
	if _, err := jpeg.Decode(bytes.NewReader(frame.Data)); err != nil {
		t.Fatal(err)
	}
	audio := out.Data.(map[string]any)["audio"].(map[string]any)
	if audio["status"] != "measured" || audio["integratedLUFS"].(float64) >= 0 || audio["truePeakDBTP"].(float64) >= 0 || audio["clippingRisk"] != false {
		t.Fatal(audio)
	}
	args["times"] = []float64{3}
	result, out = mcpTool(t, fixture, mcpAliceKey, "inspect_render", args)
	if !result.IsError || out.StatusCode != 422 {
		t.Fatal(out)
	}
}
