package compositions

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"testing"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/internal/core/editor/imagegen"
	"ffmpeg-go-server/internal/core/editor/subtitles"

	"github.com/gofiber/fiber/v2"
)

func TestCompileAndGenerateMaterializesCaptions(t *testing.T) {
	previous := transcribeWindow
	transcribeWindow = func(ctx context.Context, root, file string, start, duration float64, language string) ([]subtitles.Cue, error) {
		if language != "ro" {
			t.Fatalf("language = %q", language)
		}
		return []subtitles.Cue{{
			Start: 0, End: 1, Text: "Salut lume",
			Words: []subtitles.CueWord{
				{Start: 0, End: 0.5, Text: "Salut"},
				{Start: 0.5, End: 1, Text: "lume"},
			},
		}}, nil
	}
	defer func() { transcribeWindow = previous }()

	app := fiber.New()
	app.Post("/compositions/compile-and-generate", CompileAndGenerate)
	body := []byte(`{"document":"version: 1\nmode: assemble\ntracks:\n  - {id: v1, type: video, clips: [{id: c1, assetId: a, start: 0, inPoint: 0, outPoint: 2}]}\n  - {id: a1, type: audio, clips: [{id: c2, assetId: a, start: 0, inPoint: 0, outPoint: 2}]}\njobs:\n  - {id: captions, type: captions.generate, language: ro, maxWords: 4}\n", "assets":[{"id":"a","file":"a.mp4","kind":"video","version":"v1","duration":10,"hasAudio":true}]}`)
	request := httptest.NewRequest("POST", "/compositions/compile-and-generate", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("status %d: %s", response.StatusCode, data)
	}
	var result composition.Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.Composition == nil {
		t.Fatalf("no composition: %s", data)
	}
	if len(result.Composition.TextItems) != 1 || result.Composition.TextItems[0].Text != "Salut lume" {
		t.Fatalf("captions missing: %+v", result.Composition.TextItems)
	}
	if len(result.Document.Jobs[0].ResultTextIDs) != 1 {
		t.Fatalf("job not materialized: %+v", result.Document.Jobs)
	}
}

func TestCompileAndGenerateCaptionsAfterLinkedMontage(t *testing.T) {
	previous := transcribeWindow
	transcribeWindow = func(_ context.Context, _, _ string, start, duration float64, language string) ([]subtitles.Cue, error) {
		if language != "ro" || duration < 39 || duration > 42 || start != 100 && start != 300 && start != 650 {
			t.Errorf("unexpected caption window: %.3f %.3f %q", start, duration, language)
		}
		return []subtitles.Cue{{Words: []subtitles.CueWord{{Start: 1, End: 1.5, Text: "Salut"}, {Start: 1.6, End: 2, Text: "lume"}}}}, nil
	}
	defer func() { transcribeWindow = previous }()
	app := fiber.New()
	app.Post("/compositions/compile-and-generate", CompileAndGenerate)
	video := map[string]any{"id": "v", "assetId": "source", "start": 0, "inPoint": 0, "outPoint": 763, "linkedClipId": "a"}
	audio := map[string]any{"id": "a", "assetId": "source", "start": 0, "inPoint": 0, "outPoint": 763, "linkedClipId": "v"}
	requestBody := map[string]any{
		"document": map[string]any{"version": 3, "mode": "modify", "montage": map[string]any{
			"target":         map[string]any{"kind": "video", "ids": []string{"v"}},
			"ranges":         []map[string]any{{"clipId": "v", "from": 100, "to": 142}, {"clipId": "v", "from": 300, "to": 342}, {"clipId": "v", "from": 650, "to": 690}},
			"targetDuration": 120, "between": map[string]any{"random": true, "duration": 2},
		}, "after": []map[string]any{{"id": "captions", "type": "captions.generate", "input": "montage", "language": "ro"}}},
		"snapshot": map[string]any{"revision": "r1", "selectedIds": []string{"v"}, "tracks": []map[string]any{
			{"id": "v1", "type": "video", "clips": []map[string]any{video}},
			{"id": "a1", "type": "audio", "clips": []map[string]any{audio}},
		}},
		"assets": []map[string]any{{"id": "source", "file": "recording.mp4", "kind": "video", "duration": 763, "version": "v1", "hasAudio": true}},
	}
	data, err := json.Marshal(requestBody)
	if err != nil {
		t.Fatal(err)
	}
	response, err := app.Test(httptest.NewRequest("POST", "/compositions/compile-and-generate", bytes.NewReader(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result composition.Result
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || result.Composition == nil {
		t.Fatalf("status=%d diagnostics=%+v requirements=%+v", response.StatusCode, result.Diagnostics, result.Requirements)
	}
	resolved := result.Composition
	if resolved.Duration.Seconds() != 120 || len(resolved.Transitions) != 2 || len(resolved.TextItems) != 3 || len(resolved.Tracks[1].Clips) != 3 {
		t.Fatalf("montage and captions not materialized: duration=%v transitions=%d captions=%d audio=%d", resolved.Duration, len(resolved.Transitions), len(resolved.TextItems), len(resolved.Tracks[1].Clips))
	}
	for index, caption := range resolved.TextItems {
		expected := []float64{1, 41, 81}[index]
		if caption.Start.Seconds() != expected || caption.Text != "Salut lume" {
			t.Fatalf("caption %d not mapped to final timeline: %+v", index, caption)
		}
	}
}

func TestCompileAndGenerateSkipsMaterializedJobs(t *testing.T) {
	called := false
	previous := transcribeWindow
	transcribeWindow = func(ctx context.Context, root, file string, start, duration float64, language string) ([]subtitles.Cue, error) {
		called = true
		return nil, nil
	}
	defer func() { transcribeWindow = previous }()

	app := fiber.New()
	app.Post("/compositions/compile-and-generate", CompileAndGenerate)
	body := []byte(`{"document":"version: 1\nmode: assemble\ntracks:\n  - {id: v1, type: video, clips: [{id: c1, assetId: a, start: 0, inPoint: 0, outPoint: 2}]}\ntexts:\n  - {id: captions/caption/0, text: Hi, start: 0, duration: 1, isCaption: true, highlightMode: word, words: [{text: Hi, start: 0, end: 1}]}\njobs:\n  - {id: captions, type: captions.generate, resultTextIds: [captions/caption/0]}\n", "assets":[{"id":"a","file":"a.mp4","kind":"video","version":"v1","duration":10,"hasAudio":true}]}`)
	request := httptest.NewRequest("POST", "/compositions/compile-and-generate", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("status %d: %s", response.StatusCode, data)
	}
	if called {
		t.Fatal("provider called for an already materialized job")
	}
}

func TestCompileAndGenerateImageJob(t *testing.T) {
	var written string
	previous := generateImageCall
	generateImageCall = func(ctx context.Context, dataDir string, safeJoin func(string) (string, error), prompt, model, aspect, background string) (imagegen.GeneratedImage, error) {
		if prompt != "apus peste mare" {
			t.Fatalf("prompt = %q", prompt)
		}
		path, err := safeJoin("cover.png")
		if err != nil {
			t.Fatal(err)
		}
		written = path
		if err := os.WriteFile(path, []byte("fake-png"), 0644); err != nil {
			t.Fatal(err)
		}
		return imagegen.GeneratedImage{ID: "img1", Name: "cover.png", MediaType: "image/png", Width: 64, Height: 32, Extension: "png"}, nil
	}
	defer func() {
		generateImageCall = previous
		if written != "" {
			os.Remove(written)
		}
	}()

	app := fiber.New()
	app.Post("/compositions/compile-and-generate", CompileAndGenerate)
	body := []byte(`{"document":"version: 1\nmode: assemble\ntracks:\n  - {id: v1, type: video, clips: []}\njobs:\n  - {id: cover, type: image.generate, prompt: apus peste mare, aspect: 16:9, trackId: v1, duration: 2}\n", "assets":[]}`)
	request := httptest.NewRequest("POST", "/compositions/compile-and-generate", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("status %d: %s", response.StatusCode, data)
	}
	var result composition.Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.Composition == nil {
		t.Fatalf("no composition: %s", data)
	}
	if len(result.Composition.Tracks[0].Clips) != 1 || result.Composition.Tracks[0].Clips[0].AssetID != "cover.png" {
		t.Fatalf("placed image clip missing: %+v", result.Composition.Tracks)
	}
}

func TestCompileAndGenerateStagedRulesAndCaptionsOnModifiedTimeline(t *testing.T) {
	oldImage, oldTranscript := generateImageCall, transcribeWindow
	var written string
	generateImageCall = func(ctx context.Context, dataDir string, safeJoin func(string) (string, error), prompt, model, aspect, background string) (imagegen.GeneratedImage, error) {
		if prompt != "apus" || model != "test-model" {
			t.Fatalf("wrong generation settings: %s %s", prompt, model)
		}
		path, err := safeJoin("staged-cover.png")
		if err != nil {
			t.Fatal(err)
		}
		written = path
		if err := os.WriteFile(path, []byte("test-image"), 0644); err != nil {
			t.Fatal(err)
		}
		return imagegen.GeneratedImage{Name: "staged-cover.png", Width: 64, Height: 32}, nil
	}
	transcribeWindow = func(ctx context.Context, root, file string, start, duration float64, language string) ([]subtitles.Cue, error) {
		if file != "a.mp4" || language != "ro" {
			t.Fatalf("wrong transcription window: %s %s", file, language)
		}
		return []subtitles.Cue{{Words: []subtitles.CueWord{{Text: "Salut", Start: 0.5, End: 1}}}}, nil
	}
	defer func() {
		generateImageCall, transcribeWindow = oldImage, oldTranscript
		if written != "" {
			os.Remove(written)
		}
	}()

	app := fiber.New()
	app.Post("/compositions/compile-and-generate", CompileAndGenerate)
	body := []byte(`{"document":{"version":2,"mode":"modify","rules":[{"id":"each","target":{"kind":"video","position":"all"},"apply":{"effect":{"preset":"vignette"}}}],"before":[{"id":"cover","type":"image.generate","model":"test-model","prompt":"apus"}],"placements":[{"job":"cover","track":{"type":"video","role":"overlay"},"start":1,"duration":1}],"after":[{"id":"captions","type":"captions.generate","language":"ro"}]},"snapshot":{"revision":"r1","tracks":[{"id":"v1","type":"video","clips":[{"id":"c1","assetId":"a","start":0,"inPoint":0,"outPoint":3}]}]},"assets":[{"id":"a","file":"a.mp4","kind":"video","version":"v1","duration":10,"hasAudio":true}]}`)
	request := httptest.NewRequest("POST", "/compositions/compile-and-generate", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("status %d: %s", response.StatusCode, data)
	}
	var result composition.Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.Composition == nil || len(result.Composition.Tracks) != 2 || len(result.Composition.TextItems) != 1 {
		t.Fatalf("missing staged results: %s", data)
	}
	if result.Composition.Tracks[1].Clips[0].Start.Seconds() != 1 || result.Composition.TextItems[0].Start.Seconds() != 0.5 {
		t.Fatalf("wrong placement or captions timing: %s", data)
	}
	if result.Composition.TextItems[0].X != 960 || result.Composition.TextItems[0].Y != 864 {
		t.Fatalf("captions were not positioned near the bottom of the canvas: %s", data)
	}
	if len(result.Document.Jobs) != 2 || len(result.Document.Before) != 0 || len(result.Document.After) != 0 {
		t.Fatalf("pending jobs in resolved document: %s", data)
	}
}

func TestCompileAndGenerateSpeechJobMissingText(t *testing.T) {
	app := fiber.New()
	app.Post("/compositions/compile-and-generate", CompileAndGenerate)
	body := []byte(`{"document":"version: 1\nmode: assemble\ntracks:\n  - {id: a1, type: audio, clips: []}\njobs:\n  - {id: voice, type: speech.generate, trackId: a1}\n", "assets":[]}`)
	request := httptest.NewRequest("POST", "/compositions/compile-and-generate", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode == 200 {
		t.Fatal("speech job without text was accepted")
	}
}
