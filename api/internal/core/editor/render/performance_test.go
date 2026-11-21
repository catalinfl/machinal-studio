package render

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestSinglePieceConcatReusesImmutableMedia(t *testing.T) {
	root := t.TempDir()
	source, output := filepath.Join(root, "source.mp4"), filepath.Join(root, "output.mp4")
	data := []byte("immutable intermediate")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := concatFiles([]string{source}, output, root, "list.txt"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(source); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(output)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("single-piece output lost bytes after source cleanup: %q, %v", got, err)
	}
}

func BenchmarkVideoSegments(b *testing.B) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		b.Skip("set FFMPEG_INTEGRATION=1 for the synthetic segment benchmark")
	}
	root := b.TempDir()
	source := filepath.Join(root, "source.mp4")
	command := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=1", "-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt, "-threads", "2", source)
	if output, err := command.CombinedOutput(); err != nil {
		b.Fatalf("create fixture: %v: %s", err, output)
	}
	clips := make([]clip, 4)
	for index := range clips {
		clips[index] = clip{File: "source.mp4", MediaKind: "video", OutPoint: 1, Start: float64(index)}
	}
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		work := filepath.Join(root, fmt.Sprintf("render-%d", iteration))
		if err := os.Mkdir(work, 0700); err != nil {
			b.Fatal(err)
		}
		if _, err := buildVideoTrack(clips, 1920, 1080, 30, work, 4, nil, nil, fileScope{root: root}, ""); err != nil {
			b.Fatal(err)
		}
	}
}
