package projects

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

func testStore(root string) *Store {
	return &Store{Root: root, Now: time.Now, Session: func(owner, id string) string {
		if id == "default" {
			return "u_" + owner
		}
		return id
	}}
}

func TestProjectsSurviveRestartAndRemainOwned(t *testing.T) {
	root := t.TempDir()
	store := testStore(root)
	initial, err := store.EnsureInitial("alice")
	if err != nil || len(initial) != 1 || initial[0].SessionID != "u_alice" {
		t.Fatalf("migration: %+v %v", initial, err)
	}
	project, err := store.Create("alice", "  My film  ")
	if err != nil {
		t.Fatal(err)
	}
	if project.SessionID == initial[0].SessionID || project.Name != "My film" {
		t.Fatalf("new project: %+v", project)
	}
	state := json.RawMessage(`{"schemaVersion":1,"timeline":{"channels":[]},"media":[]}`)
	saved, err := store.Update("alice", project.ID, "My film", project.Version, state)
	if err != nil {
		t.Fatal(err)
	}
	restarted := testStore(root)
	restored, err := restarted.Get("alice", project.ID)
	if err != nil || string(restored.State) != string(state) || restored.Version != saved.Version {
		t.Fatalf("restored: %+v %v", restored, err)
	}
	if _, err := restarted.Get("bob", project.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign project: %v", err)
	}
	if _, err := restarted.Get("alice", "../bob"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("traversal: %v", err)
	}
	items, err := restarted.EnsureInitial("alice")
	if err != nil || len(items) != 2 {
		t.Fatalf("duplicate migration: %+v %v", items, err)
	}
}

func TestConcurrentSavesNeverOverwriteNewerProject(t *testing.T) {
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	results := make(chan error, 2)
	for _, name := range []string{"One", "Two"} {
		wait.Add(1)
		go func(name string) {
			defer wait.Done()
			_, err := testStore(store.Root).Update("alice", project.ID, name, 1, nil)
			results <- err
		}(name)
	}
	wait.Wait()
	close(results)
	success, conflicts := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflicts=%d", success, conflicts)
	}
}
