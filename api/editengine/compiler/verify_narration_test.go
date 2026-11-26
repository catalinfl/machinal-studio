package compiler

import (
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestOmittedAudioOutPointResolvesToFullAssetDuration(t *testing.T) {
	parsed, err := document.Parse([]byte(`version: 2
mode: assemble
tracks:
  - id: main
    type: video
    clips:
      - {id: v1, assetId: scene1, start: 0, inPoint: 0, outPoint: 24}
  - id: narration
    type: audio
    clips:
      - {id: vo_clip, assetId: vo_audio, start: 0, volume: 100}
output: {aspect: portrait, resolution: 1080p, fps: 30, format: mp4}
`))
	if err != nil {
		t.Fatal(err)
	}
	input := Input{
		Document: parsed.Document,
		Assets: []document.Asset{
			{ID: "scene1", File: "s1.scene.json", Version: "v1", Kind: "video", Duration: document.Seconds(24)},
			{ID: "vo_audio", File: "voice_if_you.mp3", Version: "v2", Kind: "audio", Duration: document.Seconds(23.904), HasAudio: true},
		},
	}
	resolved := successful(t, New().Compile(input))
	vo := resolved.Tracks[1].Clips[0]
	if vo.OutPoint != document.Seconds(23.904) {
		t.Fatalf("expected omitted outPoint to resolve to 23.904s, got %v", vo.OutPoint.Seconds())
	}
}

func TestSourceBoundsReportsExactAssetDuration(t *testing.T) {
	parsed, err := document.Parse([]byte(`version: 2
mode: assemble
tracks:
  - id: narration
    type: audio
    clips:
      - {id: vo_clip, assetId: vo_audio, start: 0, inPoint: 0, outPoint: 25.25, volume: 100}
output: {aspect: portrait, resolution: 1080p, fps: 30, format: mp4}
`))
	if err != nil {
		t.Fatal(err)
	}
	input := Input{
		Document: parsed.Document,
		Assets: []document.Asset{
			{ID: "vo_audio", File: "voice_if_you.mp3", Version: "v2", Kind: "audio", Duration: document.Seconds(23.904), HasAudio: true},
		},
	}
	result := New().Compile(input)
	if result.Composition != nil {
		t.Fatalf("expected source_bounds failure, got composition")
	}
	found := false
	for _, d := range result.Diagnostics {
		if d.Code == "source_bounds" && d.Severity == "error" {
			found = true
			if !strings.Contains(d.Message, "23.904") || !strings.Contains(d.Message, "25.250") {
				t.Fatalf("source_bounds diagnostic should include requested and actual durations, got: %q", d.Message)
			}
		}
	}
	if !found {
		t.Fatalf("missing source_bounds error: %+v", result.Diagnostics)
	}
}

func TestTruncatedNarrationIsHardCompileError(t *testing.T) {
	parsed, err := document.Parse([]byte(`version: 2
mode: assemble
tracks:
  - id: main
    type: video
    clips:
      - {id: v1, assetId: scene1, start: 0, inPoint: 0, outPoint: 25.25}
  - id: narration
    type: audio
    clips:
      - {id: vo_clip, assetId: vo_audio, start: 0, inPoint: 0, outPoint: 20, volume: 100}
output: {aspect: portrait, resolution: 1080p, fps: 30, format: mp4}
`))
	if err != nil {
		t.Fatal(err)
	}
	input := Input{
		Document: parsed.Document,
		Assets: []document.Asset{
			{ID: "scene1", File: "s1.scene.json", Version: "v1", Kind: "video", Duration: document.Seconds(25.25)},
			{ID: "vo_audio", File: "voice_if_you.mp3", Version: "v2", Kind: "audio", Duration: document.Seconds(23.904), HasAudio: true},
		},
	}
	result := New().Compile(input)
	if result.Composition != nil {
		t.Fatalf("truncated narration must block compilation, got valid composition")
	}
	found := false
	for _, d := range result.Diagnostics {
		if d.Code == "narration_truncated" && d.Severity == "error" {
			found = true
			if !strings.Contains(d.Message, "23.904") || !strings.Contains(d.Message, "20.000") {
				t.Fatalf("unexpected narration_truncated message: %q", d.Message)
			}
		}
	}
	if !found {
		t.Fatalf("expected narration_truncated error, got: %+v", result.Diagnostics)
	}
}

func TestSplitNarrationAndTrimmedSfxStillCompileCleanly(t *testing.T) {
	parsed, err := document.Parse([]byte(`version: 2
mode: assemble
tracks:
  - id: main
    type: video
    clips:
      - {id: v1, assetId: scene1, start: 0, inPoint: 0, outPoint: 24.5}
  - id: narration
    type: audio
    clips:
      - {id: vo_part1, assetId: vo_audio, start: 0, inPoint: 0, outPoint: 12, volume: 100}
      - {id: vo_part2, assetId: vo_audio, start: 12.2, inPoint: 12, outPoint: 23.904, volume: 100}
  - id: audio_sfx
    type: audio
    clips:
      - {id: hit1, assetId: sfx_hit, start: 1, inPoint: 0, outPoint: 0.5, volume: 30}
output: {aspect: portrait, resolution: 1080p, fps: 30, format: mp4}
`))
	if err != nil {
		t.Fatal(err)
	}
	input := Input{
		Document: parsed.Document,
		Assets: []document.Asset{
			{ID: "scene1", File: "s1.scene.json", Version: "v1", Kind: "video", Duration: document.Seconds(24.5)},
			{ID: "vo_audio", File: "voice_if_you.mp3", Version: "v2", Kind: "audio", Duration: document.Seconds(23.904), HasAudio: true},
			{ID: "sfx_hit", File: "sfx_stamp.mp3", Version: "v3", Kind: "audio", Duration: document.Seconds(4.0), HasAudio: true},
		},
	}
	result := New().Compile(input)
	successful(t, result)
}

func TestVideoShorterThanNarrationIsHardCompileErrorWhenVideoExists(t *testing.T) {
	parsed, err := document.Parse([]byte(`version: 2
mode: assemble
tracks:
  - id: main
    type: video
    clips:
      - {id: v1, assetId: scene1, start: 0, inPoint: 0, outPoint: 20}
  - id: narration
    type: audio
    clips:
      - {id: vo_clip, assetId: vo_audio, start: 0, inPoint: 0, outPoint: 23.904, volume: 100}
output: {aspect: portrait, resolution: 1080p, fps: 30, format: mp4}
`))
	if err != nil {
		t.Fatal(err)
	}
	input := Input{
		Document: parsed.Document,
		Assets: []document.Asset{
			{ID: "scene1", File: "s1.scene.json", Version: "v1", Kind: "video", Duration: document.Seconds(20)},
			{ID: "vo_audio", File: "voice_if_you.mp3", Version: "v2", Kind: "audio", Duration: document.Seconds(23.904), HasAudio: true},
		},
	}
	result := New().Compile(input)
	if result.Composition != nil {
		t.Fatalf("video shorter than narration must block compilation")
	}
	found := false
	for _, d := range result.Diagnostics {
		if d.Code == "video_shorter_than_narration" && d.Severity == "error" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected video_shorter_than_narration error, got: %+v", result.Diagnostics)
	}
}
