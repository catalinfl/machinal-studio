package ai

import (
	"fmt"
	"math"
)

const (
	// speechBoundaryMargin keeps cuts out of words: a boundary inside a
	// segment minus this margin would clip speech.
	speechBoundaryMargin = 0.15
	// visualCutTolerance matches cuts to detected scene/silence edges within
	// half a second (detector resolution, not frame accuracy).
	visualCutTolerance = 0.5
)

func requestedTrackSet(channelIDs []string) map[string]bool {
	requested := make(map[string]bool, len(channelIDs))
	for _, id := range channelIDs {
		requested[id] = true
	}
	return requested
}

func trackTargeted(track track, requested map[string]bool) bool {
	return !track.Locked && (len(requested) == 0 || requested[track.ID])
}

func validatePlanUsingMediaAnalysis(plan editPlan, project project, analysis projectMediaAnalysis) error {
	if !analysis.Requested || len(plan.Operations) == 0 {
		return nil
	}
	analysisBySource := make(map[string]sourceMediaAnalysis, len(analysis.Sources))
	for _, source := range analysis.Sources {
		analysisBySource[source.SourceID] = source
	}
	targets := clipTargets(project)

	for _, operation := range plan.Operations {
		if err := validateAnalyzedOperation(operation, project, targets, analysisBySource); err != nil {
			return err
		}
	}
	return nil
}

func validateAnalyzedOperation(operation editOperation, project project, targets map[string]clipTarget, analysisBySource map[string]sourceMediaAnalysis) error {
	switch operation.Type {
	case "delete_range":
		return validateAnalyzedDeleteRangeOp(operation, project, analysisBySource)
	case "add_media":
		return validateAnalyzedAddMediaOp(operation, project, analysisBySource)
	case "update_clip":
		return validateAnalyzedUpdateClipOp(operation, project, targets, analysisBySource)
	case "split_clip":
		return validateAnalyzedSplitClipOp(operation, project, targets, analysisBySource)
	case "delete_clip":
		return validateAnalyzedDeleteClipOp(operation, project, targets, analysisBySource)
	case "add_text", "update_text":
		return validateAnalyzedCaptionOp(operation, analysisBySource)
	default:
		// Transitions, presets, effects, transforms and plain titles need
		// only Media Bin metadata, never content analysis.
		return nil
	}
}

// validateAnalyzedCaptionOp blocks hallucinated captions when no transcript
// is available, while letting plain titles through without content.
func validateAnalyzedCaptionOp(operation editOperation, analysisBySource map[string]sourceMediaAnalysis) error {
	if !isCaptionText(operation.TextPresetID, operation.Style) {
		return nil
	}
	for _, source := range analysisBySource {
		if source.Available && source.Audio != nil && len(source.Audio.Transcript) > 0 {
			return nil
		}
	}
	return fmt.Errorf("captions require available transcript analysis")
}

func validateAnalyzedDeleteRangeOp(operation editOperation, project project, analysisBySource map[string]sourceMediaAnalysis) error {
	if operation.Start == nil || operation.End == nil {
		return nil
	}
	if err := validateAnalyzedDeleteTargets(*operation.Start, *operation.End, operation.ChannelIDs, project, analysisBySource); err != nil {
		return err
	}
	for _, boundary := range []float64{*operation.Start, *operation.End} {
		if boundary <= timingEpsilon || math.Abs(project.Duration-boundary) <= timingEpsilon {
			continue
		}
		if err := validateAnalyzedCutBoundary(boundary, operation.ChannelIDs, project, analysisBySource); err != nil {
			return err
		}
	}
	return nil
}

func validateAnalyzedAddMediaOp(operation editOperation, project project, analysisBySource map[string]sourceMediaAnalysis) error {
	source, ok := sourceByID(project.Sources, operation.SourceID)
	if !ok || operation.SourceIn == nil || operation.SourceOut == nil {
		return nil
	}
	return validateSourceWindowBoundaries(source, *operation.SourceIn, *operation.SourceOut, analysisBySource)
}

func validateAnalyzedUpdateClipOp(operation editOperation, project project, targets map[string]clipTarget, analysisBySource map[string]sourceMediaAnalysis) error {
	if operation.InPoint == nil && operation.OutPoint == nil {
		return nil
	}
	target, ok := targets[operation.ClipID]
	if !ok {
		return nil
	}
	source, ok := sourceForAnalysisClip(project, target.Clip)
	if !ok {
		return fmt.Errorf("content-aware update requires an analyzed source for clip %s", operation.ClipID)
	}
	start := target.Clip.SourceIn
	end := target.Clip.SourceOut
	if operation.InPoint != nil {
		start = *operation.InPoint
	}
	if operation.OutPoint != nil {
		end = *operation.OutPoint
	}
	return validateSourceWindowBoundaries(source, start, end, analysisBySource)
}

func validateAnalyzedSplitClipOp(operation editOperation, project project, targets map[string]clipTarget, analysisBySource map[string]sourceMediaAnalysis) error {
	if operation.Time == nil {
		return nil
	}
	target, ok := targets[operation.ClipID]
	if !ok {
		return nil
	}
	source, ok := sourceForAnalysisClip(project, target.Clip)
	if !ok {
		return fmt.Errorf("content-aware split requires an analyzed source for clip %s", operation.ClipID)
	}
	sourceTime := target.Clip.SourceIn + (*operation.Time-target.Clip.Start)*target.Clip.Rate
	return validateSourceBoundary(source, sourceTime, analysisBySource)
}

func validateAnalyzedDeleteClipOp(operation editOperation, project project, targets map[string]clipTarget, analysisBySource map[string]sourceMediaAnalysis) error {
	target, ok := targets[operation.ClipID]
	if !ok {
		return nil
	}
	source, ok := sourceForAnalysisClip(project, target.Clip)
	if !ok {
		return fmt.Errorf("content-aware deletion requires an analyzed source for clip %s", operation.ClipID)
	}
	if sourceAnalysis, ok := analysisBySource[source.ID]; !ok || !sourceAnalysis.Available {
		return fmt.Errorf("content-aware deletion requires available analysis for %s", source.Name)
	}
	return nil
}

func validateAnalyzedDeleteTargets(
	start float64,
	end float64,
	channelIDs []string,
	project project,
	analysisBySource map[string]sourceMediaAnalysis,
) error {
	requestedTracks := requestedTrackSet(channelIDs)
	for _, track := range project.Tracks {
		if !trackTargeted(track, requestedTracks) {
			continue
		}
		for _, clip := range track.Clips {
			if clip.End <= start+timingEpsilon || clip.Start >= end-timingEpsilon {
				continue
			}
			source, ok := sourceForAnalysisClip(project, clip)
			if !ok {
				return fmt.Errorf("content-aware deletion requires an analyzed source for clip %s", clip.ID)
			}
			if sourceAnalysis, ok := analysisBySource[source.ID]; !ok || !sourceAnalysis.Available {
				return fmt.Errorf("content-aware deletion requires available analysis for %s", source.Name)
			}
		}
	}
	return nil
}

func validateSourceWindowBoundaries(
	source mediaSource,
	start float64,
	end float64,
	analysisBySource map[string]sourceMediaAnalysis,
) error {
	// Full-range adds (sourceIn=0, sourceOut=duration) need only Media Bin
	// metadata, never content analysis. Only interior boundaries must align
	// with transcript or visual evidence.
	if start <= timingEpsilon && math.Abs(source.Duration-end) <= timingEpsilon {
		return nil
	}
	sourceAnalysis, ok := analysisBySource[source.ID]
	if !ok || !sourceAnalysis.Available {
		return fmt.Errorf("content-aware edit requires available analysis for %s", source.Name)
	}
	for _, boundary := range []float64{start, end} {
		if err := validateSourceBoundary(source, boundary, analysisBySource); err != nil {
			return err
		}
	}
	return nil
}

func validateSourceBoundary(source mediaSource, boundary float64, analysisBySource map[string]sourceMediaAnalysis) error {
	if boundary <= timingEpsilon || math.Abs(source.Duration-boundary) <= timingEpsilon {
		return nil
	}
	sourceAnalysis, ok := analysisBySource[source.ID]
	if !ok || !sourceAnalysis.Available {
		return fmt.Errorf("content-aware edit requires available analysis for %s", source.Name)
	}
	if boundary > sourceAnalysis.AnalyzedDuration+timingEpsilon {
		return fmt.Errorf("content-aware source boundary %.3fs for %s is outside the analyzed interval", boundary, source.Name)
	}
	if sourceAnalysis.Audio != nil {
		transcript := sourceAnalysis.Audio.Transcript
		for _, segment := range transcript {
			if boundary > segment.Start+speechBoundaryMargin && boundary < segment.End-speechBoundaryMargin {
				return fmt.Errorf(
					"content-aware source boundary %.3fs falls inside the %.3f-%.3fs transcript segment for %s",
					boundary,
					segment.Start,
					segment.End,
					source.Name,
				)
			}
		}
		if sourceAnalysis.Audio.TranscriptComplete {
			return nil
		}
		if len(transcript) > 0 && boundary <= transcript[len(transcript)-1].End+speechBoundaryMargin {
			return nil
		}
	}
	if cutMatchesVisualBoundary(boundary, sourceAnalysis) {
		return nil
	}
	if source.Kind == mediaKindImage {
		return nil
	}
	return fmt.Errorf("content-aware source boundary %.3fs for %s lacks a complete transcript or detected visual boundary", boundary, source.Name)
}

func validateAnalyzedCutBoundary(
	timelineTime float64,
	channelIDs []string,
	project project,
	analysisBySource map[string]sourceMediaAnalysis,
) error {
	requestedTracks := requestedTrackSet(channelIDs)

	for _, track := range project.Tracks {
		if !trackTargeted(track, requestedTracks) {
			continue
		}
		for _, clip := range track.Clips {
			if timelineTime <= clip.Start+timingEpsilon || timelineTime >= clip.End-timingEpsilon {
				continue
			}
			source, ok := sourceForAnalysisClip(project, clip)
			if !ok {
				return fmt.Errorf("content-aware cut requires an analyzed source for clip %s", clip.ID)
			}
			sourceAnalysis, ok := analysisBySource[source.ID]
			if !ok || !sourceAnalysis.Available {
				return fmt.Errorf("content-aware cut requires available analysis for %s", source.Name)
			}
			sourceTime := clip.SourceIn + (timelineTime-clip.Start)*clip.Rate
			if err := validateSourceBoundary(source, sourceTime, analysisBySource); err != nil {
				return fmt.Errorf("content-aware cut at %.3fs is not aligned: %w", timelineTime, err)
			}
		}
	}
	return nil
}

func cutMatchesVisualBoundary(sourceTime float64, analysis sourceMediaAnalysis) bool {
	for _, scene := range analysis.Scenes {
		if math.Abs(sourceTime-scene.Start) <= visualCutTolerance || math.Abs(sourceTime-scene.End) <= visualCutTolerance {
			return true
		}
	}
	for _, ranges := range [][]analysisTimeRange{analysis.BlackRanges, analysis.FreezeRanges} {
		for _, item := range ranges {
			if math.Abs(sourceTime-item.Start) <= visualCutTolerance || math.Abs(sourceTime-item.End) <= visualCutTolerance {
				return true
			}
		}
	}
	if analysis.Audio != nil {
		for _, silence := range analysis.Audio.Silences {
			if math.Abs(sourceTime-silence.Start) <= visualCutTolerance || math.Abs(sourceTime-silence.End) <= visualCutTolerance {
				return true
			}
		}
	}
	return false
}
