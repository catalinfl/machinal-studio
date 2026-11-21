package sessions

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/storage"
)

var workspaceLocks sync.Map

func workspaceLock(id string) *sync.RWMutex {
	lock, _ := workspaceLocks.LoadOrStore(id, &sync.RWMutex{})
	return lock.(*sync.RWMutex)
}

func UseWorkspace(id string) func() {
	lock := workspaceLock(id)
	lock.RLock()
	return lock.RUnlock
}

func collectIdleWorkspaces(ttl time.Duration) {
	mu.Lock()
	ready := jobInventoryReady
	mu.Unlock()
	if !ready {
		return
	} // A queue outage at startup must not expose queued sources to cleanup.
	directories, err := os.ReadDir(storage.DataDir)
	if err != nil {
		return
	}
	before := time.Now().Add(-ttl)
	for _, directory := range directories {
		if directory.IsDir() && !strings.HasPrefix(directory.Name(), ".") && Valid(directory.Name()) {
			pruneIdleWorkspace(directory.Name(), before)
		}
	}
}

func pruneIdleWorkspace(id string, before time.Time) {
	lock := workspaceLock(id)
	if !lock.TryLock() {
		return
	}
	defer lock.Unlock()
	mu.Lock()
	e := entries[id]
	active := jobProtection[id] || e != nil && !e.lastSeen.Before(before)
	mu.Unlock()
	if active {
		return
	}
	root, err := storage.UserDir(id)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := objectstore.Shared().DiscoverCloudCopies(ctx, root, S3Prefixes(id), before); err != nil {
		log.Printf("legacy workspace cache discovery: %v", err)
		return
	}
	freed, err := objectstore.Shared().PruneCloudCopies(ctx, root, before)
	if err != nil {
		log.Printf("workspace cache cleanup: %v", err)
		return
	}
	pruneDerivedCache(filepath.Join(root, mediacache.Directory), before)
	if freed > 0 {
		log.Printf("workspace cache cleanup: reclaimed %d bytes", freed)
	}
	// Remove only an empty workspace; local-only uploads and failed S3 publications survive.
	if !isPersistentProject(id) && os.Remove(root) == nil {
		mu.Lock()
		delete(entries, id)
		delete(owners, id)
		mu.Unlock()
	}
}

func pruneDerivedCache(directory string, before time.Time) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return
	}
	defer os.Remove(directory)
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || !entry.IsDir() || !info.ModTime().Before(before) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(directory, entry.Name())); err != nil {
			log.Printf("derived cache cleanup: %v", err)
		}
	}
}
