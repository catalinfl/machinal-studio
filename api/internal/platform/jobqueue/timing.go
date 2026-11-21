package jobqueue

import (
	"context"
	"encoding/json"
	"math"
	"time"
)

const timingSampleLimit = 20
const minimumTimingSamples = 3

type timingHistoryRepository interface {
	TimingHistory(context.Context, Job) ([]Job, error)
}

func (s *Service) loadTimingHistory(ctx context.Context, job Job) {
	if !isRenderKind(job.Kind) {
		return
	}
	repository, ok := s.Store.(timingHistoryRepository)
	if !ok {
		return
	}
	s.timingMu.Lock()
	loaded := s.historyLoaded[job.Kind]
	s.historyLoaded[job.Kind] = true
	s.timingMu.Unlock()
	if loaded {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, storeTimeout)
	defer cancel()
	jobs, err := repository.TimingHistory(ctx, job)
	if err != nil {
		s.timingMu.Lock()
		delete(s.historyLoaded, job.Kind)
		s.timingMu.Unlock()
		return
	}
	s.timingMu.Lock()
	defer s.timingMu.Unlock()
	for _, previous := range jobs {
		if previous.ID == job.ID || previous.Kind != job.Kind || previous.Status != "completed" {
			continue
		}
		var snapshot struct {
			Performance performanceSummary `json:"performance"`
		}
		if json.Unmarshal(previous.Snapshot, &snapshot) != nil {
			continue
		}
		seconds := snapshot.Performance.ElapsedSeconds
		if seconds <= 0 || seconds > s.Options.Timeout.Seconds() || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
			continue
		}
		s.durations[job.Kind] = append(s.durations[job.Kind], time.Duration(seconds*float64(time.Second)))
		if len(s.durations[job.Kind]) >= timingSampleLimit {
			break
		}
	}
}

func (s *Service) beginTiming(job Job) {
	s.timingMu.Lock()
	defer s.timingMu.Unlock()
	s.started[job.ID] = time.Now()
}

func (s *Service) endTiming(job Job, successful bool) {
	s.timingMu.Lock()
	defer s.timingMu.Unlock()
	start := s.started[job.ID]
	delete(s.started, job.ID)
	if start.IsZero() || !successful {
		return
	}
	samples := append(s.durations[job.Kind], time.Since(start))
	if len(samples) > timingSampleLimit {
		samples = samples[len(samples)-timingSampleLimit:]
	}
	s.durations[job.Kind] = samples
}

func (s *Service) setInventory(jobs []Job) {
	s.timingMu.Lock()
	defer s.timingMu.Unlock()
	s.inventory = make([]Job, 0, len(jobs))
	for _, job := range jobs {
		s.inventory = append(s.inventory, Job{ID: job.ID, Kind: job.Kind, Status: job.Status, CreatedAt: job.CreatedAt})
	}
}

func (s *Service) describe(job Job, summary bool) map[string]any {
	var view map[string]any
	if summary {
		view = job.Summary()
	} else {
		view = job.View()
	}
	if jobTerminal(job.Status) {
		return view
	}
	s.timingMu.Lock()
	defer s.timingMu.Unlock()
	timing := map[string]any{"approximate": true, "basis": "unknown"}
	timing["sampleCount"] = len(s.durations[job.Kind])
	timing["estimateUnavailableReason"] = "insufficient-history"
	start := s.started[job.ID]
	if !start.IsZero() {
		elapsed := time.Since(start).Seconds()
		timing["elapsedSeconds"] = int(elapsed)
	}
	if stage := job.stage(); stage != nil && stage.Name == "capture" && stage.Completed >= 2 && stage.Completed < stage.Total && stage.ElapsedSeconds > 0 && !math.IsNaN(stage.ElapsedSeconds) && !math.IsInf(stage.ElapsedSeconds, 0) {
		seconds := stage.ElapsedSeconds * float64(stage.Total-stage.Completed) / float64(stage.Completed)
		timing["stageRemainingSeconds"] = int(math.Ceil(min(seconds, s.Options.Timeout.Seconds())))
		timing["stageBasis"] = "scene-frames"
	}
	if timing["basis"] == "unknown" && !start.IsZero() {
		if duration, ok := s.typicalDuration(job.Kind); ok && duration > time.Since(start) {
			timing["remainingSeconds"] = int(math.Ceil((duration - time.Since(start)).Seconds()))
			timing["basis"] = "recent-jobs"
			timing["remainingRangeSeconds"] = s.remainingRange(job.Kind, time.Since(start))
			delete(timing, "estimateUnavailableReason")
		} else if ok {
			timing["estimateUnavailableReason"] = "historical-duration-exceeded"
		}
	}
	if job.Status == "queued" || job.Status == "claimed" {
		ahead, seconds, known := 0, 0.0, true
		for _, active := range s.inventory {
			if active.ID == job.ID || jobTerminal(active.Status) {
				continue
			}
			if active.Status == "queued" && active.CreatedAt > job.CreatedAt {
				continue
			}
			ahead++
			duration, ok := s.typicalDuration(active.Kind)
			known = known && ok
			seconds += duration.Seconds()
		}
		timing["jobsAhead"] = ahead
		if known && ahead > 0 {
			timing["estimatedQueueSeconds"], timing["basis"] = int(math.Ceil(seconds/float64(s.Options.Workers))), "recent-jobs"
			delete(timing, "estimateUnavailableReason")
		} else if ahead == 0 {
			timing["estimatedQueueSeconds"] = 0
		}
	}
	view["timing"] = timing
	return view
}

func (s *Service) remainingRange(kind string, elapsed time.Duration) map[string]int {
	samples := s.durations[kind]
	low, high := samples[0], samples[0]
	for _, duration := range samples[1:] {
		low, high = min(low, duration), max(high, duration)
	}
	return map[string]int{"min": int(math.Ceil(max(0, (low - elapsed).Seconds()))), "max": int(math.Ceil(max(0, (high - elapsed).Seconds())))}
}

func (s *Service) typicalDuration(kind string) (time.Duration, bool) {
	samples := s.durations[kind]
	if len(samples) < minimumTimingSamples {
		return 0, false
	}
	var total time.Duration
	for _, duration := range samples {
		total += duration
	}
	return total / time.Duration(len(samples)), true
}
