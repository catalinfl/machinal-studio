package render

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestIntermediateReencodingPreservesYUV444Pixels(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for lossless intermediate pixel verification")
	}
	root := t.TempDir()
	current := filepath.Join(root, "initial.mp4")
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=10:d=0.5", "-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt, "-threads", "2", current)
	decode := func(file string) []byte {
		t.Helper()
		data, err := exec.Command("ffmpeg", "-v", "error", "-i", file, "-pix_fmt", "yuv444p", "-f", "rawvideo", "pipe:1").Output()
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	want := decode(current)
	if len(want) != 128*72*3*5 {
		t.Fatalf("unexpected frame count: %d bytes", len(want))
	}
	for pass := 0; pass < 3; pass++ {
		next := filepath.Join(root, fmt.Sprintf("pass-%d.mp4", pass))
		var progress *renderProgress
		if err := progress.runFFmpeg(0.5, 0.5, "quality regression intermediate", "-i", current, "-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt, "-threads", "2", next); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(want, decode(next)) {
			t.Fatalf("intermediate pass %d changed decoded YUV444 pixels", pass+1)
		}
		current = next
	}
}

func TestOpaqueBaseDoesNotRenderUnusedMask(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for native base-mask optimization verification")
	}
	root := t.TempDir()
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=128x72:r=10:d=0.5", "-c:v", "libx264", "-threads", "2", filepath.Join(root, "source.mp4"))
	request := renderRequest{VideoChannels: []channel{{Clips: []clip{{File: "source.mp4", MediaKind: "video", OutPoint: 0.5}}}}}
	request.Resolution.W, request.Resolution.H = 128, 72
	work := filepath.Join(root, "work")
	if err := os.Mkdir(work, 0700); err != nil {
		t.Fatal(err)
	}
	output, err := buildVideo(request, 1, 10, 0.5, work, nil, fileScope{root: root})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(work, "video_channel_0", "alpha_mask")); !os.IsNotExist(err) {
		t.Fatalf("unused base mask was rendered: %v", err)
	}
	assertMediaDurationWithStreams(t, output, 0.5, 1)
	assertDominantFrame(t, output, "0.2", 2)
}

func TestParallelSegmentsPreserveOrderedPixels(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for native segment ordering verification")
	}
	root := t.TempDir()
	commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=10:d=1", "-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt, "-threads", "2", filepath.Join(root, "source.mp4"))
	clips := []clip{{File: "source.mp4", OutPoint: 1, Segments: []segment{{SrcStart: 0, SrcEnd: 0.3}, {SrcStart: 0.3, SrcEnd: 0.7}, {SrcStart: 0.7, SrcEnd: 1}}}}
	work := filepath.Join(root, "work")
	if err := os.Mkdir(work, 0700); err != nil {
		t.Fatal(err)
	}
	output, err := buildVideoTrack(clips, 128, 72, 10, work, 1, nil, nil, fileScope{root: root}, "")
	if err != nil {
		t.Fatal(err)
	}
	decode := func(file string) []byte {
		t.Helper()
		data, err := exec.Command("ffmpeg", "-v", "error", "-i", file, "-pix_fmt", videoPixFmt, "-f", "rawvideo", "pipe:1").Output()
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	var want []byte
	for index := range clips[0].Segments {
		want = append(want, decode(filepath.Join(work, fmt.Sprintf("vc0_s%d.mp4", index)))...)
	}
	if got := decode(output); len(got) != 128*72*3*10 || !bytes.Equal(got, want) {
		t.Fatalf("parallel assembly changed frames: got %d bytes, expected %d", len(got), len(want))
	}
}

func TestNativeTimestampProbeRetainsGaps(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 for decoded timestamp verification")
	}
	for _, gapped := range []bool{false, true} {
		path := filepath.Join(t.TempDir(), "source.mp4")
		filter := "null"
		if gapped {
			filter = "select='not(between(n,3,7))'"
		}
		commandOutput(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=128x72:r=10:d=1", "-vf", filter, "-fps_mode", "vfr", "-c:v", "libx264", "-threads", "2", path)
		times, err := probeFrameTimestamps(path, 0, 1)
		if err != nil {
			t.Fatal(err)
		}
		problem := assessTimestampCoverage(times, 0, 1)
		if (problem != "") != gapped {
			t.Fatalf("gapped=%t, timestamps=%v, problem=%q", gapped, times, problem)
		}
	}
}
