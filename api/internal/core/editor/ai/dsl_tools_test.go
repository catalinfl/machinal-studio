package ai

import (
	"encoding/json"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/integrations/openrouter"
)

func testSnapshotWithClip() *composition.Snapshot {
	return &composition.Snapshot{
		Revision: "R1",
		Tracks: []document.Track{{
			ID: "sequence/video", Name: "Sequence", Type: "video",
			Clips: []document.Clip{{
				ID: "clip-1", AssetID: "a.mp4",
				InPoint: 0, OutPoint: 5 * document.Second,
				PlaybackRate: 1, Volume: 100, Opacity: 1,
				Transform: document.IdentityTransform(), TransformKeyframes: []document.Keyframe{},
			}},
		}},
	}
}

func dslTestResponse(calls ...openrouter.ToolCall) openrouter.ChatCompletionResponse {
	var response openrouter.ChatCompletionResponse
	response.Choices = make([]struct {
		Index        int                        `json:"index"`
		Message      openrouter.ResponseMessage `json:"message"`
		FinishReason string                     `json:"finish_reason"`
	}, 1)
	response.Choices[0].Message.ToolCalls = calls
	return response
}

func dslCall(id, name string, args any) openrouter.ToolCall {
	encoded, err := json.Marshal(args)
	if err != nil {
		panic(err)
	}
	var call openrouter.ToolCall
	call.ID = id
	call.Type = "function"
	call.Function.Name = name
	call.Function.Arguments = string(encoded)
	return call
}

func dslTestInput() compiler.Input {
	return compiler.Input{
		Document: document.Document{
			Version: 1, Mode: "assemble", Revision: "R1",
			Tracks: []document.Track{{ID: "sequence/video", Name: "Sequence", Type: "video", Clips: []document.Clip{}}},
			Output: document.Output{Aspect: "landscape", Resolution: "1080p", FPS: 30, Format: "mp4", Quality: "normal"},
		},
		Bindings: document.Bindings{},
		Assets: []document.Asset{
			{ID: "a.mp4", File: "a.mp4", Version: "a-v1", Kind: "video", Duration: 10 * document.Second},
			{ID: "b.mp4", File: "b.mp4", Version: "b-v1", Kind: "video", Duration: 10 * document.Second},
		},
	}
}

func TestDSLAssembleMergesBindingsAndSequence(t *testing.T) {
	response := dslTestResponse(dslCall("1", dslAssembleToolName, map[string]any{
		"inputs":   map[string]any{"shots": map[string]any{"kind": "video", "multiple": true}},
		"bindings": map[string]any{"shots": []string{"a.mp4", "b.mp4"}},
		"sequence": map[string]any{
			"use": "shots", "order": "input",
			"each":    map[string]any{"take": map[string]any{"from": 0, "duration": 5}, "source_audio": "remove", "look": "raw-story"},
			"between": map[string]any{"preset": "cross-dissolve", "duration": 0.5},
		},
	}))
	fragment, err := mergeDSLCalls(response)
	if err != nil {
		t.Fatal(err)
	}
	working, err := applyDSLFragment(dslTestInput(), fragment)
	if err != nil {
		t.Fatal(err)
	}
	if working.Document.Mode != "assemble" {
		t.Fatalf("mode = %q", working.Document.Mode)
	}
	if working.Document.Sequence == nil || working.Document.Sequence.Use != "shots" {
		t.Fatalf("sequence not applied: %+v", working.Document.Sequence)
	}
	if len(working.Bindings["shots"]) != 2 {
		t.Fatalf("bindings not applied: %+v", working.Bindings)
	}
	result := compiler.New().Compile(working)
	if result.Composition == nil {
		t.Fatalf("compile failed: %+v", result.Diagnostics)
	}
	if len(result.Composition.Tracks[0].Clips) != 2 {
		t.Fatalf("expected 2 clips, got %+v", result.Composition.Tracks)
	}
}

func TestDSLPatchAcceptsLegacyNotations(t *testing.T) {
	response := dslTestResponse(dslCall("1", dslPatchToolName, map[string]any{
		"changes": []map[string]any{
			{"path": "document.mode", "value": "assemble"},
			{"path": "bindings.shots", "value": []string{"a.mp4"}},
		},
	}))
	fragment, err := mergeDSLCalls(response)
	if err != nil {
		t.Fatal(err)
	}
	working, err := applyDSLFragment(dslTestInput(), fragment)
	if err != nil {
		t.Fatalf("legacy document. prefix rejected: %v", err)
	}
	if working.Document.Mode != "assemble" || len(working.Bindings["shots"]) != 1 {
		t.Fatalf("patch not applied: %+v %+v", working.Document.Mode, working.Bindings)
	}
}

func TestDSLRejectsInventedClipFields(t *testing.T) {
	// asset/from/duration/transition/between are the invented shapes from the
	// reported failure; strict decoding must reject them for the repair loop.
	response := dslTestResponse(dslCall("1", dslTracksToolName, map[string]any{
		"tracks": []map[string]any{{
			"id": "sequence/video", "name": "Sequence", "type": "video",
			"clips": []map[string]any{{
				"id": "clip-1", "asset": "a.mp4", "from": 0, "duration": 5,
				"look": "raw-story", "transition": map[string]any{"type": "cross-dissolve"},
			}},
		}},
	}))
	if _, err := mergeDSLCalls(response); err == nil {
		t.Fatal("invented clip fields accepted")
	}
}

func TestDSLPureTweakSwitchesToModify(t *testing.T) {
	input := dslTestInput()
	input.Snapshot = testSnapshotWithClip()
	response := dslTestResponse(dslCall("1", dslTweakToolName, map[string]any{
		"commands": []map[string]any{{
			"type":   "look.apply",
			"target": map[string]any{"kind": "video", "position": "first"},
			"preset": "raw-story",
		}},
	}))
	fragment, err := mergeDSLCalls(response)
	if err != nil {
		t.Fatal(err)
	}
	working, err := applyDSLFragment(input, fragment)
	if err != nil {
		t.Fatal(err)
	}
	if working.Document.Mode != "modify" {
		t.Fatalf("mode = %q, want modify", working.Document.Mode)
	}
	if len(working.Document.Tracks) != 0 || working.Document.Sequence != nil {
		t.Fatal("modify must clear tracks/sequence/audio")
	}
}
