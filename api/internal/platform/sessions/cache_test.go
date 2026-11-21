package sessions

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/storage"
)

func TestPersistentProjectCleanupReclaimsDerivedCacheButKeepsOriginals(t *testing.T) {
	id := "p_" + NewID()
	root, err := TouchOwned(id, "cache-owner")
	if err != nil {
		t.Fatal(err)
	}
	if err := BindProject(id, "cache-owner"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { Evict(id); os.Remove(filepath.Join(storage.DataDir, ".project-owners", id)) })
	source := filepath.Join(root, "source.mp4")
	if err := os.WriteFile(source, []byte("sole original"), 0600); err != nil {
		t.Fatal(err)
	}
	cache := filepath.Join(root, mediacache.Directory, "derived")
	if err := os.MkdirAll(cache, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cache, "thumbnail.png"), []byte("derived"), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	os.Chtimes(cache, old, old)
	mu.Lock()
	entries[id].lastSeen = old
	mu.Unlock()
	SetJobSessions([]string{id})
	collectExpired(time.Minute)
	if _, err := os.Stat(cache); err != nil {
		t.Fatal("active job cache removed", err)
	}
	SetJobSessions(nil)
	release := UseWorkspace(id)
	collectExpired(time.Minute)
	_, leaseErr := os.Stat(cache)
	release()
	if leaseErr != nil {
		t.Fatal("leased workspace was collected", leaseErr)
	}
	collectExpired(time.Minute)
	if _, err := os.Stat(cache); !os.IsNotExist(err) {
		t.Fatal("persistent project leaked derived cache", err)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatal("local-only original removed", err)
	}
}
