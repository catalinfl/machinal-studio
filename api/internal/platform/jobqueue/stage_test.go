package jobqueue

import (
	"encoding/json"
	"testing"
	"time"
)

func TestStageTrackerClearsFrameStateAndMeasuresDistinctPhases(t *testing.T) {
	start := time.Unix(100, 0)
	tracker := stageTracker{}
	tracker.update(Update{Snapshot: json.RawMessage(`{"stage":{"name":"capture","scope":"scene","index":6,"completed":480,"total":523}}`)}, start, false)
	video := tracker.update(Update{Message: "rendering video clip 6", Snapshot: json.RawMessage(`{"stage":{"name":"video","scope":"job"}}`)}, start.Add(20*time.Second), false)
	job := Job{Status: "running", Snapshot: video.Snapshot}
	if stage := job.stage(); stage == nil || stage.Name != "video" || stage.Total != 0 || stage.Completed != 0 {
		t.Fatal("stale scene frames survived phase change", stage)
	}
	finished := tracker.update(video, start.Add(time.Minute), true)
	var snapshot struct {
		Stage       *Stage             `json:"stage"`
		Performance performanceSummary `json:"performance"`
	}
	if err := json.Unmarshal(finished.Snapshot, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Stage != nil || snapshot.Performance.ElapsedSeconds != 60 || len(snapshot.Performance.Phases) != 2 || snapshot.Performance.Phases[0].Seconds != 20 || snapshot.Performance.Phases[1].Seconds != 40 {
		t.Fatal(snapshot)
	}
}

func TestTerminalViewsHideLegacyStaleStagesButPreserveResults(t *testing.T) {
	for _, status := range []string{"completed", "failed", "cancelled"} {
		job := Job{Status: status, Snapshot: json.RawMessage(`{"stage":{"name":"capture","completed":480,"total":523},"scenes":[{"id":"saved"}],"performance":{"elapsedSeconds":740}}`)}
		for _, view := range []map[string]any{job.View(), job.Summary()} {
			if view["stage"] != nil || view["timing"] != nil || view["performance"] == nil {
				t.Fatal(status, view)
			}
		}
		if job.View()["scenes"] == nil {
			t.Fatal("unrelated snapshot result was removed")
		}
	}
}

func TestPlainProgressCannotKeepPreviousCaptureEstimate(t *testing.T) {
	tracker := stageTracker{}
	start := time.Unix(100, 0)
	tracker.update(Update{Snapshot: json.RawMessage(`{"stage":{"name":"capture","total":100,"completed":50},"filename":"kept.mp4"}`)}, start, false)
	update := tracker.update(Update{Message: "finalizing MP4"}, start.Add(time.Second), false)
	if stage := (Job{Status: "running", Snapshot: update.Snapshot}).stage(); stage == nil || stage.Name == "capture" || stage.Total != 0 {
		t.Fatal(stage)
	}
	var snapshot map[string]any
	if err := json.Unmarshal(update.Snapshot, &snapshot); err != nil || snapshot["filename"] != "kept.mp4" {
		t.Fatal("ordinary progress lost unrelated snapshot fields", snapshot, err)
	}
}
