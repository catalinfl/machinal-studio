package sessions

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"ffmpeg-go-server/internal/platform/storage"
)

func TestMediaCapabilityValidationNeverCreatesState(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	if ValidMediaToken("u_unknown", strings.Repeat("a", 64)) || ValidMediaToken("../outside", strings.Repeat("a", 64)) {
		t.Fatal("unknown media capability accepted")
	}
	entries, err := os.ReadDir(storage.DataDir)
	if err != nil || len(entries) != 0 {
		t.Fatal("capability validation created state", entries, err)
	}
}

func TestMediaCapabilitiesAreStableUnderConcurrentIssuanceAndRevocable(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	const callers = 10
	results := make(chan string, callers)
	var wait sync.WaitGroup
	for range callers {
		wait.Go(func() {
			token, err := MediaToken("u_alice")
			if err != nil {
				t.Error(err)
				return
			}
			results <- token
		})
	}
	wait.Wait()
	close(results)
	first := ""
	for token := range results {
		if first != "" && first != token {
			t.Fatal("concurrent issuance replaced an active token")
		}
		first = token
	}
	if first == "" || !ValidMediaToken("u_alice", first) || ValidMediaToken("u_bob", first) {
		t.Fatal("media capability did not remain workspace-bound")
	}
	if err := os.Remove(filepath.Join(storage.DataDir, ".media-tokens", "u_alice")); err != nil {
		t.Fatal(err)
	}
	if ValidMediaToken("u_alice", first) {
		t.Fatal("removed capability still accepted")
	}
	second, err := MediaToken("u_alice")
	if err != nil || second == first {
		t.Fatal("capability rotation failed", err)
	}
}
