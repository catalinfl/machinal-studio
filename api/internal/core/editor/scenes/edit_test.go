package scenes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

func TestSceneEditUsesExistingSourceAndKeepsImagesAndNarration(t *testing.T) {
	root := t.TempDir()
	filename := "ai_scene_" + strings.Repeat("a", 32) + "_01.scene.json"
	base := LiveSource{Version: 1, Title: "Pădurea prinde viață", Component: "<p>Original scene</p>", JavaScript: "original bundle", Config: Config{Width: 320, Height: 180, FPS: 24, Frames: 48, Transparent: true, CaptionSafeBottom: 0.24},
		Text: "Original scene", VisualMode: "3d", Videos: map[string]string{"video_1": "data:video/mp4;base64,aGVsbG8="},
		Images: map[string]string{"image_1": "data:image/png;base64,aGVsbG8="}, Audio: &Narration{File: "voice.wav", Start: 3, Duration: 10}}
	if err := saveJSON(filepath.Join(root, filename), base); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(root, filename))
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		var input struct {
			Previous string       `json:"previousComponent"`
			Prompt   string       `json:"prompt"`
			Config   Config       `json:"config"`
			Images   []SceneImage `json:"images"`
			Videos   []SceneVideo `json:"videos"`
		}
		if err := json.Unmarshal([]byte(request.Messages[1].TextContent()), &input); err != nil {
			t.Error(err)
		}
		if input.Previous != base.Component || input.Prompt != "Make the text blue" || input.Config.Width != 320 || input.Config.Frames != 73 || !input.Config.Transparent || len(input.Images) != 1 || input.Images[0].ID != "image_1" || len(input.Videos) != 1 || input.Videos[0].ID != "video_1" {
			t.Errorf("edit lost existing source or configuration: %+v", input)
		}
		if !strings.Contains(request.Messages[0].TextContent(), "EDIT of previousComponent") {
			t.Error("missing edit instruction")
		}
		if !strings.Contains(request.Messages[0].TextContent(), "TRANSPARENT OVERLAY") {
			t.Error("edit lost the transparent overlay instruction")
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"<p style='color:blue'>Original scene</p>"}}]}`)
	}))
	defer server.Close()
	provider := Provider{Model: "test", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
	runner := NewRunner()
	runner.compile = func(_ context.Context, _ string, config Config, media compilationMedia) (string, error) {
		if media.Images["image_1"] != base.Images["image_1"] || media.Videos["video_1"] != base.Videos["video_1"] || config.CaptionSafeBottom != base.Config.CaptionSafeBottom {
			t.Fatal("layout inspection lost the original media or caption band")
		}
		return "edited bundle", nil
	}
	job := Job{ID: strings.Repeat("b", 32)}
	request := Request{SourceFile: filename, Prompt: "Make the text blue", Duration: 3.01, Width: 1280, Height: 720, FPS: 30}
	if err := runner.generate(context.Background(), "test", root, request, provider, &job, func(string, string, float64) {}); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || len(job.Scenes) != 1 {
		t.Fatalf("calls=%d scenes=%d", calls, len(job.Scenes))
	}
	edited := job.Scenes[0].Source
	if edited.Title != base.Title || job.Scenes[0].Title != base.Title {
		t.Fatal("edit replaced the descriptive title", edited.Title, job.Scenes[0].Title)
	}
	if edited.Audio == nil || *edited.Audio != *base.Audio || edited.Images["image_1"] != base.Images["image_1"] || edited.Videos["video_1"] != base.Videos["video_1"] || edited.Text != base.Text || edited.VisualMode != base.VisualMode || edited.Config.FPS != 24 || !edited.Config.Transparent {
		t.Fatalf("edit lost attachments: %+v", edited)
	}
	after, err := os.ReadFile(filepath.Join(root, filename))
	if err != nil || string(before) != string(after) || job.Scenes[0].Asset.File == filename {
		t.Fatal("edit changed the original immutable source")
	}
}

func TestSceneEditRejectsInvalidSourceAndConflictingInputs(t *testing.T) {
	base := Request{SourceFile: "ai_scene_" + strings.Repeat("a", 32) + "_01.scene.json", Prompt: "Change colors", Duration: 2, Width: 320, Height: 180, FPS: 30}
	for _, change := range []func(*Request){
		func(r *Request) { r.SourceFile = "../another.scene.json" },
		func(r *Request) { r.Prompt = " " },
		func(r *Request) { r.AudioFile = "new.wav" },
		func(r *Request) { r.Images = []SceneImage{{ID: "image_1"}} },
		func(r *Request) { r.Videos = []SceneVideo{{ID: "video_1"}} },
	} {
		request := base
		change(&request)
		if request.validate() == nil {
			t.Fatalf("accepted conflicting scene edit: %+v", request)
		}
	}
}
