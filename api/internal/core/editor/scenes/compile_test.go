package scenes

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/credits"
)

func clientSceneRequest() CompileRequest {
	return CompileRequest{Component: "<p>Client-authored scene</p>", Title: "Growth", Duration: 2, Width: 320, Height: 180, FPS: 30}
}

func TestClientSceneCompilesWithoutConfiguredAIOrVideoEncoding(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	t.Setenv("OPENROUTER_SCENE_MODEL", "")
	t.Setenv("OPENROUTER_MODEL", "")
	calls := 0
	compiler := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/compile" || r.Header.Get("Authorization") != "Bearer compiler-secret" {
			t.Error("unexpected processing or missing compiler authentication", r.URL.Path)
		}
		var input struct {
			Component     string `json:"component"`
			Config        Config `json:"config"`
			InspectLayout bool   `json:"inspectLayout"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if input.Component != clientSceneRequest().Component || !input.InspectLayout || input.Config.Frames != 60 {
			t.Error("source, exact timing or layout inspection lost", input)
		}
		fmt.Fprint(w, `{"javascript":"compiled-client-preview"}`)
	}))
	defer compiler.Close()
	t.Setenv("SCENE_SERVICE_URL", compiler.URL)
	t.Setenv("SCENE_SERVICE_TOKEN", "compiler-secret")
	root := t.TempDir()
	scene, err := NewRunner().compileSource(credits.WithWorkflowPolicy(context.Background(), credits.MCPFree), "", root, clientSceneRequest())
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || scene.Asset.Duration.Seconds() != 2 || scene.Asset.Version == "" || !IsSource(scene.Asset.File) {
		t.Fatalf("invalid pinned scene: %+v calls=%d", scene, calls)
	}
	source, err := ReadSource(root, scene.Asset.File)
	if err != nil || source.Component != clientSceneRequest().Component || source.JavaScript != "compiled-client-preview" {
		t.Fatal(source, err)
	}
	if files, _ := filepath.Glob(filepath.Join(root, "*.mp4")); len(files) != 0 {
		t.Fatal("source compilation encoded a video")
	}
}

func TestClientSceneFailureReturnsDiagnosticsWithoutServerAIRepair(t *testing.T) {
	providerCalls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		providerCalls++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer provider.Close()
	t.Setenv("OPENROUTER_API_KEY", "unused-provider-key")
	t.Setenv("OPENROUTER_SCENE_MODEL", "unused-scene-model")
	t.Setenv("OPENROUTER_BASE_URL", provider.URL)
	runner := NewRunner()
	compilations := 0
	runner.compile = func(context.Context, string, Config, compilationMedia) (string, error) {
		compilations++
		return "", &componentError{diagnostic: "Line 3: invalid Svelte syntax"}
	}
	root := t.TempDir()
	_, err := runner.compileSource(context.Background(), "", root, clientSceneRequest())
	var rejected *componentError
	if !errors.As(err, &rejected) || !strings.Contains(rejected.diagnostic, "Line 3") || compilations != 1 || providerCalls != 0 {
		t.Fatalf("diagnostic lost or paid repair executed: %v compilations=%d providers=%d", err, compilations, providerCalls)
	}
	files, err := os.ReadDir(root)
	if err != nil || len(files) != 0 {
		t.Fatal("failed source was published", files, err)
	}
}

func TestClientSceneEditPreservesEmbeddedMediaAndOriginalSource(t *testing.T) {
	root := t.TempDir()
	filename := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	original := LiveSource{Version: 1, Component: "<p>Original</p>", JavaScript: "original-bundle", VisualMode: "3d",
		Config: Config{Width: 320, Height: 180, FPS: 30, Frames: 60, VisualMode: "3d", Transparent: true, CaptionSafeBottom: 0.24},
		Images: map[string]string{"image_1": "data:image/png;base64,AAAA"},
		Audio:  &Narration{File: "voice.wav", Start: 3, Duration: 12}}
	if err := saveJSON(filepath.Join(root, filename), original); err != nil {
		t.Fatal(err)
	}
	runner := NewRunner()
	runner.compile = func(_ context.Context, _ string, config Config, media compilationMedia) (string, error) {
		if !config.Transparent || config.VisualMode != "3d" || config.CaptionSafeBottom != 0.24 || media.Images["image_1"] != original.Images["image_1"] {
			t.Fatal("edit lost media or scene constraints", config, media)
		}
		return "updated-bundle", nil
	}
	input := clientSceneRequest()
	input.SourceFile = filename
	scene, err := runner.compileSource(context.Background(), "", root, input)
	if err != nil || scene.Asset.File == filename || scene.Source.Audio == nil || *scene.Source.Audio != *original.Audio {
		t.Fatal("edit failed or overwrote original", scene, err)
	}
	unchanged, err := ReadSource(root, filename)
	if err != nil || unchanged.Component != original.Component || unchanged.JavaScript != original.JavaScript {
		t.Fatal("original source changed", unchanged, err)
	}
}

func TestClientSceneInputRejectsExecutableBundlesPathsAndUnboundedWork(t *testing.T) {
	valid, err := json.Marshal(clientSceneRequest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeCompileRequest(valid); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		strings.TrimSuffix(string(valid), "}") + `,"javascript":"untrusted-bundle"}`,
		string(valid) + `{}`,
		strings.Replace(string(valid), `"duration":2`, `"duration":61`, 1),
		strings.Replace(string(valid), `"width":320`, `"width":321`, 1),
		strings.Replace(string(valid), `"fps":30`, `"fps":0`, 1),
		strings.TrimSuffix(string(valid), "}") + `,"sourceFile":"../../other.scene.json"}`,
	} {
		if _, err := decodeCompileRequest([]byte(body)); err == nil {
			t.Fatalf("accepted invalid client source request: %.160s", body)
		}
	}
	input := clientSceneRequest()
	input.Component = strings.Repeat("x", maxComponentBytes+1)
	if err := input.validate(); err == nil {
		t.Fatal("oversized source accepted")
	}
}

func TestMCPSceneProviderCannotBeCalledEvenWithServerConfiguration(t *testing.T) {
	ctx := credits.WithWorkflowPolicy(context.Background(), credits.MCPMediaOnly)
	_, err := (Provider{}).component(ctx, Request{}, Definition{}, "", "")
	if err == nil || !strings.Contains(err.Error(), "compile_scene") {
		t.Fatal("MCP was allowed to call a server scene model", err)
	}
}

func TestServerSceneRenderingIsBilledOnlyAfterSuccessfulExport(t *testing.T) {
	for _, success := range []bool{false, true} {
		t.Run(fmt.Sprintf("success=%t", success), func(t *testing.T) {
			root := t.TempDir()
			filename := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
			source := LiveSource{Version: 1, Component: "<p>Client scene</p>", JavaScript: "bundle", Config: Config{Width: 320, Height: 180, FPS: 30, Frames: 1800}}
			if err := saveJSON(filepath.Join(root, filename), source); err != nil {
				t.Fatal(err)
			}
			video := []byte("server-rendered-scene")
			digest := sha256.Sum256(video)
			manifest, err := json.Marshal(map[string]any{"version": 1, "size": len(video), "sha256": hex.EncodeToString(digest[:]), "duration": 60,
				"width": 320, "height": 180, "fps": 30, "frames": 1800,
				"scene": map[string]any{"version": 1, "sceneId": "generated", "config": source.Config}})
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/render" {
					t.Error("expected server frame rendering", r.URL.Path)
				}
				if !success {
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				w.Header().Set("X-Scene-Manifest", base64.StdEncoding.EncodeToString(manifest))
				w.Write(video)
			}))
			defer server.Close()
			t.Setenv("SCENE_SERVICE_URL", server.URL)
			store, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			if err := store.Begin("alice", "export", true); err != nil {
				t.Fatal(err)
			}
			ctx := credits.WithWorkflowPolicy(context.Background(), credits.MCPServerRender)
			ctx = credits.WithMeter(ctx, &credits.Meter{Store: store, Owner: "alice", ID: "export", Pricing: credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}})
			err = Materialize(ctx, root, filename, filepath.Join(root, "scene.mp4"))
			if (err == nil) != success {
				t.Fatal("incorrect export result", err)
			}
			usage, err := store.Operation("alice", "export")
			want := int64(0)
			if success {
				want = 2 * credits.UnitsPerCredit
			}
			if err != nil || usage.SceneRender != want || usage.Spent != want || usage.Render != 0 {
				t.Fatal("scene render was not separately billed or failed work was billed", usage, err)
			}
		})
	}
}
