package scenes

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/core/editor/subtitles"
	"ffmpeg-go-server/internal/integrations/openrouter"
	"github.com/gofiber/fiber/v2"
)

func TestVoicePlanCoversRecordingAndLocalizesWordTiming(t *testing.T) {
	r := Request{Prompt: "Explain growth", Duration: 8, Width: 1280, Height: 720, FPS: 30}
	plan, err := normalizePlan([]Definition{{Title: "Seed", Brief: "Seed sprouts", End: 3.01}, {Title: "Tree", Brief: "Branches unfold", End: 6}}, r, 6.01)
	if err != nil {
		t.Fatal(err)
	}
	if plan[0].Start != 0 || plan[1].Start != plan[0].End || plan[1].End != 181.0/30 {
		t.Fatalf("coverage: %+v", plan)
	}
	cues := relativeCues([]subtitles.Cue{{Start: 2.8, End: 3.4, Text: "new roots", Words: []subtitles.CueWord{{Start: 2.8, End: 3.1, Text: "new"}, {Start: 3.1, End: 3.4, Text: "roots"}}}}, plan[1])
	if len(cues) != 1 || cues[0].Start != 0 || len(cues[0].Words) != 2 || cues[0].Words[0].Start != 0 {
		t.Fatalf("local cues: %+v", cues)
	}
	if _, err := normalizePlan([]Definition{{Title: "One", Brief: "Too long", End: 70}}, r, 70); err == nil {
		t.Fatal("accepted overlong scene")
	}
	if _, err := normalizePlan([]Definition{{Title: "A", Brief: "A", End: 2}, {Title: "B", Brief: "B", End: 1}, {Title: "C", Brief: "C", End: 6}}, r, 6); err == nil {
		t.Fatal("accepted backwards boundaries")
	}
}

func TestRemoteRenderAndImportVerifyFingerprint(t *testing.T) {
	video := []byte("rendered video bytes")
	root := t.TempDir()
	hash := sha256.Sum256(video)
	manifest := map[string]any{"version": 1, "sha256": hex.EncodeToString(hash[:]), "size": len(video), "duration": 1, "width": 320, "height": 180, "fps": 30, "frames": 30, "hasAudio": false, "scene": map[string]any{"version": 1, "sceneId": "generated", "config": Config{Width: 320, Height: 180, FPS: 30, Frames: 30}}}
	encoded, _ := json.Marshal(manifest)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer worker-secret" {
			t.Error("worker credential missing")
		}
		w.Header().Set("X-Scene-Manifest", base64.StdEncoding.EncodeToString(encoded))
		w.Write(video)
	}))
	defer server.Close()
	t.Setenv("SCENE_SERVICE_URL", server.URL)
	t.Setenv("SCENE_SERVICE_TOKEN", "worker-secret")
	output := filepath.Join(root, "scene.mp4")
	result, err := renderRemote(context.Background(), "<p>Scene</p>", Config{Width: 320, Height: 180, FPS: 30, Frames: 30}, nil, nil, output)
	if err != nil {
		t.Fatal(err)
	}
	scene, err := importScene(root, "scene.mp4", "scene-id", result, false)
	if err != nil {
		t.Fatal(err)
	}
	if scene.Asset.File != "scene.mp4" || scene.Asset.Kind != "video" || scene.Asset.HasAudio {
		t.Fatalf("asset: %+v", scene.Asset)
	}
	if err := os.WriteFile(output, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := importScene(root, "scene.mp4", "scene-id", result, false); err == nil {
		t.Fatal("accepted mismatched video bytes")
	}
}

func TestStatusAndCancelAreScopedToOwnedSession(t *testing.T) {
	runner := NewRunner()
	id := strings.Repeat("a", 32)
	runner.update("owner", Job{ID: id, Status: "generating", Scenes: []Scene{}})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner.cancels["owner/"+id] = cancel
	app := fiber.New()
	app.Delete("/scenes/:id", runner.Cancel)
	request := httptest.NewRequest(http.MethodDelete, "/scenes/"+id, nil)
	request.Header.Set("X-Session-Id", "other")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound || ctx.Err() != nil {
		t.Fatal("cross-session cancellation succeeded")
	}
	request = httptest.NewRequest(http.MethodDelete, "/scenes/"+id, nil)
	request.Header.Set("X-Session-Id", "owner")
	response, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent || ctx.Err() != context.Canceled {
		t.Fatal("owner could not cancel job")
	}
}

func TestProviderProducesARealComponentContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.ToolChoice.Function.Name != "create_component" || !strings.Contains(request.Messages[0].TextContent(), "arbitrary frames") {
			t.Error("missing frame contract")
		}
		if request.Reasoning == nil || request.Reasoning.Enabled == nil || *request.Reasoning.Enabled {
			t.Error("scene request must explicitly disable default reasoning")
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"tool_calls": []any{map[string]any{"function": map[string]any{"name": "create_component", "arguments": `{"component":"<p>A real scene</p>"}`}}}}}}})
	}))
	defer server.Close()
	provider := Provider{Model: "test-model", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
	source, err := provider.component(context.Background(), Request{Width: 320, Height: 180, FPS: 30}, Definition{End: 1}, "", "")
	if err != nil || source.Component != "<p>A real scene</p>" {
		t.Fatalf("component: %+v %v", source, err)
	}
}

func TestSceneRequestsDisableReasoningOnTheWire(t *testing.T) {
	for _, name := range []string{"create_component", "plan_scenes"} {
		t.Run(name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				var reasoning map[string]json.RawMessage
				if err := json.Unmarshal(body["reasoning"], &reasoning); err != nil {
					t.Error("reasoning configuration missing", err)
				}
				if string(reasoning["enabled"]) != "false" {
					t.Error("reasoning.enabled=false was omitted or changed")
				}
				var budget int
				if err := json.Unmarshal(body["max_tokens"], &budget); err != nil {
					t.Error(err)
				}
				if name == "create_component" && budget != 16000 || name == "plan_scenes" && budget != 4096 {
					t.Errorf("unexpected budget %d for %s", budget, name)
				}
				fmt.Fprintf(w, `{"choices":[{"finish_reason":"tool_calls","message":{"tool_calls":[{"function":{"name":%q,"arguments":"{\"result\":\"ready\"}"}}]}}],"usage":{"completion_tokens":64,"completion_tokens_details":{"reasoning_tokens":0}}}`, name)
			}))
			defer server.Close()
			provider := Provider{Model: "deepseek/deepseek-v4.1-flash", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
			var result struct {
				Result string `json:"result"`
			}
			if err := provider.call(context.Background(), "Return a result.", "Test input", name, map[string]any{"result": map[string]any{"type": "string"}}, &result); err != nil {
				t.Fatal(err)
			}
			if calls != 1 || result.Result != "ready" {
				t.Fatalf("calls=%d result=%+v", calls, result)
			}
		})
	}
}

func TestReasoningExhaustionIsSpecificAndNotRetried(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		fmt.Fprint(w, `{"id":"generation-test","choices":[{"finish_reason":"length","message":{"content":null,"tool_calls":[]}}],"usage":{"completion_tokens":16000,"completion_tokens_details":{"reasoning_tokens":16000}}}`)
	}))
	defer server.Close()
	provider := Provider{Model: "deepseek/deepseek-v4.1-flash", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
	_, err := provider.component(context.Background(), Request{Width: 320, Height: 180, FPS: 30}, Definition{End: 1}, "", "")
	if err == nil || !strings.Contains(err.Error(), "internal reasoning") || strings.Contains(err.Error(), "simpler scene") {
		t.Fatalf("misleading failure: %v", err)
	}
	if calls != 1 {
		t.Fatalf("a billed empty response was automatically retried %d times", calls)
	}
}

func TestPrepareRepairsComponentWithoutRenderingVideo(t *testing.T) {
	root := t.TempDir()
	turns := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		turns++
		if turns == 2 {
			var request openrouter.ChatCompletionRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(request.Messages[1].TextContent(), "bad syntax") {
				t.Error("repair missing compiler diagnostic")
			}
		}
		fmt.Fprint(w, `{"choices":[{"message":{"tool_calls":[{"function":{"name":"create_component","arguments":"{\"component\":\"<p>Repaired animation</p>\"}"}}]}}]}`)
	}))
	defer server.Close()
	provider := Provider{Model: "test", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
	runner := NewRunner()
	compilations := 0
	runner.compile = func(ctx context.Context, component string, config Config, _ compilationMedia) (string, error) {
		compilations++
		if compilations == 1 {
			return "", &componentError{diagnostic: "bad syntax"}
		}
		return "compiled preview JavaScript", nil
	}
	scene, err := runner.prepareScene(context.Background(), root, Request{Width: 320, Height: 180, FPS: 30}, provider, strings.Repeat("a", 32), 0, Definition{Title: "Roots", Brief: "Roots unfold", End: 31.0 / 30}, 0, func() {})
	if err != nil {
		t.Fatal(err)
	}
	if turns != 2 || compilations != 2 || scene.Source == nil || scene.Source.JavaScript == "" || scene.Asset.Duration.Seconds() < 1 {
		t.Fatalf("prepared: %+v turns=%d compilations=%d", scene, turns, compilations)
	}
	if _, err := os.Stat(filepath.Join(root, scene.Asset.File)); err != nil {
		t.Fatal(err)
	}
	source, err := ReadSource(root, scene.Asset.File)
	if err != nil || source.Title != "Roots" {
		t.Fatal("generated source lost its title", source.Title, err)
	}
	if outputs, _ := filepath.Glob(filepath.Join(root, "*.mp4")); len(outputs) != 0 {
		t.Fatal("generation rendered a video")
	}
}

func TestProviderAcceptsResponseTextAndReportsIncompleteOutput(t *testing.T) {
	for _, tc := range []struct {
		name, text, finish string
		wantError          bool
	}{
		{"json", `{"component":"<p>Scene</p>"}`, "stop", false},
		{"svelte", "```svelte\n<p>Scene</p>\n```", "stop", false},
		{"empty", "", "stop", true},
		{"truncated", "<p>Scene</p>", "length", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": tc.finish, "message": map[string]any{"content": tc.text}}}})
			}))
			defer server.Close()
			provider := Provider{Model: "test", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
			component, err := provider.component(context.Background(), Request{Width: 320, Height: 180, FPS: 30}, Definition{End: 1}, "", "")
			if (err != nil) != tc.wantError {
				t.Fatalf("source=%+v error=%v", component, err)
			}
			if !tc.wantError && component.Component != "<p>Scene</p>" {
				t.Fatalf("source=%+v", component)
			}
		})
	}
}

func TestPromptGenerationNeedsOneAIRequestAndNoVideo(t *testing.T) {
	turns := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		turns++
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.ToolChoice.Function.Name != "create_component" {
			t.Error("prompt made an unnecessary planning call")
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"<p>Scene</p>"}}]}`)
	}))
	defer server.Close()
	provider := Provider{Model: "test", Client: openrouter.Client{APIKey: "test", BaseURL: server.URL, HTTPClient: server.Client()}}
	runner := NewRunner()
	runner.compile = func(context.Context, string, Config, compilationMedia) (string, error) { return "preview bundle", nil }
	job := Job{ID: strings.Repeat("a", 32), Scenes: []Scene{}}
	root := t.TempDir()
	if err := runner.generate(context.Background(), "test", root, Request{Prompt: "Bouncing ball", Duration: 2, Width: 320, Height: 180, FPS: 30}, provider, &job, func(status, message string, ratio float64) {}); err != nil {
		t.Fatal(err)
	}
	if turns != 1 || len(job.Scenes) != 1 || job.Scenes[0].Source == nil {
		t.Fatalf("turns=%d scenes=%+v", turns, job.Scenes)
	}
	if job.Scenes[0].Title != "Bouncing ball" || job.Scenes[0].Source.Title != "Bouncing ball" {
		t.Fatal("prompt generation lost its descriptive title", job.Scenes[0])
	}
	if files, _ := filepath.Glob(filepath.Join(root, "*.mp4")); len(files) != 0 {
		t.Fatal("unexpected MP4")
	}
}

func TestStatusWaitsForChangedRevision(t *testing.T) {
	runner := NewRunner()
	id := strings.Repeat("b", 32)
	job := runner.update("owner", Job{ID: id, Status: "generating", Progress: 0.2})
	app := fiber.New()
	started := make(chan struct{})
	app.Get("/scenes/:id", func(c *fiber.Ctx) error { close(started); return runner.Status(c) })
	request := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/scenes/%s?revision=%d", id, job.Revision), nil)
	request.Header.Set("X-Session-Id", "owner")
	go func() {
		<-started
		time.Sleep(30 * time.Millisecond)
		runner.update("owner", Job{ID: id, Status: "completed", Progress: 1})
	}()
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result Job
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || result.Revision <= job.Revision {
		t.Fatalf("stale status: %+v", result)
	}
}

func TestNativeNarrationMux(t *testing.T) {
	video := os.Getenv("SCENE_NATIVE_VIDEO")
	probe := os.Getenv("SCENE_FFPROBE")
	if video == "" || probe == "" {
		t.Skip("set SCENE_NATIVE_VIDEO and SCENE_FFPROBE for native narration verification")
	}
	root := t.TempDir()
	voice := filepath.Join(root, "voice.wav")
	command := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", voice)
	if data, err := command.CombinedOutput(); err != nil {
		t.Fatalf("create narration: %v %s", err, data)
	}
	output := filepath.Join(root, "narrated.mp4")
	if err := muxVoice(context.Background(), root, "voice.wav", video, output, Definition{Start: 0.5, End: 1.5}); err != nil {
		t.Fatal(err)
	}
	data, err := exec.Command(probe, "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", output).Output()
	if err != nil {
		t.Fatal(err)
	}
	var metadata struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(data, &metadata); err != nil {
		t.Fatal(err)
	}
	if len(metadata.Streams) != 2 || metadata.Streams[0].Width != 320 || metadata.Streams[1].CodecType != "audio" {
		t.Fatalf("narrated streams: %s", data)
	}
	duration, err := strconv.ParseFloat(metadata.Format.Duration, 64)
	if err != nil || math.Abs(duration-1) > 0.05 {
		t.Fatalf("narrated duration: %s", data)
	}
}
