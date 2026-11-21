package projects

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func useProjectDataDir(t testing.TB) {
	t.Helper()
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
}

func TestProjectStreamPreservesRawStateAndCaptionsWithoutPreparing(t *testing.T) {
	useProjectDataDir(t)
	store, project := projectWithLargeState(t)
	store.Presentations = &PresentationStore{Root: t.TempDir()}
	prepared := editableFixture()
	if err := store.Presentations.Save("alice", project.SessionID, prepared); err != nil {
		t.Fatal(err)
	}
	stream, err := store.openResponse(context.Background(), "alice", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	data, err := io.ReadAll(stream)
	if err != nil || int64(len(data)) != stream.size || !json.Valid(data) {
		t.Fatalf("invalid streamed project: size=%d expected=%d err=%v", len(data), stream.size, err)
	}
	var result Project
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(result.State, project.State) || result.Version != project.Version {
		t.Fatal("viewing rewrote the timeline, captions or legacy inline scene bytes")
	}
	if result.Presentation == nil || result.Presentation.Prepared == nil {
		t.Fatal("prepared composition missing from stream")
	}
	expected, _ := json.Marshal(prepared.Document.Texts)
	actual, _ := json.Marshal(result.Presentation.Prepared.Document.Texts)
	if !bytes.Equal(expected, actual) {
		t.Fatal("stream changed caption entries")
	}
	saved, err := store.Get("alice", project.ID)
	if err != nil || saved.Version != project.Version || !bytes.Equal(saved.State, project.State) {
		t.Fatal("read-only stream changed persisted state", err)
	}
}

func TestProjectStreamKeepsSnapshotAcrossConcurrentAtomicSave(t *testing.T) {
	useProjectDataDir(t)
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Original")
	if err != nil {
		t.Fatal(err)
	}
	store.Presentations = &PresentationStore{Root: t.TempDir()}
	prepared := presentationFixture()
	if err := store.Presentations.Save("alice", project.SessionID, prepared); err != nil {
		t.Fatal(err)
	}
	stream, err := store.openResponse(context.Background(), "alice", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	updated, err := store.Update("alice", project.ID, "Updated", project.Version, nil)
	if err != nil {
		t.Fatal(err)
	}
	next := presentationFixture()
	next.UpdatedAt = prepared.UpdatedAt.Add(time.Minute)
	next.Composition.ID = "new-preparation"
	if err := store.Presentations.Save("alice", project.SessionID, next); err != nil {
		t.Fatal(err)
	}
	var loaded Project
	if err := json.NewDecoder(stream).Decode(&loaded); err != nil {
		t.Fatal(err)
	}
	if loaded.Name != project.Name || loaded.Version != project.Version || updated.Version == loaded.Version {
		t.Fatal("stream combined two versions of the saved project")
	}
	if loaded.Presentation.Prepared.Composition.ID != prepared.Composition.ID {
		t.Fatal("stream combined two presentation snapshots")
	}
	files := append([]*os.File{}, stream.files...)
	if err := stream.Close(); err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if _, err := file.Stat(); err == nil {
			t.Fatal("response did not close its file")
		}
	}
}

func TestProjectStreamPresentationFailureKeepsSavedTimeline(t *testing.T) {
	useProjectDataDir(t)
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Safe timeline")
	if err != nil {
		t.Fatal(err)
	}
	store.Presentations = &PresentationStore{Root: t.TempDir()}
	path, err := store.Presentations.path("alice", project.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), privateDir); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("[broken]"), 0600); err != nil {
		t.Fatal(err)
	}
	stream, err := store.openResponse(context.Background(), "alice", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	var loaded Project
	if err := json.NewDecoder(stream).Decode(&loaded); err != nil {
		t.Fatal(err)
	}
	if loaded.PresentationWarning == "" || !bytes.Equal(loaded.State, project.State) {
		t.Fatal("unavailable presentation hid or changed saved state")
	}
}

func TestProjectStreamRecoversMissingPresentationWithoutRendering(t *testing.T) {
	useProjectDataDir(t)
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Legacy")
	if err != nil {
		t.Fatal(err)
	}
	prepared := presentationFixture()
	data, err := json.Marshal(prepared)
	if err != nil {
		t.Fatal(err)
	}
	history := &presentationHistory{jobs: []jobqueue.Job{{ID: "completed", Owner: "alice", Session: project.SessionID,
		Kind: "automation-render", Status: "completed", UpdatedAt: prepared.UpdatedAt.Format(time.RFC3339Nano), Result: data}}}
	store.Presentations = &PresentationStore{Root: t.TempDir(), Jobs: history}
	stream, err := store.openResponse(context.Background(), "alice", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	var loaded Project
	if err := json.NewDecoder(stream).Decode(&loaded); err != nil {
		t.Fatal(err)
	}
	if loaded.Presentation.Prepared == nil || loaded.Version != project.Version || history.reads != 1 {
		t.Fatal("history not recovered or project unexpectedly prepared")
	}
}

func TestProjectStreamHTTPRemainsOwnedAndUncached(t *testing.T) {
	useProjectDataDir(t)
	store, project := projectWithLargeState(t)
	app := fiber.New()
	caller := "alice"
	app.Get("/projects/:projectID", func(c *fiber.Ctx) error { c.Locals("pbUserId", caller); return c.Next() }, store.GetHandler)
	response, err := app.Test(httptest.NewRequest("GET", "/projects/"+project.ID, nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" || !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
		t.Fatal("incorrect stream response headers", response.Header)
	}
	if _, err := io.Copy(io.Discard, response.Body); err != nil {
		t.Fatal(err)
	}
	caller = "bob"
	foreign, err := app.Test(httptest.NewRequest("GET", "/projects/"+project.ID, nil))
	if err != nil {
		t.Fatal(err)
	}
	foreign.Body.Close()
	if foreign.StatusCode != 404 {
		t.Fatalf("foreign project streamed: %d", foreign.StatusCode)
	}
}

func TestCompactingSaveOnlyLoadsThePreviousSummary(t *testing.T) {
	store, project := projectWithLargeState(t)
	base, err := store.readForUpdate("alice", project.ID, json.RawMessage(`{"schemaVersion":1}`))
	if err != nil || len(base.State) != 0 || base.Version != project.Version {
		t.Fatal("full-state replacement loaded the old inline scene payload", err)
	}
	state := json.RawMessage(`{"schemaVersion":1,"timeline":{"channels":[]},"media":[]}`)
	saved, err := store.Update("alice", project.ID, project.Name, project.Version, state)
	if err != nil || !bytes.Equal(saved.State, state) {
		t.Fatal("compacting autosave failed", err)
	}
	renamed, err := store.Update("alice", saved.ID, "Renamed", saved.Version, nil)
	if err != nil || !bytes.Equal(renamed.State, state) {
		t.Fatal("metadata-only rename did not preserve the timeline", err)
	}
}

func BenchmarkProjectOpenStream(b *testing.B) {
	for _, payload := range []struct {
		name string
		size int
	}{{"8MiB", 8 << 20}, {"56MiB", 56 << 20}} {
		b.Run(payload.name, func(b *testing.B) {
			useProjectDataDir(b)
			store, project := projectWithStatePayload(b, payload.size)
			b.ReportAllocs()
			b.SetBytes(int64(len(project.State)))
			b.ResetTimer()
			for b.Loop() {
				stream, err := store.openResponse(context.Background(), "alice", project.ID)
				if err != nil {
					b.Fatal(err)
				}
				_, copyErr := io.Copy(io.Discard, stream)
				closeErr := stream.Close()
				if copyErr != nil || closeErr != nil {
					b.Fatal(copyErr, closeErr)
				}
			}
		})
	}
}

func BenchmarkProjectOpenBuffered(b *testing.B) {
	store, project := projectWithLargeState(b)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		loaded, err := store.Get("alice", project.ID)
		if err != nil {
			b.Fatal(err)
		}
		if _, err := json.Marshal(loaded); err != nil {
			b.Fatal(err)
		}
	}
}
