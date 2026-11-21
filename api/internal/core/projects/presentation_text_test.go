package projects

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/text"
)

func rasterPresentationFixture() PreparedComposition {
	prepared := editableFixture()
	prepared.Filename = "render_0123456789abcdef0123456789abcdef.mp4"
	prepared.Composition.PreparedText = &text.Prepared{Key: "exact-caption-key", Overlays: []text.Overlay{
		{Start: 1100000, Duration: 1300000, X: 12, Y: 1400, Image: "data:image/png;base64," + strings.Repeat("A", 4<<20)},
	}}
	return prepared
}

func TestProjectPresentationExternalizesBothRasterCopiesWithoutChangingCaptions(t *testing.T) {
	useProjectDataDir(t)
	store := NewStore()
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	prepared := rasterPresentationFixture()
	baseline, _ := json.Marshal(prepared)
	raster, _ := json.Marshal(prepared.Composition.PreparedText)
	if err := store.Presentations.Save("alice", project.SessionID, prepared); err != nil {
		t.Fatal(err)
	}
	updated, err := store.ApplyPrepared("alice", project.SessionID, prepared)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.State) > 32<<10 {
		t.Fatalf("server-prepared state still contains raster payloads: %d", len(updated.State))
	}
	if _, pristine := canPrepareEditorState(updated.State); !pristine {
		t.Fatal("reference-only server state no longer matches its fingerprint")
	}
	for range 2 {
		stream, err := store.openResponse(context.Background(), "alice", project.ID)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(stream)
		stream.Close()
		if err != nil || len(data) > 64<<10 {
			t.Fatalf("project opening transferred duplicate caption images: %d bytes, %v", len(data), err)
		}
		var loaded Project
		if err := json.Unmarshal(data, &loaded); err != nil {
			t.Fatal(err)
		}
		first, last := loaded.Presentation.Prepared, loaded.Presentation.LastRender
		if first.Composition.PreparedText != nil || last.Composition.PreparedText != nil || first.PreparedTextRef == nil || *first.PreparedTextRef != *last.PreparedTextRef {
			t.Fatal("presentation did not reuse one caption cache reference")
		}
		if first.PreparedTextRef.ID != fmt.Sprintf("%x", sha256.Sum256(raster)) {
			t.Fatal("caption raster identity changed")
		}
		path, err := store.textAssetPath("alice", project.ID, *first.PreparedTextRef)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(actual, raster) {
			t.Fatal("retained raster bytes changed", err)
		}
		first.Composition.PreparedText = prepared.Composition.PreparedText
		first.PreparedTextRef = nil
		actual, _ = json.Marshal(first)
		if !bytes.Equal(actual, baseline) {
			t.Fatal("externalizing images changed the document, captions, job IDs or geometry")
		}
	}
	actual, _ := json.Marshal(prepared)
	if !bytes.Equal(actual, baseline) {
		t.Fatal("retention mutated the successful in-memory composition")
	}
}

func TestLegacyPresentationCompactsOnceAndPreservesSavedState(t *testing.T) {
	useProjectDataDir(t)
	store := NewStore()
	project, err := store.Create("alice", "Legacy")
	if err != nil {
		t.Fatal(err)
	}
	prepared := rasterPresentationFixture()
	legacy, _ := json.Marshal(Presentation{Prepared: &prepared, LastRender: &prepared})
	if err := store.Presentations.writeData("alice", project.SessionID, legacy); err != nil {
		t.Fatal(err)
	}
	first, err := store.Presentations.openSnapshot("alice", project.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	firstInfo, _ := first.file.Stat()
	first.file.Close()
	if first.size > 32<<10 {
		t.Fatalf("legacy raster payloads were still sent: %d", first.size)
	}
	second, err := store.Presentations.openSnapshot("alice", project.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	defer second.file.Close()
	secondInfo, _ := second.file.Stat()
	if !os.SameFile(firstInfo, secondInfo) || !firstInfo.ModTime().Equal(secondInfo.ModTime()) {
		t.Fatal("ordinary project opening rewrote the compact presentation again")
	}
	saved, err := store.Get("alice", project.ID)
	if err != nil || saved.Version != project.Version || !bytes.Equal(saved.State, project.State) {
		t.Fatal("presentation migration replaced the editable timeline", err)
	}
}
