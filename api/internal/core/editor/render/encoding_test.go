package render

import (
	"strings"
	"testing"
)

func TestExportEncodingPreservesDeliveryQuality(t *testing.T) {
	t.Setenv("RENDER_VIDEO_ENCODER", "")
	t.Setenv("RENDER_X264_PRESET", "")
	settings, err := parseOutputSettings("mp4", "high")
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Join(settings.videoEncodingArgs(), " ")
	for _, want := range []string{"-c:v libx264", "-preset medium", "-crf 18", "-pix_fmt yuv420p"} {
		if !strings.Contains(args, want) {
			t.Fatalf("missing %s in %s", want, args)
		}
	}
	if videoCrf != "0" || videoPixFmt != "yuv444p" {
		t.Fatal("intermediate encodes must not discard detail or chroma")
	}
}

func TestExportEncodingRejectsInvalidConfiguration(t *testing.T) {
	t.Setenv("RENDER_VIDEO_ENCODER", "unknown")
	if _, err := parseOutputSettings("mp4", "normal"); err == nil {
		t.Fatal("invalid encoder accepted")
	}
	t.Setenv("RENDER_VIDEO_ENCODER", "libx264")
	t.Setenv("RENDER_X264_PRESET", "medium -crf 40")
	if _, err := parseOutputSettings("mp4", "normal"); err == nil {
		t.Fatal("invalid preset accepted")
	}
}

func TestNVENCIsExplicitAndDoesNotChangeIntermediates(t *testing.T) {
	t.Setenv("RENDER_VIDEO_ENCODER", "h264_nvenc")
	t.Setenv("RENDER_X264_PRESET", "medium")
	settings, err := parseOutputSettings("mp4", "high")
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Join(settings.videoEncodingArgs(), " ")
	if !strings.Contains(args, "-c:v h264_nvenc -preset p7") || !strings.Contains(args, "-cq 18") || strings.Contains(args, "-crf") {
		t.Fatal(args)
	}
	if videoCodec != "libx264" || videoCrf != "0" {
		t.Fatal("GPU delivery must not alter lossless intermediates")
	}
}

func TestBaseMaskNeededOnlyForCompositingOrAlpha(t *testing.T) {
	opacity := 0.5
	for _, test := range []struct {
		clip clip
		want bool
	}{
		{clip: clip{}, want: false},
		{clip: clip{Opacity: &opacity}, want: true},
		{clip: clip{sceneTransparent: true}, want: true},
	} {
		if got := channelNeedsBaseMask(channel{Clips: []clip{test.clip}}); got != test.want {
			t.Fatalf("mask=%t, want %t for %+v", got, test.want, test.clip)
		}
	}
}
