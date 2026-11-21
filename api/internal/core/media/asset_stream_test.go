package media

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestAssetStreamClosePreservesFileAndOtherReaders(t *testing.T) {
	path := filepath.Join(t.TempDir(), "media.bin")
	if err := os.WriteFile(path, []byte("unchanged-media"), 0600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	other, err := os.Open(path)
	if err != nil {
		file.Close()
		t.Fatal(err)
	}
	defer other.Close()
	stream := &assetStream{Reader: io.LimitReader(file, 4), file: file}
	if data, err := io.ReadAll(stream); err != nil || string(data) != "unch" {
		t.Fatalf("partial transfer changed: %q %v", data, err)
	}
	if err := stream.Close(); err != nil {
		t.Fatal(err)
	}
	if err := stream.Close(); err != nil {
		t.Fatal("double close failed", err)
	}
	if _, err := file.Stat(); err == nil {
		t.Fatal("completed stream retained its descriptor")
	}
	if data, err := io.ReadAll(other); err != nil || string(data) != "unchanged-media" {
		t.Fatalf("concurrent reader lost media: %q %v", data, err)
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "unchanged-media" {
		t.Fatalf("persisted file changed: %q %v", data, err)
	}
}
