package render

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestNativePreviewKeepsCadenceConversionPhase(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for preview cadence parity")
	}
	root := t.TempDir()
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=24:d=3", "-c:v", "libx264", "-threads", "2", filepath.Join(root, "shot.mp4"))
	req := renderRequest{FPS: 30, Format: "mp4", Quality: "normal", VideoChannels: []channel{{Clips: []clip{{File: "shot.mp4", MediaKind: "video", InPoint: 0, OutPoint: 3}}}}}
	req.Resolution.W, req.Resolution.H = 128, 72
	window := PreviewWindow{Start: 26.0 / 30, Duration: 15.0 / 30}
	preview, local := previewRequest(req, window)
	fullFile := renderPreviewParityTrack(t, root, req)
	previewFile := renderPreviewParityTrack(t, root, preview)
	if !bytes.Equal(previewFrames(t, fullFile, 26, 41), previewFrames(t, previewFile, int(local.Start*30), int(local.Start*30)+15)) {
		t.Fatal("preview restarted fps conversion instead of preserving its original sampling phase")
	}
}

func TestNativePreviewKeepsTransitionsAndCaptionMotion(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for preview transition/caption parity")
	}
	root := t.TempDir()
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=10:d=6", "-c:v", "libx264", "-threads", "2", filepath.Join(root, "shot.mp4"))
	req := renderRequest{FPS: 10, Format: "mp4", Quality: "normal", VideoChannels: []channel{{Clips: []clip{
		{File: "shot.mp4", InPoint: 0, OutPoint: 1, Start: 0},
		{File: "shot.mp4", InPoint: 0, OutPoint: 3, Start: 5},
		{File: "shot.mp4", InPoint: 3, OutPoint: 6, Start: 7.5},
	}, Transitions: []transition{{RightClipIndex: 2, Xfade: "fade"}}}}}
	req.Resolution.W, req.Resolution.H = 128, 72
	overlay := integrationOverlay(t)
	overlay.Start, overlay.Duration, overlay.Animation = 7_000_000, 2_000_000, "float"
	overlay.AnimationDuration = 300_000
	if err := convertJSON([]any{overlay}, &req.TextItems); err != nil {
		t.Fatal(err)
	}
	preview, local := previewRequest(req, PreviewWindow{Start: 7.8, Duration: 0.4})
	fullFile := renderPreviewParityTrack(t, root, req)
	previewFile := renderPreviewParityTrack(t, root, preview)
	if *preview.Duration >= 10.5 || !bytes.Equal(previewFrames(t, fullFile, 78, 82), previewFrames(t, previewFile, int(local.Start*10+0.5), int(local.Start*10+0.5)+4)) {
		t.Fatal("preview changed transition pixels/caption animation or retained the complete timeline")
	}
}

func renderPreviewParityTrack(t *testing.T, root string, req renderRequest) string {
	t.Helper()
	plan, err := prepareRenderPlan(req, fileScope{root: root})
	if err != nil {
		t.Fatal(err)
	}
	file, err := renderVideoTrack(req, plan, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return file
}

func previewFrames(t *testing.T, file string, start, end int) []byte {
	t.Helper()
	return commandOutput(t, "ffmpeg", "-v", "error", "-i", file, "-vf", fmt.Sprintf("trim=start_frame=%d:end_frame=%d,setpts=PTS-STARTPTS", start, end), "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
}
