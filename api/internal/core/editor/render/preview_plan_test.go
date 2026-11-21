package render

import (
	"encoding/json"
	"math"
	"testing"
)

func TestPreviewSelectsSourceWindowsWithoutMutatingInputs(t *testing.T) {
	req := renderRequest{FPS: 30, VideoChannels: []channel{{Clips: []clip{
		{File: "outside.mp4", Start: 0, InPoint: 0, OutPoint: 30},
		{File: "selected.mp4", Start: 30, InPoint: 5, OutPoint: 35},
		{File: "later.mp4", Start: 60, InPoint: 0, OutPoint: 30},
	}}}, AudioChannels: []channel{{Clips: []clip{{File: "voice.wav", Start: 0, InPoint: 0, OutPoint: 90}}}},
		TextItems: []textItem{{Start: 30, Duration: 10, Animation: "float"}, {Start: 1, Duration: 1}}}
	before, _ := json.Marshal(req)
	preview, window := previewRequest(req, PreviewWindow{Start: 35, Duration: 2})
	if *preview.Duration != 2 || window.Start != 0 || len(preview.VideoChannels[0].Clips) != 1 || len(preview.TextItems) != 1 {
		t.Fatal(preview, window)
	}
	moving := preview.VideoChannels[0].Clips[0]
	if moving.Start != 0 || moving.InPoint != 5 || moving.OutPoint != 12 || moving.previewPreroll != 5 || clipDurT(moving) != 2 || preview.AudioChannels[0].Clips[0].InPoint != 35 {
		t.Fatal("preview retimed source windows", moving, preview.AudioChannels)
	}
	start, duration := textMotionWindow(preview.TextItems[0])
	chunked := textItemForOverlayChunk(preview.TextItems[0], 0, 2)
	chunkStart, _ := textMotionWindow(chunked)
	if start != -5 || duration != 10 || chunkStart != start {
		t.Fatal("caption animation restarted or offset applied twice", start, duration, chunkStart)
	}
	after, _ := json.Marshal(req)
	if string(before) != string(after) {
		t.Fatal("preview mutated original recipe inputs")
	}
}

func TestPreviewRetainsTransitionAndTemporalEffectHistory(t *testing.T) {
	req := renderRequest{FPS: 30, VideoChannels: []channel{{Clips: []clip{
		{File: "unused.mp4", Start: 0, InPoint: 0, OutPoint: 5},
		{File: "left.mp4", Start: 10, InPoint: 0, OutPoint: 5},
		{File: "right.mp4", Start: 14, InPoint: 0, OutPoint: 5},
	}, Transitions: []transition{{RightClipIndex: 2, Xfade: "fade"}}}, {Clips: []clip{{File: "effect.mp4", Start: 12, InPoint: 0, OutPoint: 6, Segments: []segment{{SrcStart: 0, SrcEnd: 6, Effects: []effect{{ID: "motion-trails"}}}}}}}}}
	preview, window := previewRequest(req, PreviewWindow{Start: 14.5, Duration: 0.5})
	if *preview.Duration != 9 || window.Start != 4.5 || len(preview.VideoChannels[0].Clips) != 2 || preview.VideoChannels[0].Transitions[0].RightClipIndex != 1 {
		t.Fatal("transition dependency island was truncated or not rebased", preview, window)
	}
	if preview.VideoChannels[1].Clips[0].InPoint != 0 || len(preview.VideoChannels[1].Clips[0].Segments[0].Effects) != 1 {
		t.Fatal("temporal effect lost its original history")
	}
}

func TestPreviewFrameGridAndGapsRemainRenderable(t *testing.T) {
	req := renderRequest{FPS: 30, VideoChannels: []channel{{Clips: []clip{{File: "shot.mp4", Start: 10, InPoint: 0, OutPoint: 10}}}}}
	preview, window := previewRequest(req, PreviewWindow{Start: 12.51, Duration: 1.01})
	if math.Abs(*preview.Duration-31.0/30) > fadeEps || math.Abs(window.Start-0.01) > fadeEps {
		t.Fatal("preview source work is not aligned to the authored frame grid", *preview.Duration, window)
	}
	gap, _ := previewRequest(req, PreviewWindow{Start: 1, Duration: 1})
	if !gap.previewBlank || len(gap.VideoChannels) != 0 {
		t.Fatal("preview cannot render an intentional black gap", gap)
	}
}
