package projects

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/jobqueue"
)

func presentationFixture() PreparedComposition {
	return PreparedComposition{JobID: "render-job", UpdatedAt: time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC),
		Filename: "render_0123456789abcdef0123456789abcdef.mp4", CompositionID: "compiled",
		Document: &document.Document{Version: 1}, Bindings: document.Bindings{"shots": {"image"}},
		Composition: &composition.Composition{ID: "compiled", Duration: 5 * document.Second, Assets: []document.Asset{{ID: "image", File: "poster.png", Kind: "image"}}}}
}

func TestPresentationRetainsExactRenderAcrossRestartAndGeneration(t *testing.T) {
	store := &PresentationStore{Root: t.TempDir()}
	rendered := presentationFixture()
	if err := store.Save("alice", "p_film", rendered); err != nil {
		t.Fatal(err)
	}
	next := rendered
	next.Filename, next.JobID = "", "generation-job"
	next.UpdatedAt = rendered.UpdatedAt.Add(time.Minute)
	next.Composition = &composition.Composition{ID: "new-draft"}
	if err := store.Save("alice", "p_film", next); err != nil {
		t.Fatal(err)
	}
	restarted := &PresentationStore{Root: store.Root}
	saved, err := restarted.Load(context.Background(), "alice", "p_film")
	if err != nil {
		t.Fatal(err)
	}
	if saved.Prepared.Composition.ID != "new-draft" || saved.LastRender.Composition.ID != "compiled" || saved.LastRender.Filename != rendered.Filename {
		t.Fatalf("render replaced by draft: %+v", saved)
	}
	if err := restarted.Save("alice", "p_film", rendered); err != nil {
		t.Fatal(err)
	}
	saved, err = restarted.Load(context.Background(), "alice", "p_film")
	if err != nil || saved.Prepared.Composition.ID != "new-draft" {
		t.Fatalf("older completion replaced new preparation: %+v %v", saved, err)
	}
	foreign, err := restarted.Load(context.Background(), "bob", "p_film")
	if err != nil || foreign.Prepared != nil || foreign.LastRender != nil {
		t.Fatalf("foreign presentation leaked: %+v %v", foreign, err)
	}
	if err := store.Save("../bob", "p_film", rendered); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe owner: %v", err)
	}
	if err := store.Save("alice", "../p_film", rendered); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe session: %v", err)
	}
}

func TestPresentationRetainsFilenameOnlyEditorExportsWithoutInventingRecipe(t *testing.T) {
	store := &PresentationStore{Root: t.TempDir()}
	prepared := presentationFixture()
	if err := store.Save("alice", "p_film", prepared); err != nil {
		t.Fatal(err)
	}
	export := PreparedComposition{Filename: "render_abcdef0123456789abcdef0123456789.mp4", UpdatedAt: prepared.UpdatedAt.Add(time.Minute)}
	if err := store.Save("alice", "p_film", export); err != nil {
		t.Fatal(err)
	}
	saved, err := store.Load(context.Background(), "alice", "p_film")
	if err != nil || saved.LastRender.Filename != export.Filename || saved.LastRender.Composition != nil || saved.Prepared.Composition.ID != "compiled" {
		t.Fatalf("export associated with unrelated recipe: %+v %v", saved, err)
	}
}

type presentationHistory struct {
	jobs  []jobqueue.Job
	reads int
}

func TestPresentationRecoveryOrdersFractionalTimestampsChronologically(t *testing.T) {
	prepared := presentationFixture()
	body, err := json.Marshal(prepared)
	if err != nil {
		t.Fatal(err)
	}
	history := &presentationHistory{jobs: []jobqueue.Job{
		{ID: "older", Owner: "alice", Session: "p_film", Kind: "automation-render", Status: "completed", UpdatedAt: "2026-11-06T12:00:00Z", Result: body},
		{ID: "newer", Owner: "alice", Session: "p_film", Kind: "automation-render", Status: "completed", UpdatedAt: "2026-11-06T12:00:00.1Z", Result: body},
	}}
	saved, err := (&PresentationStore{Root: t.TempDir(), Jobs: history}).Load(context.Background(), "alice", "p_film")
	if err != nil || saved.LastRender == nil || saved.LastRender.JobID != "newer" {
		t.Fatalf("wrong latest render: %+v %v", saved, err)
	}
}

func (h *presentationHistory) List(context.Context, string, string) ([]jobqueue.Job, error) {
	return h.jobs, nil
}

func (h *presentationHistory) Get(_ context.Context, owner, session, id string) (jobqueue.Job, error) {
	h.reads++
	for _, job := range h.jobs {
		if job.ID == id && job.Owner == owner && job.Session == session {
			return job, nil
		}
	}
	return jobqueue.Job{}, jobqueue.ErrNotFound
}

func TestPresentationRecoversCompletedOwnedHistoryWithoutNewWork(t *testing.T) {
	prepared := presentationFixture()
	body, err := json.Marshal(prepared)
	if err != nil {
		t.Fatal(err)
	}
	history := &presentationHistory{jobs: []jobqueue.Job{
		{ID: "other-owner", Owner: "bob", Session: "p_film", Kind: "automation-render", Status: "completed", UpdatedAt: prepared.UpdatedAt.Add(time.Hour).Format(time.RFC3339Nano), Result: body},
		{ID: "failed", Owner: "alice", Session: "p_film", Kind: "automation-render", Status: "failed", UpdatedAt: prepared.UpdatedAt.Add(time.Minute).Format(time.RFC3339Nano), Result: body},
		{ID: "preview", Owner: "alice", Session: "p_film", Kind: "automation-render", Status: "completed", UpdatedAt: prepared.UpdatedAt.Add(time.Second).Format(time.RFC3339Nano), Result: json.RawMessage(`{"filename":"render_preview.mp4","preview":{"start":0,"duration":1}}`)},
		{ID: "completed", Owner: "alice", Session: "p_film", Kind: "automation-render", Status: "completed", UpdatedAt: prepared.UpdatedAt.Format(time.RFC3339Nano), Result: body},
	}}
	store := &PresentationStore{Root: t.TempDir(), Jobs: history}
	saved, err := store.Load(context.Background(), "alice", "p_film")
	if err != nil || saved.LastRender == nil || saved.Prepared == nil || saved.LastRender.JobID != "completed" {
		t.Fatalf("history recovery: %+v %v", saved, err)
	}
	if history.reads != 2 {
		t.Fatalf("read unrelated or failed jobs: %d", history.reads)
	}
	store.Jobs = nil
	saved, err = store.Load(context.Background(), "alice", "p_film")
	if err != nil || saved.LastRender.JobID != "completed" {
		t.Fatalf("recovered JSON not persisted: %+v %v", saved, err)
	}
}
