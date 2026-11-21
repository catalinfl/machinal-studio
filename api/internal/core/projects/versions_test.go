package projects

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"ffmpeg-go-server/internal/platform/storage"
)

func TestNamedVersionsPreserveCaptionBytesAndRejectStaleSaves(t *testing.T) {
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	state := json.RawMessage(`{"schemaVersion":1,"timeline":{"channels":[],"textItems":[{"id":"c1","text":"  Știință\nși țară! ","words":[{"text":" Știință","start":0.1,"end":0.4}]}],"documentSession":{"document":{"jobs":[{"resultTextIds":["c1"]}]}}},"media":[]}`)
	project, err = store.Update("alice", project.ID, project.Name, project.Version, state)
	if err != nil {
		t.Fatal(err)
	}
	version, err := store.SaveVersion("alice", project.ID, "Before cuts", project.Version)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveVersion("alice", project.ID, "Stale", project.Version-1); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale checkpoint: %v", err)
	}
	if _, err := store.ListVersions("bob", project.ID); err == nil {
		t.Fatal("foreign checkpoint list allowed")
	}
	if _, err := store.VersionState("alice", project.ID, "../other"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("traversal: %v", err)
	}
	restarted := testStore(store.Root)
	saved, err := restarted.VersionState("alice", project.ID, version.ID)
	if err != nil || string(saved.State) != string(state) {
		t.Fatalf("caption checkpoint changed: %s %v", saved.State, err)
	}
	versions, err := restarted.ListVersions("alice", project.ID)
	if err != nil || len(versions) != 1 || versions[0].Name != "Before cuts" {
		t.Fatal(versions, err)
	}
	for i := 1; i < maxProjectVersions; i++ {
		if _, err := restarted.SaveVersion("alice", project.ID, "Checkpoint", project.Version); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := restarted.SaveVersion("alice", project.ID, "Overflow", project.Version); err == nil {
		t.Fatal("checkpoint limit ignored")
	}
}

func TestDuplicateCopiesOriginalsToIndependentOwnedWorkspace(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	store := testStore(filepath.Join(storage.DataDir, ".projects"))
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.activate("alice", project.Summary); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(storage.DataDir, project.SessionID, "poster.png")
	if err := os.WriteFile(original, []byte("synthetic-original"), 0600); err != nil {
		t.Fatal(err)
	}
	state := json.RawMessage(`{"schemaVersion":1,"timeline":{"channels":[],"textItems":[{"text":"Știință și țară!"}]},"media":[{"id":"photo","name":"poster.png","sourceMode":"proxy"},{"id":"local","name":"local.mp4","sourceMode":"wasm","sourceId":"local-id"}]}`)
	project, err = store.Update("alice", project.ID, project.Name, project.Version, state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Duplicate(context.Background(), "bob", project.ID, "Foreign", project.Version); err == nil {
		t.Fatal("foreign duplicate allowed")
	}
	if _, err := store.Duplicate(context.Background(), "alice", project.ID, "Stale", 1); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	duplicate, err := store.Duplicate(context.Background(), "alice", project.ID, "Film copy", project.Version)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate.SessionID == project.SessionID || string(duplicate.State) != string(state) {
		t.Fatal("duplicate shares original workspace or changed edit")
	}
	copyPath := filepath.Join(storage.DataDir, duplicate.SessionID, "poster.png")
	data, err := os.ReadFile(copyPath)
	if err != nil || string(data) != "synthetic-original" {
		t.Fatalf("copy: %q %v", data, err)
	}
	if err := os.WriteFile(copyPath, []byte("changed copy"), 0600); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(original)
	if err != nil || string(data) != "synthetic-original" {
		t.Fatal("duplicate modified the original", err)
	}
}

func TestProjectCopyRejectsCancellationAndOversizedFiles(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "original")
	if err := os.WriteFile(input, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := copyProjectFile(ctx, input, filepath.Join(dir, "copy"), 100); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := copyProjectFile(context.Background(), input, filepath.Join(dir, "copy"), 1); err == nil {
		t.Fatal("oversized copy accepted")
	}
	if _, err := os.Stat(filepath.Join(dir, "copy")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("partial duplicate was published")
	}
}
