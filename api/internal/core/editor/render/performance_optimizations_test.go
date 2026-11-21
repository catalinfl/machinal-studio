package render

import (
	"bytes"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCreatorNaturalChainAvoidsRGBPingPong(t *testing.T) {
	chain := []effect{
		{ID: "denoise"},
		{ID: "contrast-pop"},
		{ID: "sharpen-edges"},
		{ID: "film-grain"},
	}
	got, err := buildFilter(chain)
	if err != nil {
		t.Fatalf("build creator-natural chain: %v", err)
	}
	if strings.Contains(got, "format=rgb24") {
		t.Fatalf("YUV-native effect chain unexpectedly inserted format=rgb24 ping-pong: %q", got)
	}
	if count := strings.Count(got, "format=yuv444p"); count != 1 {
		t.Fatalf("YUV-native effect chain inserted %d format=yuv444p conversions, want 1: %q", count, got)
	}
	for _, want := range []string{"hqdn3d=", "eq=", "cas=", "noise="} {
		if !strings.Contains(got, want) {
			t.Fatalf("chain %q missing %q", got, want)
		}
	}
}

func TestSyntheticScenesSkipDenoiseWhileRealFootageKeepsIt(t *testing.T) {
	part := segment{
		SrcStart: 0,
		SrcEnd:   3,
		Effects: []effect{
			{ID: "denoise"},
			{ID: "contrast-pop"},
			{ID: "sharpen-edges"},
			{ID: "film-grain"},
		},
	}
	sceneClip := clip{File: "scene_export_1.mp4", fromScene: true, OutPoint: 3}
	sceneFilter, _, err := videoSegmentFilter(sceneClip, part, 1080, 1920, 30, "")
	if err != nil {
		t.Fatalf("scene filter: %v", err)
	}
	if strings.Contains(sceneFilter, "hqdn3d=") {
		t.Fatalf("synthetic scene clip should skip hqdn3d denoise: %q", sceneFilter)
	}
	for _, want := range []string{"eq=", "cas=", "noise="} {
		if !strings.Contains(sceneFilter, want) {
			t.Fatalf("synthetic scene clip dropped non-denoise effect %q: %q", want, sceneFilter)
		}
	}

	cameraClip := clip{File: "camera.mp4", fromScene: false, OutPoint: 3}
	cameraFilter, _, err := videoSegmentFilter(cameraClip, part, 1080, 1920, 30, "")
	if err != nil {
		t.Fatalf("camera filter: %v", err)
	}
	if !strings.Contains(cameraFilter, "hqdn3d=") {
		t.Fatalf("real footage clip unexpectedly dropped hqdn3d denoise: %q", cameraFilter)
	}
}

func TestTaskThreadBudgetUsesFullCPUPerWorker(t *testing.T) {
	if got := taskThreadBudget(4, 2); got != 2 {
		t.Fatalf("taskThreadBudget(4, 2) = %d, want 2", got)
	}
	if got := taskThreadBudget(2, 1); got != 2 {
		t.Fatalf("taskThreadBudget(2, 1) = %d, want 2", got)
	}
	if got := taskThreadBudget(1, 2); got != 1 {
		t.Fatalf("taskThreadBudget(1, 2) = %d, want 1", got)
	}
}

func TestPlanWindowedGroupSplitsOnlyTransitionHandlesAndShiftsRamps(t *testing.T) {
	r := &ramp{Mode: "in-out", Curve: "linear", Amount: 0.5, BlockDuration: 4, Offset: 0}
	clips := []clip{
		{
			File: "a.mp4", Start: 0, InPoint: 0, OutPoint: 4,
			Segments: []segment{{SrcStart: 0, SrcEnd: 4, Effects: []effect{{ID: "glow-bloom", Ramp: r}}}},
		},
		{
			File: "b.mp4", Start: 3.6, InPoint: 0, OutPoint: 4,
		},
		{
			File: "c.mp4", Start: 7.2, InPoint: 0, OutPoint: 4,
		},
	}
	group, slices := planWindowedGroup(0, 0, 2, clips, 30, map[int]string{1: "fade", 2: "wipeleft"})
	if !group.windowed || len(group.transitions) != 2 {
		t.Fatalf("expected windowed group with 2 transitions, got %+v", group)
	}
	if group.transitions[0].frames != 12 || group.transitions[1].frames != 12 {
		t.Fatalf("unexpected transition frame counts: %+v", group.transitions)
	}
	if len(slices[0].headSegments) != 0 || len(slices[0].bodySegments) != 1 || len(slices[0].tailSegments) != 1 {
		t.Fatalf("unexpected clip 0 slices: %+v", slices[0])
	}
	if math.Abs(slices[0].tailSegments[0].Effects[0].Ramp.Offset-3.6) > 1e-5 {
		t.Fatalf("tail ramp offset = %v, want 3.6", slices[0].tailSegments[0].Effects[0].Ramp.Offset)
	}
	if r.Offset != 0 {
		t.Fatalf("original ramp was mutated: offset=%v", r.Offset)
	}
	if len(slices[1].headSegments) != 1 || len(slices[1].bodySegments) != 1 || len(slices[1].tailSegments) != 1 {
		t.Fatalf("unexpected middle clip slices: %+v", slices[1])
	}
}

func TestPlanWindowedGroupFallsBackWhenTransitionsCollide(t *testing.T) {
	clips := []clip{
		{File: "a.mp4", Start: 0, InPoint: 0, OutPoint: 2},
		{File: "b.mp4", Start: 1.5, InPoint: 0, OutPoint: 0.8},
		{File: "c.mp4", Start: 1.8, InPoint: 0, OutPoint: 2},
	}
	group, _ := planWindowedGroup(0, 0, 2, clips, 30, map[int]string{1: "fade", 2: "fade"})
	if group.windowed {
		t.Fatalf("colliding transitions on short middle clip must fall back to chained xfadeGroup")
	}
}

func TestFFmpegWindowedXfadeMatchesChainedXfadePixels(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 to verify windowed xfade parity with native FFmpeg")
	}
	root := t.TempDir()
	colors := []string{"red", "green", "blue"}
	clips := make([]clip, len(colors))
	for i, c := range colors {
		name := c + ".mp4"
		commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c="+c+":s=96x64:r=30:d=1.2",
			"-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt, "-threads", "1", filepath.Join(root, name))
		clips[i] = clip{File: name, MediaKind: "video", Start: float64(i) * 0.8, InPoint: 0, OutPoint: 1.2}
	}
	xfadeByRight := map[int]string{1: "fade", 2: "wipeleft"}

	// Windowed path (via buildVideoTrack).
	winWork := filepath.Join(root, "windowed")
	if err := os.Mkdir(winWork, 0o700); err != nil {
		t.Fatal(err)
	}
	winOut, err := buildVideoTrack(clips, 96, 64, 30, winWork, 2.8, xfadeByRight, nil, fileScope{root: root}, "")
	if err != nil {
		t.Fatalf("windowed buildVideoTrack: %v", err)
	}

	// Reference chained xfadeGroup path.
	refWork := filepath.Join(root, "chained")
	if err := os.Mkdir(refWork, 0o700); err != nil {
		t.Fatal(err)
	}
	refFiles, err := renderVideoSegments(clips, 96, 64, 30, refWork, nil, fileScope{root: root}, "")
	if err != nil {
		t.Fatalf("reference renderVideoSegments: %v", err)
	}
	refOut, err := xfadeGroup(clips, refFiles, 30, refWork, 0, 0, xfadeByRight, nil)
	if err != nil {
		t.Fatalf("reference xfadeGroup: %v", err)
	}

	decode := func(file string) []byte {
		t.Helper()
		out, err := exec.Command("ffmpeg", "-v", "error", "-i", file, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1").Output()
		if err != nil {
			t.Fatalf("decode %s: %v", file, err)
		}
		return out
	}
	gotPixels, wantPixels := decode(winOut), decode(refOut)
	if len(gotPixels) != len(wantPixels) {
		t.Fatalf("windowed frame bytes = %d, chained = %d", len(gotPixels), len(wantPixels))
	}
	if !bytes.Equal(gotPixels, wantPixels) {
		maxDiff := 0
		for i := range gotPixels {
			d := int(gotPixels[i]) - int(wantPixels[i])
			if d < 0 {
				d = -d
			}
			if d > maxDiff {
				maxDiff = d
			}
		}
		if maxDiff > 1 {
			t.Fatalf("windowed xfade diverged from chained xfade: max pixel diff = %d", maxDiff)
		}
	}
}

func TestFFmpegGlowBloomAndHalationRampsMatchOuterBlend(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 to verify native glow-bloom/halation ramp parity")
	}
	r := ramp{Mode: "in-out", Curve: "ease-in-out", Amount: 0.4, BlockDuration: 1.0}
	for _, id := range []string{"glow-bloom", "halation"} {
		t.Run(id, func(t *testing.T) {
			fastPixels := nativeParityFrames(t, effect{ID: id, Ramp: &r}, parityFPS)
			inner, err := buildEffectFilter(effect{ID: id})
			if err != nil {
				t.Fatal(err)
			}
			refFilter := wrapIntensityFilter(inner, rampIntensityExpr(r), "ref0")
			cmd := exec.Command("ffmpeg", "-v", "error", "-nostdin",
				"-f", "lavfi", "-i", paritySource, "-filter_complex_threads", "1",
				"-filter_complex", "[0:v]"+refFilter+"[out]", "-map", "[out]",
				"-frames:v", "12", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
			refPixels, err := cmd.Output()
			if err != nil {
				t.Fatalf("reference %s: %v", id, err)
			}
			var errorSum float64
			for i := range refPixels {
				errorSum += math.Abs(float64(fastPixels[i]) - float64(refPixels[i]))
			}
			if mae := errorSum / float64(len(refPixels)); mae > 1.5 {
				t.Fatalf("%s native sendcmd screen ramp diverged from reference: MAE=%.2f", id, mae)
			}
		})
	}
}
