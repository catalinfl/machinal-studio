package render

import (
	"bytes"
	"math"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestFusedEligibilityKeepsLayerMasksAndSegmentBoundaries(t *testing.T) {
	req := renderRequest{VideoChannels: []channel{{Clips: []clip{{File: "scene.mp4", InPoint: 0, OutPoint: 2}}}}}
	plan := renderPlan{videoClipCount: 1, totalDuration: 2}
	if _, _, ok := directVideoClip(req, plan); !ok {
		t.Fatal("single ordinary clip cannot bypass lossless intermediates")
	}
	for _, moving := range []clip{
		{File: "alpha.webm", InPoint: 0, OutPoint: 2, sceneTransparent: true},
		{File: "late.mp4", Start: 1, InPoint: 0, OutPoint: 2},
		{File: "segmented.mp4", InPoint: 0, OutPoint: 2, Segments: []segment{{SrcStart: 0, SrcEnd: 1}, {SrcStart: 1, SrcEnd: 2}}},
	} {
		req.VideoChannels[0].Clips[0] = moving
		if _, _, ok := directVideoClip(req, plan); ok {
			t.Fatal("unsafe clip entered direct encoding", moving)
		}
	}
}

func TestFusedEncodingAppliesTextAndAudioInDeliveryPass(t *testing.T) {
	settings, err := parseOutputSettings("mp4", "high")
	if err != nil {
		t.Fatal(err)
	}
	items := []textItem{{Start: 0, Duration: 1, X: 20, Y: 30, data: []byte("raster")}}
	args, err := fusedEncodingArgs([]string{"-i", "video.mp4"}, "setpts=PTS-STARTPTS", items, []fusedTextInput{{index: 0}}, "audio.w64", t.TempDir(), renderPlan{fps: 30, output: settings}, 30, nil)
	if err != nil || !slices.Contains(args, "faster") || !slices.Contains(args, "18") || !slices.Contains(args, "2:a:0") {
		t.Fatal("fused output changed delivery quality or lost audio mapping", args, err)
	}
	if slices.Index(args, "-filter_complex") < 0 || slices.Index(args, "libx264") < 0 || slices.Contains(args, "ultrafast") {
		t.Fatal("fused pass is not the final delivery encode", args)
	}
}

func TestNativeFusedOutputMatchesStagedPixelsAndKeepsAudio(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for native fused/staged comparison")
	}
	root := t.TempDir()
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=10:d=1", "-c:v", "libx264", "-threads", "2", filepath.Join(root, "shot.mp4"))
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", filepath.Join(root, "voice.wav"))
	req := renderRequest{FPS: 10, Format: "mp4", Quality: "high", VideoChannels: []channel{{Clips: []clip{{File: "shot.mp4", InPoint: 0, OutPoint: 1}}}}, AudioChannels: []channel{{Clips: []clip{{File: "voice.wav", InPoint: 0, OutPoint: 1}}}}}
	req.Resolution.W, req.Resolution.H = 128, 72
	overlay := integrationOverlay(t)
	overlay.Start, overlay.Duration = 0, 1_000_000
	if err := convertJSON([]any{overlay}, &req.TextItems); err != nil {
		t.Fatal(err)
	}
	plan, err := prepareRenderPlan(req, fileScope{root: root})
	if err != nil {
		t.Fatal(err)
	}
	baseline := t.TempDir()
	video, audio, err := renderTracks(req, plan, baseline, nil)
	if err != nil {
		t.Fatal(err)
	}
	staged := filepath.Join(root, "staged.mp4")
	if err := writeRenderOutput(plan, video, audio, staged, nil); err != nil {
		t.Fatal(err)
	}
	_, fused, err := executeRender(req, plan, nil)
	if err != nil {
		t.Fatal(err)
	}
	pixels := func(path string) []byte {
		return commandOutput(t, "ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
	}
	stagedPixels, fusedPixels := pixels(staged), pixels(fused)
	if !bytes.Equal(stagedPixels, fusedPixels) {
		if len(stagedPixels) != len(fusedPixels) {
			t.Fatal("fusing output changed frame count or dimensions", len(stagedPixels), len(fusedPixels))
		}
		var squared float64
		maximum := 0
		for index, pixel := range stagedPixels {
			difference := int(pixel) - int(fusedPixels[index])
			maximum = max(maximum, int(math.Abs(float64(difference))))
			squared += float64(difference * difference)
		}
		t.Fatalf("fusing final text/delivery changed decoded fixture pixels: RMSE=%g max=%d", math.Sqrt(squared/float64(len(stagedPixels))), maximum)
	}
	assertMediaDurationWithStreams(t, fused, 1, 2)
	assertPreviewAudioSignal(t, fused)
}
