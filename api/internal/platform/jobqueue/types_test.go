package jobqueue

import (
	"encoding/json"
	"testing"
)

func TestViewHandlesEmptyPocketBaseJSONFields(t *testing.T) {
	job := Job{ID: "actual-id", Kind: "render", Status: "completed", Snapshot: json.RawMessage("null"),
		Result: json.RawMessage(`{"id":"result-id","filename":"video.mp4","status":"wrong"}`)}
	view := job.View()
	if view["id"] != "actual-id" || view["status"] != "completed" || view["filename"] != "video.mp4" {
		t.Fatal(view)
	}
	if _, exists := view["input"]; exists {
		t.Fatal("private input exposed")
	}
}

func TestSummaryDoesNotExposeLargeSnapshotsOrDuplicateResults(t *testing.T) {
	job := Job{ID: "actual-id", Status: "completed", Snapshot: json.RawMessage(`{"document":{"private":"large"}}`), Result: json.RawMessage(`{"composition":{"tracks":[1,2,3]},"cost":{"status":"pending","knownCredits":15},"summary":"Ready"}`)}
	view := job.Summary()
	for _, field := range []string{"document", "composition", "result", "input", "snapshot"} {
		if _, exists := view[field]; exists {
			t.Fatal("summary exposed", field)
		}
	}
	if view["cost"] == nil || view["summary"] == nil {
		t.Fatal("summary lost costs or outcome", view)
	}
}
