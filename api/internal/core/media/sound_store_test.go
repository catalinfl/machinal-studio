package media

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/soundlibrary"
)

func storedSound() soundlibrary.Sound {
	return soundlibrary.Sound{ID: "3849018d-0ac8-4f6b-b44d-5ec26a4b32af", Title: "Test click", Creator: "Test author", License: "cc0", Filetype: "mp3", SourceVersion: "sha256:" + strings.Repeat("a", 64), Importable: true, Attribution: "Test author, CC0", Duration: 1}
}

func TestSoundImportPersistsAttributionAndReusesWithoutOverwrite(t *testing.T) {
	root := t.TempDir()
	body := []byte("ID3synthetic audio fixture")
	sound := storedSound()
	first, err := storeSound(context.Background(), root, "", sound, body)
	if err != nil || first.Reused || first.Storage != "volume" || first.AudioVerified {
		t.Fatal(first, err)
	}
	second, err := storeSound(context.Background(), root, "", sound, body)
	if err != nil || !second.Reused || first.File != second.File {
		t.Fatal(second, err)
	}
	metadata, err := os.ReadFile(filepath.Join(root, first.ProvenanceFile))
	if err != nil || !strings.Contains(string(metadata), sound.Attribution) {
		t.Fatal("missing persisted attribution", err)
	}
	var receipt soundImportResult
	if err := json.Unmarshal(metadata, &receipt); err != nil || receipt.Sound.SourceVersion != sound.SourceVersion {
		t.Fatal("invalid provenance", err)
	}
	if err := os.WriteFile(filepath.Join(root, first.File), []byte("original user data"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := storeSound(context.Background(), root, "", sound, body); err == nil {
		t.Fatal("overwrote conflicting existing file")
	}
	actual, _ := os.ReadFile(filepath.Join(root, first.File))
	if string(actual) != "original user data" {
		t.Fatal("existing file changed")
	}
}

func TestSoundImportRejectsInvalidContentVersionsAndCancelledWrites(t *testing.T) {
	for _, mutate := range []func(*soundlibrary.Sound){func(s *soundlibrary.Sound) { s.ID = "../escape" }, func(s *soundlibrary.Sound) { s.SourceVersion = "old" }, func(s *soundlibrary.Sound) { s.Filetype = "../json" }, func(s *soundlibrary.Sound) { s.License = "by-nc" }, func(s *soundlibrary.Sound) { s.Importable = false }} {
		sound := storedSound()
		mutate(&sound)
		if _, err := storeSound(context.Background(), t.TempDir(), "", sound, []byte("ID3synthetic audio")); err == nil {
			t.Fatal("accepted unsafe sound", sound)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	root := t.TempDir()
	if _, err := storeSound(ctx, root, "", storedSound(), []byte("ID3synthetic audio")); err == nil {
		t.Fatal("published cancelled import")
	}
	files, _ := os.ReadDir(root)
	if len(files) != 0 {
		t.Fatal("cancelled import left final files", files)
	}
}
