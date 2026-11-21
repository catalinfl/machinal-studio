package scenes

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestLiveSceneProviderReturnsCompilableCode(t *testing.T) {
	if os.Getenv("SCENE_LIVE_PROVIDER_CHECK") != "1" {
		t.Skip("set SCENE_LIVE_PROVIDER_CHECK=1 to run one bounded billed provider check")
	}
	provider, err := configuredProvider()
	if err != nil {
		t.Fatal(err)
	}
	provider.Client.MaxAttempts = 1
	config := Config{Width: 320, Height: 180, FPS: 10, Frames: 10}
	input, err := json.Marshal(map[string]any{
		"prompt": "Create a small one-second scene: one purple circle moves from left to right on a light background. At most 80 source lines. No text.",
		"scene":  Definition{Title: "Moving circle", Brief: "A purple circle moves across the frame", End: 1},
		"config": config,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := sceneCompletionRequest(provider.Model, componentPrompt, string(input), "create_component", map[string]any{
		"component": map[string]any{"type": "string", "description": "Complete standalone Svelte 5 component source"},
	})
	request.MaxTokens = 2048
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	started := time.Now()
	response, err := provider.Client.ChatCompletion(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	logSceneResponse("live_component_check", started, response)
	var result struct {
		Component string `json:"component"`
	}
	if err := decodeSceneResult(response, "create_component", &result); err != nil {
		t.Fatal(err)
	}
	if result.Component == "" || len(result.Component) > maxComponentBytes {
		t.Fatal("provider did not return a bounded component")
	}
	bundle, err := compileRemote(ctx, result.Component, config)
	if err != nil {
		t.Fatal(err)
	}
	if bundle == "" {
		t.Fatal("live scene preview bundle is empty")
	}
	t.Logf("live model returned %d component bytes and a %d-byte preview bundle", len(result.Component), len(bundle))
}
