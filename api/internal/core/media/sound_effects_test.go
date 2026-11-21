package media

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"ffmpeg-go-server/internal/platform/soundlibrary"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

type fakeSoundLibrary struct {
	sound              soundlibrary.Sound
	lookups, downloads int
}

func (f *fakeSoundLibrary) Search(context.Context, soundlibrary.Search) (soundlibrary.SearchResult, error) {
	return soundlibrary.SearchResult{Sounds: []soundlibrary.Sound{f.sound}}, nil
}
func (f *fakeSoundLibrary) Lookup(context.Context, string) (soundlibrary.Sound, error) {
	f.lookups++
	return f.sound, nil
}
func (f *fakeSoundLibrary) Download(context.Context, soundlibrary.Sound) ([]byte, error) {
	f.downloads++
	return []byte("ID3synthetic audio fixture"), nil
}

func TestSoundHandlerRejectsStaleSourceAndMissingWorkspaceBeforeDownload(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	library := &fakeSoundLibrary{sound: storedSound()}
	handler := &SoundEffects{Library: library}
	app := fiber.New()
	app.Post("/import", handler.Import)
	for _, item := range []struct {
		session, version string
		status           int
	}{
		{"", library.sound.SourceVersion, 401},
		{"37b69c3c-9385-4338-9802-358fa6b50ec3", "sha256:" + strings.Repeat("b", 64), 409},
		{"37b69c3c-9385-4338-9802-358fa6b50ec3", library.sound.SourceVersion, 200},
	} {
		body, _ := json.Marshal(SoundImportRequest{ID: library.sound.ID, SourceVersion: item.version})
		req := httptest.NewRequest(http.MethodPost, "/import", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		if item.session != "" {
			req.Header.Set("X-Session-Id", item.session)
		}
		response, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != item.status {
			t.Fatal(item, response.StatusCode)
		}
	}
	if library.lookups != 2 || library.downloads != 1 {
		t.Fatal("unexpected outbound work", library)
	}
	lock, _ := uploadLocks.LoadOrStore("37b69c3c-9385-4338-9802-358fa6b50ec3", &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()
	body, _ := json.Marshal(SoundImportRequest{ID: library.sound.ID, SourceVersion: library.sound.SourceVersion})
	req := httptest.NewRequest(http.MethodPost, "/import", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Session-Id", "37b69c3c-9385-4338-9802-358fa6b50ec3")
	response, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 429 || response.Header.Get("Retry-After") != "5" || library.downloads != 1 {
		t.Fatal("busy uploads queued audio bodies", response.StatusCode, library.downloads)
	}
}
