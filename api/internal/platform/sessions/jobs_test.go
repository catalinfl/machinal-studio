package sessions

import (
	"os"
	"testing"
	"time"
)

func TestQueuedJobsPreventSessionExpiry(t *testing.T) {
	id := NewID()
	root, err := TouchOwned(id, "job-owner")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { SetJobSessions(nil); Evict(id) })
	mu.Lock()
	entries[id].lastSeen = time.Now().Add(-time.Hour)
	mu.Unlock()
	ProtectJobSession(id)
	collectExpired(time.Minute)
	if _, err := os.Stat(root); err != nil {
		t.Fatal("queued job's source workspace was evicted", err)
	}
	SetJobSessions(nil)
	collectExpired(time.Minute)
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("finished job permanently pinned its temporary workspace", err)
	}
}
