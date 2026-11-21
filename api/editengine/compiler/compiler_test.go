package compiler

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

const reelYAML = `version: 1
mode: assemble
inputs:
  shots: {kind: video, multiple: true}
sequence:
  use: shots
  order: input
  each:
    take: {from: 0s, duration: 5s}
    source_audio: remove
  between: {preset: cross-dissolve, duration: 1s}
`

func reelInput(t *testing.T) Input {
	t.Helper()
	parsed, err := document.Parse([]byte(reelYAML))
	if err != nil {
		t.Fatal(err)
	}
	return Input{Document: parsed.Document, Bindings: document.Bindings{"shots": {"a", "b", "c"}}, Assets: []document.Asset{
		{ID: "a", File: "a.mp4", Version: "a-v1", Kind: "video", Duration: 10 * document.Second, HasAudio: true},
		{ID: "b", File: "b.mp4", Version: "b-v1", Kind: "video", Duration: 10 * document.Second, HasAudio: true},
		{ID: "c", File: "c.mp4", Version: "c-v1", Kind: "video", Duration: 10 * document.Second, HasAudio: true},
	}}
}

func successful(t *testing.T, result composition.Result) *composition.Composition {
	t.Helper()
	if result.Composition == nil {
		t.Fatalf("compile failed: diagnostics=%+v requirements=%+v", result.Diagnostics, result.Requirements)
	}
	return result.Composition
}

func TestSequenceProducesThirteenSecondsWithoutMutatingInput(t *testing.T) {
	input := reelInput(t)
	before, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	engine := New()
	result := engine.Compile(input)
	resolved := successful(t, result)
	if resolved.Duration != 13*document.Second {
		t.Fatalf("duration = %v", resolved.Duration)
	}
	for index, start := range []document.Time{0, 4 * document.Second, 8 * document.Second} {
		clip := resolved.Tracks[0].Clips[index]
		if clip.Start != start || clip.InPoint != 0 || clip.OutPoint != 5*document.Second {
			t.Fatalf("clip %d: %+v", index, clip)
		}
	}
	if len(resolved.Tracks) != 1 || len(resolved.Transitions) != 2 {
		t.Fatalf("unexpected tracks/transitions: %+v", resolved)
	}
	after, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("compiler mutated its input")
	}
	if successful(t, engine.Compile(input)).ID != resolved.ID {
		t.Fatal("compilation is not deterministic")
	}
	input.Document = *result.Document
	if successful(t, engine.Compile(input)).ID != resolved.ID {
		t.Fatal("recompile of saved document changed its composition")
	}
}

func TestStrictErrorsAndRequirements(t *testing.T) {
	for name, change := range map[string]func(*Input){
		"unknown transition":  func(i *Input) { i.Document.Sequence.Between.Preset = "crossfade" },
		"negative duration":   func(i *Input) { i.Document.Sequence.Between.Duration = -1 },
		"oversize transition": func(i *Input) { i.Document.Sequence.Between.Duration = 3 * document.Second },
		"source bounds":       func(i *Input) { i.Document.Sequence.Each.Take.From = 8 * document.Second },
		"unknown effect":      func(i *Input) { i.Document.Sequence.Each.Look = "made-up" },
		"wrong asset kind":    func(i *Input) { i.Assets[0].Kind = "audio" },
		"catalog version":     func(i *Input) { i.Document.CatalogVersion = "999" },
	} {
		t.Run(name, func(t *testing.T) {
			input := reelInput(t)
			change(&input)
			result := New().Compile(input)
			if result.Composition != nil || len(result.Diagnostics) == 0 {
				t.Fatalf("invalid document accepted: %+v", result)
			}
		})
	}
	input := reelInput(t)
	input.Bindings = nil
	result := New().Compile(input)
	if result.Composition != nil || len(result.Requirements) != 1 || result.Requirements[0].Kind != "binding" {
		t.Fatalf("missing slot: %+v", result)
	}
}

func TestVideoWithoutAudioOnAudioTrackExplainsTheSourceMismatch(t *testing.T) {
	parsed, err := document.Parse([]byte(`version: 1
mode: assemble
tracks:
  - id: v1
    type: video
    clips:
      - {id: video, assetId: a, start: 0, inPoint: 0, outPoint: 2}
  - id: a1
    type: audio
    clips:
      - {id: audio, assetId: a, start: 0, inPoint: 0, outPoint: 2}
`))
	if err != nil {
		t.Fatal(err)
	}
	input := Input{Document: parsed.Document, Assets: []document.Asset{{ID: "a", File: "a.mp4", Version: "v1", Kind: "video", Duration: 10 * document.Second}}}
	result := New().Compile(input)
	if result.Composition != nil {
		t.Fatal("accepted a video without audio on an audio track")
	}
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Path == "tracks[1].clips[0].assetId" && strings.Contains(diagnostic.Message, "video has no audio stream") {
			input.Assets[0].HasAudio = true
			successful(t, New().Compile(input))
			return
		}
	}
	t.Fatalf("missing actionable audio diagnostic: %+v", result.Diagnostics)
}

func TestShrinkIsExplicitAndDiagnosed(t *testing.T) {
	input := reelInput(t)
	input.Document.Sequence.Between.Duration = 3 * document.Second
	input.Document.Sequence.Between.Policy = "shrink"
	result := New().Compile(input)
	resolved := successful(t, result)
	if len(result.Diagnostics) != 2 || resolved.Transitions[0].Duration != document.Seconds(2.45) {
		t.Fatalf("shrink result: %+v", result)
	}
}

func TestLookCatalogExpandsAndAudioRemainsAligned(t *testing.T) {
	engine := New()
	for _, look := range engine.Catalog.Looks {
		t.Run(look.ID, func(t *testing.T) {
			input := reelInput(t)
			input.Document.Sequence.Each.Look = look.ID
			input.Document.Sequence.Each.SourceAudio = "keep"
			resolved := successful(t, engine.Compile(input))
			if len(resolved.Effects) == 0 {
				t.Fatal("look has no expanded effects")
			}
			if resolved.Tracks[1].Clips[1].Start != 4*document.Second {
				t.Fatal("source audio drifted")
			}
		})
	}
}

func TestOverridesPreserveSourceAndRecomputeOverlaps(t *testing.T) {
	input := reelInput(t)
	duration := 3 * document.Second
	input.Document.Overrides = []document.Override{{Target: "sequence/shots/a/1", Duration: &duration}}
	resolved := successful(t, New().Compile(input))
	if resolved.Duration != 11*document.Second || resolved.Tracks[0].Clips[1].Start != 2*document.Second {
		t.Fatalf("incorrect override layout: %+v", resolved.Tracks)
	}
}

func TestSelectorsAreResolvedBeforeDeletion(t *testing.T) {
	input := reelInput(t)
	input.Document.Sequence.Between = nil
	input.Document.Commands = []document.Command{
		{Type: "clip.delete", Target: document.Selector{Kind: "video", Position: "first"}},
		{Type: "look.apply", Target: document.Selector{Kind: "video", Position: "nth", Index: 2}, Preset: "raw-story"},
	}
	resolved := successful(t, New().Compile(input))
	if resolved.Tracks[0].Clips[0].AssetID != "b" || resolved.Tracks[0].Clips[0].Look != "raw-story" {
		t.Fatal("selector meaning changed after deletion")
	}
}

func TestReusableRulesAndGeneratedPlacementSurviveRecompile(t *testing.T) {
	engine := New()
	input := reelInput(t)
	base := successful(t, engine.Compile(input))
	input.Document = document.Document{
		Version: document.RecipeVersion, Mode: "modify", Output: base.Output,
		Rules: []document.Rule{
			{ID: "each", Target: document.Selector{Kind: "video", TrackID: base.Tracks[0].ID, Position: "all"},
				Apply: document.RuleApply{Effect: &document.RuleEffect{Preset: "vignette"}}},
			{ID: "second", Target: document.Selector{Kind: "video", TrackID: base.Tracks[0].ID, Position: "nth", Index: 2},
				Apply: document.RuleApply{Look: "raw-story"}},
		},
		Before: []document.Job{
			{ID: "cover", Type: "image.generate", Prompt: "Sunset", ResultAssetID: "generated"},
			{ID: "voice", Type: "speech.generate", Text: "Hello", ResultAssetID: "voice-asset"},
		},
		Placements: []document.Placement{
			{Job: "cover", Track: document.PlacementTrack{Type: "video", Role: "overlay"}, Start: 5 * document.Second, Duration: 5 * document.Second},
			{Job: "voice", Track: document.PlacementTrack{Type: "audio", Role: "narration"}, Start: 0},
		},
		After: []document.Job{{ID: "captions", Type: "captions.generate", Language: "ro"}},
	}
	input.Assets = append(input.Assets, document.Asset{ID: "generated", File: "generated.png", Version: "v1", Kind: "image"})
	input.Assets = append(input.Assets, document.Asset{ID: "voice-asset", File: "voice.mp3", Version: "v1", Kind: "audio", Duration: 2 * document.Second, HasAudio: true})
	style := document.DefaultTextStyle()
	style.IsCaption, style.HighlightMode = true, "word"
	var err error
	input.Document, err = MaterializeCaptions(input.Document, "captions", []document.Word{{Text: "Hello", Start: 0, End: document.Second}}, 4, style)
	if err != nil {
		t.Fatal(err)
	}
	input.Bindings = nil
	base.Effects = append(base.Effects, document.EffectBlock{ID: "existing-vignette", TrackID: base.Tracks[0].ID,
		OwnerClipID: base.Tracks[0].Clips[0].ID, Preset: "vignette", Start: 0, Duration: 5 * document.Second})
	input.Snapshot = &composition.Snapshot{Revision: "r1", Tracks: base.Tracks, Effects: base.Effects, Transitions: base.Transitions}
	result := engine.Compile(input)
	resolved := successful(t, result)
	if len(resolved.Tracks) != 3 || len(resolved.Tracks[1].Clips) != 1 || resolved.Tracks[1].Clips[0].Start != 5*document.Second {
		t.Fatalf("image was not placed above the existing timeline: %+v", resolved.Tracks)
	}
	if resolved.Tracks[2].Type != "audio" || len(resolved.Tracks[2].Clips) != 1 || len(resolved.TextItems) != 1 {
		t.Fatalf("voice or captions missing from compilation: %+v", resolved)
	}
	if resolved.Tracks[0].Clips[1].Look != "raw-story" || resolved.Tracks[0].Clips[0].Look != "" {
		t.Fatalf("nth selector did not target the second clip: %+v", resolved.Tracks[0].Clips)
	}
	for _, clip := range resolved.Tracks[0].Clips {
		count := 0
		for _, effect := range resolved.Effects {
			if effect.OwnerClipID == clip.ID && effect.Preset == "vignette" {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("expected one vignette for %s, got %d", clip.ID, count)
		}
	}
	if result.Document.Mode != "assemble" || len(result.Document.Rules) != 0 || len(result.Document.Placements) != 0 {
		t.Fatalf("saved document still contains pending rules: %+v", result.Document)
	}
	input.Snapshot = &composition.Snapshot{Revision: "r2", Tracks: resolved.Tracks, Effects: resolved.Effects, Transitions: resolved.Transitions, TextItems: resolved.TextItems}
	if reapplied := successful(t, engine.Compile(input)); len(reapplied.Tracks[1].Clips) != 1 || len(reapplied.Tracks[2].Clips) != 1 || len(reapplied.TextItems) != 1 {
		t.Fatalf("reapplying the factory duplicated generated media or captions: %+v", reapplied)
	}
	input.Document, input.Snapshot = *result.Document, nil
	if again := successful(t, engine.Compile(input)); len(again.Tracks) != 3 || len(again.Effects) != len(resolved.Effects) || len(again.TextItems) != 1 {
		t.Fatalf("recompilation duplicated recipe results: %+v", again)
	}
}

func TestMaterializedCaptionsSurviveRerender(t *testing.T) {
	input := reelInput(t)
	input.Document.Jobs = []document.Job{{ID: "captions", Type: "captions.generate"}}
	result := New().Compile(input)
	if result.Composition != nil || len(result.Requirements) != 1 {
		t.Fatal("unmaterialized job was ignored")
	}
	style := document.DefaultTextStyle()
	style.IsCaption, style.HighlightMode = true, "word"
	words := []document.Word{{Text: "ONE", Start: 0, End: document.Seconds(0.2)}, {Text: "TWO", Start: document.Seconds(0.4), End: document.Second}}
	materialized, err := MaterializeCaptions(input.Document, "captions", words, 4, style)
	if err != nil {
		t.Fatal(err)
	}
	input.Document = materialized
	first := New().Compile(input)
	resolved := successful(t, first)
	input.Document = *first.Document
	second := successful(t, New().Compile(input))
	if !reflect.DeepEqual(resolved.TextItems, second.TextItems) {
		t.Fatal("caption JSON changed on recompile")
	}
	if second.TextItems[0].Words[1].Start != document.Seconds(0.4) {
		t.Fatal("transcript gap was replaced by uniform word timing")
	}
}

func TestModifyReplacesPreviouslyGeneratedCaptions(t *testing.T) {
	input := reelInput(t)
	base := successful(t, New().Compile(input))
	style := document.DefaultTextStyle()
	style.IsCaption = true
	previous := document.TextItem{ID: "captions/caption/0", Text: "Old", Start: 0, Duration: document.Second, TextStyle: style}
	manual := document.TextItem{ID: "manual", Text: "Keep", Start: 0, Duration: document.Second, TextStyle: style}
	input.Document = document.Document{Version: 2, Mode: "modify", After: []document.Job{{ID: "captions", Type: "captions.generate", ResultTextIDs: []string{"captions/caption/0"}}},
		Texts: []document.TextItem{{ID: "captions/caption/0", Text: "New", Start: 0, Duration: document.Second, TextStyle: style}}}
	input.Bindings = nil
	input.Snapshot = &composition.Snapshot{Revision: "r1", Tracks: base.Tracks, TextItems: []document.TextItem{previous, manual}}
	resolved := successful(t, New().Compile(input))
	if len(resolved.TextItems) != 2 || resolved.TextItems[0].ID != "manual" || resolved.TextItems[1].Text != "New" {
		t.Fatalf("generated captions were duplicated or manual text lost: %+v", resolved.TextItems)
	}
}

func TestMaterializeCaptionsAppliesStylePatch(t *testing.T) {
	doc := document.Document{After: []document.Job{{ID: "captions", Type: "captions.generate", Style: []byte(`{"fontSize":72,"y":820,"highlightMode":"none"}`)}}}
	resolved, err := MaterializeCaptions(doc, "captions", []document.Word{{Text: "Hello", Start: 0, End: document.Second}}, 4, document.DefaultTextStyle())
	if err != nil || len(resolved.Texts) != 1 || resolved.Texts[0].FontSize != 72 || resolved.Texts[0].Y != 820 || !resolved.Texts[0].IsCaption {
		t.Fatalf("caption style was not applied: %+v, %v", resolved.Texts, err)
	}
}

func TestStagedRecipeInfersVersionWithoutHeader(t *testing.T) {
	input := reelInput(t)
	base := successful(t, New().Compile(input))
	input.Document = document.Document{Mode: "modify", After: []document.Job{{ID: "captions", Type: "captions.generate", MaxWords: 3}}}
	input.Bindings = nil
	input.Snapshot = &composition.Snapshot{Revision: "r1", Tracks: base.Tracks}
	result := New().Compile(input)
	if result.Document == nil || result.Document.Version != document.RecipeVersion || len(result.Requirements) != 1 || len(result.Diagnostics) != 0 {
		t.Fatalf("recipe without version was not recognized: %+v", result)
	}
}

func TestPresetTextIsMaterializedOnce(t *testing.T) {
	input := reelInput(t)
	parsed, err := document.Parse([]byte(reelYAML + `texts:
  - id: title
    text: Hello
    start: 0s
    duration: 2s
    preset: title
    color: '#ff0000'
`))
	if err != nil {
		t.Fatal(err)
	}
	input.Document = parsed.Document
	result := New().Compile(input)
	item := successful(t, result).TextItems[0]
	if item.FontSize != 112 || item.Color != "#ff0000" || item.Preset != "" {
		t.Fatalf("preset not materialized: %+v", item)
	}
	input.Document = *result.Document
	if successful(t, New().Compile(input)).TextItems[0].FontSize != 112 {
		t.Fatal("preset changed on recompile")
	}
}

func TestLockedSnapshotCannotBeReplaced(t *testing.T) {
	input := reelInput(t)
	base := successful(t, New().Compile(input))
	base.Tracks[0].Locked = true
	input.Snapshot = &composition.Snapshot{Revision: "R1", Tracks: base.Tracks}
	result := New().Compile(input)
	if result.Composition != nil || !strings.Contains(result.Diagnostics[0].Message, "locked") {
		t.Fatalf("locked track was replaced: %+v", result)
	}
}

func TestJobOrchestrationFieldsValidate(t *testing.T) {
	input := reelInput(t)
	input.Document.Jobs = []document.Job{{ID: "caps", Type: "captions.generate", Language: "ro", MaxWords: 4}}
	if result := New().Compile(input); result.Composition != nil || len(result.Requirements) != 1 {
		t.Fatalf("valid captions job rejected: %+v", result)
	}
	for name, job := range map[string]document.Job{
		"bad language":   {ID: "j", Type: "captions.generate", Language: "romanian"},
		"unknown track":  {ID: "j", Type: "speech.generate", Text: "hi", TrackID: "nope", ResultAssetID: "a"},
		"missing prompt": {ID: "j", Type: "image.generate"},
		"missing text":   {ID: "j", Type: "speech.generate"},
	} {
		t.Run(name, func(t *testing.T) {
			input := reelInput(t)
			input.Document.Jobs = []document.Job{job}
			if result := New().Compile(input); result.Composition != nil || len(result.Diagnostics) == 0 {
				t.Fatalf("invalid job accepted: %+v", result)
			}
		})
	}
}

func TestJobResultPlacementAppendsClip(t *testing.T) {
	parsed, err := document.Parse([]byte(`version: 1
mode: assemble
tracks:
  - {id: v1, type: video, clips: []}
  - {id: a1, type: audio, clips: []}
jobs:
  - {id: voice, type: speech.generate, text: hello, trackId: a1, resultAssetId: music}
`))
	if err != nil {
		t.Fatal(err)
	}
	input := Input{Document: parsed.Document, Assets: []document.Asset{
		{ID: "music", File: "music.mp3", Version: "v1", Kind: "audio", Duration: 5 * document.Second},
	}}
	resolved := successful(t, New().Compile(input))
	if len(resolved.Tracks[1].Clips) != 1 || resolved.Tracks[1].Clips[0].AssetID != "music" {
		t.Fatalf("placed clip missing: %+v", resolved.Tracks)
	}
	if resolved.Duration != 5*document.Second {
		t.Fatalf("duration = %v", resolved.Duration)
	}
}
