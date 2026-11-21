package scenes

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/core/media"
)

func TestSceneVideoInputsRejectDuplicatesPathsAndUnknownLooks(t *testing.T) {
	input := SceneVideo{ID: "video_1", File: "footage.mp4", Name: "Footage.mp4", Look: "cinematic"}
	if err := validateVideoInputs([]SceneVideo{input}); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*SceneVideo){
		func(v *SceneVideo) { v.File = "../footage.mp4" },
		func(v *SceneVideo) { v.File = "footage.mov" },
		func(v *SceneVideo) { v.ID = "video_3" },
		func(v *SceneVideo) { v.Look = "unknown" },
		func(v *SceneVideo) { v.Description = strings.Repeat("ș", maxVideoDescription+1) },
	} {
		invalid := input
		change(&invalid)
		if validateVideoInputs([]SceneVideo{invalid}) == nil {
			t.Fatalf("accepted invalid video: %+v", invalid)
		}
	}
	if validateVideoInputs([]SceneVideo{input, input}) == nil {
		t.Fatal("accepted duplicate video ID")
	}
}

func TestSceneVideoUsesMeasuredMetadataAndEmbedsOriginalBytes(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "video.webm"), []byte("original bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	probe := func(context.Context, string, string) (media.Metadata, error) {
		return media.Metadata{Width: 320, Height: 180, Duration: 2, VideoCodec: "vp9", FormatName: "matroska,webm"}, nil
	}
	video, err := readSceneVideo(context.Background(), root, SceneVideo{ID: "video_1", File: "video.webm", Width: 999, Duration: 999}, probe)
	if err != nil {
		t.Fatal(err)
	}
	if video.Width != 320 || video.Duration != 2 || video.DataURL != "data:video/webm;base64,b3JpZ2luYWwgYnl0ZXM=" {
		t.Fatalf("invalid embedded original: %+v", video)
	}
	encoded, err := json.Marshal(video)
	if err != nil || strings.Contains(string(encoded), "base64") {
		t.Fatal("video bytes leaked into AI metadata")
	}
	if err := validateVideoSources(videoSources([]SceneVideo{video})); err != nil {
		t.Fatal(err)
	}
	if validateVideoSources(map[string]string{"video_1": "https://example.test/video.mp4"}) == nil {
		t.Fatal("accepted external video source")
	}
}

func TestSceneVideoRejectsUnsupportedCodecsAndDurations(t *testing.T) {
	valid := media.Metadata{Width: 320, Height: 180, Duration: 2, VideoCodec: "h264", FormatName: "mov,mp4,m4a,3gp,3g2,mj2"}
	for _, change := range []func(*media.Metadata){
		func(m *media.Metadata) { m.VideoCodec = "hevc" },
		func(m *media.Metadata) { m.Duration = maxSceneSeconds + 1 },
		func(m *media.Metadata) { m.Duration = math.NaN() },
		func(m *media.Metadata) { m.Width = maxSceneVideoDimension + 1 },
	} {
		invalid := valid
		change(&invalid)
		if _, err := sceneVideoMIME(invalid); err == nil {
			t.Fatalf("accepted unsupported media: %+v", invalid)
		}
	}
}
