package compiler

import (
	"encoding/json"
	"testing"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

func montageInput() Input {
	clip := document.Clip{ID: "v", AssetID: "source", OutPoint: 763 * document.Second, PlaybackRate: 1, Volume: 100, Opacity: 1, Transform: document.IdentityTransform(), LinkedClipID: "a", TransformKeyframes: []document.Keyframe{}}
	audio := clip
	audio.ID, audio.LinkedClipID = "a", "v"
	return Input{
		Document: document.Document{Version: 3, Mode: "modify", Montage: &document.Montage{
			Target: document.Selector{Kind: "video", Selected: true}, TargetDuration: 120 * document.Second,
			Seed: "test-seed", Between: &document.MontageBetween{PresetChoice: document.PresetChoice{Random: true}, Duration: 2 * document.Second},
			Motion: &document.PresetChoice{Random: true, Family: "zoom"},
			Ranges: []document.MontageRange{{ClipID: "v", From: 100 * document.Second, To: 142 * document.Second}, {ClipID: "v", From: 300 * document.Second, To: 342 * document.Second}, {ClipID: "v", From: 650 * document.Second, To: 690 * document.Second}},
		}},
		Assets:   []document.Asset{{ID: "source", File: "source.mp4", Kind: "video", Version: "v1", Duration: 763 * document.Second, HasAudio: true}},
		Snapshot: &composition.Snapshot{Revision: "r1", SelectedIDs: []string{"v"}, Tracks: []document.Track{{ID: "v1", Type: "video", Clips: []document.Clip{clip}}, {ID: "a1", Type: "audio", Clips: []document.Clip{audio}}}},
	}
}

func TestMontageCompilesLinkedTwoMinuteEditAndReplays(t *testing.T) {
	input := montageInput()
	before, _ := json.Marshal(input)
	engine := New()
	result := engine.Compile(input)
	resolved := successful(t, result)
	if resolved.Duration != 120*document.Second || len(resolved.Transitions) != 2 {
		t.Fatalf("unexpected composition: %+v", resolved)
	}
	for index, clip := range resolved.Tracks[0].Clips {
		audio := resolved.Tracks[1].Clips[index]
		if audio.Start != clip.Start || audio.LinkedClipID != clip.ID || clip.LinkedClipID != audio.ID || clip.Motion == "" {
			t.Fatalf("broken linked montage: %+v %+v", clip, audio)
		}
	}
	after, _ := json.Marshal(input)
	if string(before) != string(after) {
		t.Fatal("input mutated")
	}
	if successful(t, engine.Compile(input)).ID != resolved.ID {
		t.Fatal("random choice not reproducible")
	}
	if result.Document.Montage != nil {
		t.Fatal("saved document would repeat the montage")
	}
	input.Document, input.Snapshot = *result.Document, nil
	if successful(t, engine.Compile(input)).ID != resolved.ID {
		t.Fatal("materialized document does not replay exactly")
	}
}

func TestMontageChoosesCompleteCandidatesWithinBudget(t *testing.T) {
	input := montageInput()
	m := input.Document.Montage
	m.Candidates, m.Ranges = m.Ranges, nil
	m.Candidates = append(m.Candidates, document.MontageRange{ClipID: "v", From: 700 * document.Second, To: 710 * document.Second, Score: 100})
	result := successful(t, New().Compile(input))
	if result.Duration != 120*document.Second || len(result.Tracks[0].Clips) != 3 {
		t.Fatalf("unexpected selected moments: %+v", result.Tracks[0])
	}
}

func TestMontageRejectsInfeasibleAndLockedPlans(t *testing.T) {
	for name, change := range map[string]func(*Input){
		"locked audio":         func(i *Input) { i.Snapshot.Tracks[1].Locked = true },
		"unreachable duration": func(i *Input) { i.Document.Montage.TargetDuration = 121 * document.Second },
		"invalid source":       func(i *Input) { i.Document.Montage.Ranges[0].To = 800 * document.Second },
		"invented id":          func(i *Input) { i.Document.Montage.Ranges[0].ClipID = "invented" },
		"transition too long":  func(i *Input) { i.Document.Montage.Between.Duration = 30 * document.Second },
		"overlapping ranges":   func(i *Input) { i.Document.Montage.Ranges[1].From = 130 * document.Second },
	} {
		t.Run(name, func(t *testing.T) {
			input := montageInput()
			change(&input)
			result := New().Compile(input)
			if result.Composition != nil || len(result.Diagnostics) == 0 {
				t.Fatalf("invalid montage accepted: %+v", result)
			}
		})
	}
}
