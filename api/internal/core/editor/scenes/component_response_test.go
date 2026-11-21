package scenes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

func TestComponentExplanationNeverReachesCompiler(t *testing.T) {
	response := "Voi anima titlul cu o cameră 3D.\n\n```svelte\n<script>const title = 'Salut {lume}';</script>\n<h1>{title}</h1>\n```\n\nLumina urmărește mișcarea."
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		var input map[string]any
		if err := json.Unmarshal([]byte(request.Messages[1].TextContent()), &input); err != nil {
			t.Error(err)
		}
		if input["text"] != "Salut {lume}" || input["prompt"] != "Rotate the camera" || input["visualMode"] != "3d" {
			t.Errorf("copy and directions were merged: %+v", input)
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": response}}}})
	}))
	defer server.Close()
	provider := Provider{Model: "test", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
	runner := NewRunner()
	runner.compile = func(_ context.Context, source string, _ Config, _ compilationMedia) (string, error) {
		if source != "<script>const title = 'Salut {lume}';</script>\n<h1>{title}</h1>" {
			t.Errorf("compiler received prose or fences: %q", source)
		}
		return "preview bundle", nil
	}
	scene, err := runner.prepareScene(context.Background(), t.TempDir(), Request{Prompt: "Rotate the camera", Text: "Salut {lume}", VisualMode: "3d", Width: 320, Height: 180, FPS: 30}, provider, strings.Repeat("d", 32), 0, Definition{End: 1}, 0, func() {})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(scene.Explanation, "Lumina") || scene.Source.Explanation != scene.Explanation || scene.Source.Text != "Salut {lume}" {
		t.Fatalf("missing separate explanation/copy: %+v", scene)
	}
}

func TestComponentResponseRejectsAmbiguousBlocksAndPreservesSeparateNotes(t *testing.T) {
	for _, source := range []string{"Prose without code", "```svelte\n<p>A</p>\n```\n```svelte\n<p>B</p>\n```", "```svelte\n<p>Incomplete</p>"} {
		if _, err := extractComponent(source); err == nil {
			t.Fatalf("accepted ambiguous source: %q", source)
		}
	}
	result, err := normalizeComponentResult(componentResult{Component: "```svelte\n<p>Code only</p>\n```", Explanation: "Separate notes."})
	if err != nil || result.Component != "<p>Code only</p>" || result.Explanation != "Separate notes." {
		t.Fatalf("result=%+v error=%v", result, err)
	}
	windows, err := extractComponent("Design notes.\r\n```svelte\r\n<p>Scene</p>\r\n```\r\nAfterword.")
	if err != nil || windows.Component != "<p>Scene</p>" || !strings.Contains(windows.Explanation, "Afterword") {
		t.Fatalf("CRLF result=%+v error=%v", windows, err)
	}
}
