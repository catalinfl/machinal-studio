package jobqueue

import (
	"context"
	"encoding/json"
	"time"
)

type Stage struct {
	Name           string  `json:"name"`
	Scope          string  `json:"scope,omitempty"`
	Index          int     `json:"index,omitempty"`
	Count          int     `json:"count,omitempty"`
	Completed      int     `json:"completed,omitempty"`
	Total          int     `json:"total,omitempty"`
	ElapsedSeconds float64 `json:"elapsedSeconds,omitempty"`
}

func ReportStage(ctx context.Context, progress float64, message string, stage Stage) bool {
	report, ok := ctx.Value(reporterKey{}).(func(Update))
	if !ok {
		return false
	}
	snapshot, err := json.Marshal(struct {
		Stage Stage `json:"stage"`
	}{stage})
	if err != nil {
		return false
	}
	report(Update{Progress: progress, Message: message, Snapshot: snapshot})
	return true
}

func (j Job) stage() *Stage {
	if jobTerminal(j.Status) {
		return nil
	}
	var snapshot struct {
		Stage *Stage `json:"stage"`
	}
	if json.Unmarshal(j.Snapshot, &snapshot) != nil {
		return nil
	}
	return snapshot.Stage
}

const maxStageTimings = 64

func isRenderKind(kind string) bool {
	return kind == "automation-render" || kind == "render" || kind == "editor-render"
}

type stageTiming struct {
	Name    string  `json:"name"`
	Scope   string  `json:"scope,omitempty"`
	Index   int     `json:"index,omitempty"`
	Seconds float64 `json:"seconds"`
}

type performanceSummary struct {
	ElapsedSeconds float64       `json:"elapsedSeconds"`
	Phases         []stageTiming `json:"phases"`
	CacheHits      int           `json:"cacheHits"`
	CacheMisses    int           `json:"cacheMisses"`
	Truncated      bool          `json:"truncated"`
}

type stageTracker struct {
	started time.Time
	changed time.Time
	current *Stage
	summary performanceSummary
	fields  map[string]json.RawMessage
}

func (tracker *stageTracker) update(update Update, now time.Time, terminal bool) Update {
	fields, next := tracker.snapshotFields(update.Snapshot)
	if terminal {
		next = nil
	} else if next == nil {
		next = &Stage{Name: "processing", Scope: "job"}
	}
	if tracker.started.IsZero() {
		tracker.started, tracker.changed = now, now
	}
	if !sameStage(tracker.current, next) {
		tracker.finishPhase(now)
		tracker.changed = now
		if next != nil && next.Name == "cache-hit" {
			tracker.summary.CacheHits++
		}
		if next != nil && next.Name == "cache-miss" {
			tracker.summary.CacheMisses++
		}
	}
	tracker.current = next
	summary := tracker.summary
	summary.Phases = append([]stageTiming(nil), tracker.summary.Phases...)
	if next != nil && len(summary.Phases) < maxStageTimings {
		summary.Phases = append(summary.Phases, phaseTiming(*next, now.Sub(tracker.changed)))
	} else if next != nil {
		summary.Truncated = true
	}
	summary.ElapsedSeconds = now.Sub(tracker.started).Seconds()
	fields["stage"], _ = json.Marshal(next)
	fields["performance"], _ = json.Marshal(summary)
	update.Snapshot, _ = json.Marshal(fields)
	return update
}

func (tracker *stageTracker) snapshotFields(snapshot json.RawMessage) (map[string]json.RawMessage, *Stage) {
	var incoming map[string]json.RawMessage
	if err := json.Unmarshal(snapshot, &incoming); err != nil {
		incoming = nil
	}
	var stage *Stage
	if err := json.Unmarshal(incoming["stage"], &stage); err != nil {
		stage = nil
	}
	if tracker.fields == nil {
		tracker.fields = make(map[string]json.RawMessage)
	}
	for key, value := range incoming {
		tracker.fields[key] = value
	}
	return tracker.fields, stage
}

func sameStage(left, right *Stage) bool {
	return left == nil && right == nil || left != nil && right != nil && left.Name == right.Name && left.Scope == right.Scope && left.Index == right.Index
}

func phaseTiming(stage Stage, elapsed time.Duration) stageTiming {
	return stageTiming{Name: stage.Name, Scope: stage.Scope, Index: stage.Index, Seconds: elapsed.Seconds()}
}

func (tracker *stageTracker) finishPhase(now time.Time) {
	if tracker.current == nil {
		return
	}
	if len(tracker.summary.Phases) >= maxStageTimings {
		tracker.summary.Truncated = true
		return
	}
	tracker.summary.Phases = append(tracker.summary.Phases, phaseTiming(*tracker.current, now.Sub(tracker.changed)))
}
