package sessions

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/storage"
)

func TestProjectOwnershipAndMediaSurviveRestartAndCollection(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	id := "p_" + NewID()
	if err := BindProject(id, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := BindProject(id, "bob"); err == nil {
		t.Fatal("owner changed")
	}
	root, err := TouchOwned(id, "alice")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "clip.mp4")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	delete(owners, id)
	entries[id].lastSeen = time.Now().Add(-time.Hour)
	mu.Unlock()
	if owner, ok := OwnerOf(id); !ok || owner != "alice" {
		t.Fatalf("owner after restart: %q %v", owner, ok)
	}
	if prefix := S3Prefix(id); prefix != id {
		t.Fatalf("shared media prefix: %q", prefix)
	}
	collectExpired(time.Minute)
	if data, err := os.ReadFile(path); err != nil || string(data) != "original" {
		t.Fatalf("project collected: %v", err)
	}
	mu.Lock()
	delete(entries, id)
	delete(owners, id)
	mu.Unlock()
}
