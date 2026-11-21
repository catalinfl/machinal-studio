package scenes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

func TestTransparentSceneGenerationKeepsAlphaThroughCompilerRepair(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		if !strings.Contains(request.Messages[0].TextContent(), "TRANSPARENT OVERLAY") {
			t.Error("missing transparent component instructions")
		}
		var input struct {
			Config Config `json:"config"`
		}
		if err := json.Unmarshal([]byte(request.Messages[1].TextContent()), &input); err != nil || !input.Config.Transparent {
			t.Error("AI input lost transparent configuration", err)
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"<p>Transparent effect</p>"}}]}`)
	}))
	defer server.Close()
	provider := Provider{Model: "test", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
	runner := NewRunner()
	compiles := 0
	runner.compile = func(_ context.Context, _ string, config Config, _ compilationMedia) (string, error) {
		if !config.Transparent {
			t.Error("compiler lost transparent configuration")
		}
		compiles++
		if compiles == 1 {
			return "", &componentError{diagnostic: "repair this component"}
		}
		return "compiled overlay", nil
	}
	root := t.TempDir()
	request := Request{Prompt: "Draw a glowing arrow", Width: 320, Height: 180, FPS: 30, Duration: 2, Transparent: true}
	scene, err := runner.prepareScene(context.Background(), root, request, provider, strings.Repeat("a", 32), 0, Definition{Title: "Arrow", Brief: request.Prompt, End: 2}, 0, func() {})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := ReadSource(root, scene.Asset.File)
	if err != nil || compiles != 2 || !stored.Config.Transparent || !scene.Source.Config.Transparent {
		t.Fatalf("overlay source=%+v compiles=%d err=%v", stored, compiles, err)
	}
}
