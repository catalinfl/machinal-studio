package compiler

import (
	"fmt"
	"reflect"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/catalog"
	"ffmpeg-go-server/editengine/document"
)

func (s *compilation) verify(allowEmpty bool) {
	seen := make(map[string]bool)
	identity := func(id, path string) {
		if id == "" || seen[id] {
			s.fail(path, "duplicate_id", "all element ids must be nonempty and unique")
		}
		seen[id] = true
	}
	clips := 0
	for trackIndex := range s.composition.Tracks {
		track := &s.composition.Tracks[trackIndex]
		path := fmt.Sprintf("tracks[%d]", trackIndex)
		identity(track.ID, path+".id")
		if track.Type != "video" && track.Type != "audio" {
			s.fail(path+".type", "invalid_track", "track must be video or audio")
		}
		slices.SortStableFunc(track.Clips, func(a, b document.Clip) int {
			if a.Start < b.Start {
				return -1
			}
			if a.Start > b.Start {
				return 1
			}
			return 0
		})
		for clipIndex, clip := range track.Clips {
			clipPath := fmt.Sprintf("%s.clips[%d]", path, clipIndex)
			identity(clip.ID, clipPath+".id")
			s.verifyClip(*track, clip, track.Type, clipPath)
			clips++
		}
		s.verifyOverlaps(*track, path)
	}
	if clips > MaxClips {
		s.fail("tracks", "limit", fmt.Sprintf("at most %d expanded clips", MaxClips))
	}
	if s.composition.Duration < 0 || s.composition.Duration > document.MaxTime || s.composition.Duration == 0 && !allowEmpty {
		s.fail("duration", "invalid_duration", "composition duration must be positive and at most 24 hours")
	}
	for index, effect := range s.composition.Effects {
		path := fmt.Sprintf("effects[%d]", index)
		identity(effect.ID, path+".id")
		s.verifyEffect(effect, path)
	}
	for index, transition := range s.composition.Transitions {
		path := fmt.Sprintf("transitions[%d]", index)
		identity(transition.ID, path+".id")
		s.verifyTransition(transition, path)
	}
	if len(s.composition.TextItems) > MaxTextItems {
		s.fail("texts", "limit", fmt.Sprintf("at most %d text items", MaxTextItems))
	}
	for index, item := range s.composition.TextItems {
		path := fmt.Sprintf("texts[%d]", index)
		identity(item.ID, path+".id")
		s.verifyText(item, path)
	}
	s.verifyLockedTracks()
}

func (s *compilation) verifyClip(track document.Track, clip document.Clip, trackType, path string) {
	asset, exists := s.assets[clip.AssetID]
	if !exists {
		s.fail(path+".assetId", "unknown_asset", "clip asset is missing")
		return
	}
	if trackType == "video" && asset.Kind == "audio" || trackType == "audio" && (asset.Kind == "image" || asset.Kind == "video" && !asset.HasAudio) {
		message := "media cannot be used on this track"
		if trackType == "audio" && asset.Kind == "video" && !asset.HasAudio {
			message = "video has no audio stream; remove its audio clips and linkedClipId references or use a source with audio"
		}
		s.fail(path+".assetId", "incompatible_media", message)
	}
	if !catalog.FiniteRange(clip.PlaybackRate, 0.25, 4) {
		s.fail(path+".playbackRate", "invalid_rate", "rate must be 0.25–4")
	}
	if !catalog.FiniteRange(clip.Volume, 0, 200) {
		s.fail(path+".volume", "invalid_volume", "volume must be 0–200 percent")
	}
	if clip.Start < 0 || clip.InPoint < 0 || clip.OutPoint <= clip.InPoint || clip.Duration() < MinimumClipDuration {
		s.fail(path, "invalid_interval", "clip needs nonnegative times and at least 100ms of timeline duration")
	}
	if asset.Kind != "image" && clip.OutPoint > asset.Duration {
		s.fail(path+".outPoint", "source_bounds", "source interval exceeds asset duration")
	}
	if trackType == "audio" && asset.Kind == "audio" && asset.Duration > 0 && clip.Volume > 0 && s.isNarrationClip(track, clip, asset) {
		if missing := asset.Duration - clip.OutPoint; missing > document.Seconds(0.15) {
			s.result.Diagnostics = append(s.result.Diagnostics, document.Diagnostic{
				Path:     path + ".outPoint",
				Code:     "narration_truncated",
				Severity: "warning",
				Message:  fmt.Sprintf("narration clip %q ends at %.2fs, truncating %.2fs of %s (%.2fs); extend outPoint and video timeline to cover full speech", clip.ID, clip.OutPoint.Seconds(), missing.Seconds(), asset.File, asset.Duration.Seconds()),
			})
		}
	}
	if !catalog.FiniteRange(clip.Opacity, 0, 1) || clip.FadeIn < 0 || clip.FadeOut < 0 || clip.FadeIn > clip.Duration() || clip.FadeOut > clip.Duration() {
		s.fail(path, "invalid_compositing", "opacity must be 0–1 and fades must fit the clip")
	}
	if clip.LinkedClipID != "" {
		_, linked := s.findClip(clip.LinkedClipID)
		if linked == nil || linked.LinkedClipID != clip.ID || linked.Start != clip.Start || linked.PlaybackRate != clip.PlaybackRate ||
			!s.sceneNarrationPair(clip, *linked) && (linked.InPoint != clip.InPoint || linked.OutPoint != clip.OutPoint) {
			s.fail(path+".linkedClipId", "broken_link", "linked media must be reciprocal and aligned")
		}
	}
	s.verifyTransform(clip.Transform, path+".transform")
	if trackType == "video" && clip.Opacity >= 1 && transformExposesBlackBars(clip.Transform) {
		s.result.Diagnostics = append(s.result.Diagnostics, document.Diagnostic{
			Path:     path + ".transform",
			Code:     "transform_exposes_black_bars",
			Severity: "warning",
			Message:  "transform pan exceeds the edge-safe margin of its zoom (positionX/positionY are percentages -100..100, not pixels; keep |pos| <= 50*(zoom-1) or use a motion preset)",
		})
	}
	last := document.Time(-1)
	for index, frame := range clip.TransformKeyframes {
		framePath := fmt.Sprintf("%s.transformKeyframes[%d]", path, index)
		if frame.Time < 0 || frame.Time > clip.Duration() || frame.Time <= last {
			s.fail(framePath+".time", "invalid_keyframe", "keyframes must be strictly ordered within the clip")
		}
		s.verifyTransform(frame.Transform, framePath+".transform")
		if trackType == "video" && clip.Opacity >= 1 && transformExposesBlackBars(frame.Transform) {
			s.result.Diagnostics = append(s.result.Diagnostics, document.Diagnostic{
				Path:     framePath + ".transform",
				Code:     "transform_exposes_black_bars",
				Severity: "warning",
				Message:  "keyframe pan exceeds the edge-safe margin of its zoom (positionX/positionY are percentages -100..100, not pixels; keep |pos| <= 50*(zoom-1) or use a motion preset)",
			})
		}
		last = frame.Time
	}
}

func (s *compilation) isNarrationClip(track document.Track, clip document.Clip, asset document.Asset) bool {
	if strings.HasPrefix(asset.File, "voice_") || track.ID == "recipe/audio/narration" || strings.Contains(strings.ToLower(track.Name+" "+track.ID), "narration") {
		return true
	}
	for _, jobs := range [][]document.Job{s.input.Document.Jobs, s.input.Document.Before} {
		for _, job := range jobs {
			if job.Type == "speech.generate" && job.ResultAssetID != "" && (job.ResultAssetID == clip.AssetID || job.ResultAssetID == asset.File) {
				return true
			}
		}
	}
	return false
}

func transformExposesBlackBars(t document.Transform) bool {
	if t.ZoomX < 1 || t.ZoomY < 1 || t.Rotation != 0 || t.Pitch != 0 || t.Yaw != 0 {
		return false
	}
	if t.PositionX == 0 && t.PositionY == 0 {
		return false
	}
	// Off-screen slides (>= 50%) are intentional overlays/transitions rather than camera pans.
	if t.PositionX <= -50 || t.PositionX >= 50 || t.PositionY <= -50 || t.PositionY >= 50 {
		return false
	}
	minX, maxX := (0.5-(1-t.AnchorX)*t.ZoomX)*100, (t.AnchorX*t.ZoomX-0.5)*100
	minY, maxY := (0.5-(1-t.AnchorY)*t.ZoomY)*100, (t.AnchorY*t.ZoomY-0.5)*100
	const eps = 0.05
	return t.PositionX < minX-eps || t.PositionX > maxX+eps || t.PositionY < minY-eps || t.PositionY > maxY+eps
}

func (s *compilation) sceneNarrationPair(left, right document.Clip) bool {
	a, b := s.assets[left.AssetID], s.assets[right.AssetID]
	return strings.HasSuffix(a.File, ".scene.json") && b.Kind == "audio" || strings.HasSuffix(b.File, ".scene.json") && a.Kind == "audio"
}

func (s *compilation) verifyTransform(transform document.Transform, path string) {
	for name, value := range map[string]struct{ value, min, max float64 }{
		"zoomX": {transform.ZoomX, 0.01, 40}, "zoomY": {transform.ZoomY, 0.01, 40},
		"positionX": {transform.PositionX, -100, 100}, "positionY": {transform.PositionY, -100, 100},
		"rotation": {transform.Rotation, -180, 180}, "anchorX": {transform.AnchorX, 0, 1}, "anchorY": {transform.AnchorY, 0, 1},
		"pitch": {transform.Pitch, -90, 90}, "yaw": {transform.Yaw, -90, 90},
	} {
		if !catalog.FiniteRange(value.value, value.min, value.max) {
			s.fail(path+"."+name, "invalid_transform", fmt.Sprintf("must be %g–%g", value.min, value.max))
		}
	}
	if transform.LinkZoom && transform.ZoomX != transform.ZoomY {
		s.fail(path, "linked_zoom", "linked zoom axes must agree")
	}
}

func (s *compilation) verifyOverlaps(track document.Track, path string) {
	for index := 1; index < len(track.Clips); index++ {
		left, right := track.Clips[index-1], track.Clips[index]
		overlap := left.End() - right.Start
		if overlap <= 0 {
			continue
		}
		if overlap < MinimumTransitionDuration || overlap > s.maxOverlap(left, right) {
			s.fail(path, "collision", "overlap is outside the supported transition interval")
			continue
		}
		if index > 1 && track.Clips[index-2].End() > right.Start {
			s.fail(path, "triple_overlap", "three clips cannot overlap on one track")
		}
		if track.Type == "audio" {
			continue
		}
		if !slices.ContainsFunc(s.composition.Transitions, func(t document.Transition) bool { return t.LeftClipID == left.ID && t.RightClipID == right.ID }) {
			s.composition.Transitions = append(s.composition.Transitions, document.Transition{ID: left.ID + "/to/" + right.ID,
				TrackID: track.ID, LeftClipID: left.ID, RightClipID: right.ID, Preset: "cross-dissolve", Duration: overlap})
		}
	}
}

func (s *compilation) verifyTransition(transition document.Transition, path string) {
	if _, ok := s.compiler.Catalog.Transition(transition.Preset); !ok {
		s.fail(path+".preset", "unknown_preset", "unknown transition")
	}
	leftTrack, left := s.findClip(transition.LeftClipID)
	rightTrack, right := s.findClip(transition.RightClipID)
	if left == nil || right == nil || leftTrack.ID != transition.TrackID || rightTrack.ID != transition.TrackID || leftTrack.Type != "video" {
		s.fail(path, "invalid_pair", "transition requires two clips on the same video track")
		return
	}
	leftIndex := slices.IndexFunc(leftTrack.Clips, func(clip document.Clip) bool { return clip.ID == left.ID })
	if leftIndex+1 >= len(leftTrack.Clips) || leftTrack.Clips[leftIndex+1].ID != right.ID {
		s.fail(path, "invalid_pair", "transition clips must be adjacent")
	}
	overlap, maximum := left.End()-right.Start, s.maxOverlap(*left, *right)
	if transition.Duration < MinimumTransitionDuration || transition.Duration != overlap || transition.Duration > maximum {
		s.fail(path+".duration", "invalid_overlap", fmt.Sprintf(
			"transition duration %gs must exactly match timeline overlap %gs between %q (end %gs) and %q (start %gs), within %gs–%gs; end = start + (outPoint - inPoint) / playbackRate; outPoint is a source time, not the timeline end",
			transition.Duration.Seconds(), overlap.Seconds(), left.ID, left.End().Seconds(), right.ID, right.Start.Seconds(),
			MinimumTransitionDuration.Seconds(), maximum.Seconds()))
	}
	count := 0
	for _, other := range s.composition.Transitions {
		if other.LeftClipID == left.ID && other.RightClipID == right.ID {
			count++
		}
	}
	if count > 1 {
		s.fail(path, "duplicate_transition", "only one transition is allowed per pair")
	}
}

func (s *compilation) verifyEffect(effect document.EffectBlock, path string) {
	if _, err := s.compiler.Catalog.ResolveEffect(effect.Preset, effect.Params, effect.Ramp); err != nil {
		s.fail(path, "invalid_effect", err.Error())
	}
	trackIndex := slices.IndexFunc(s.composition.Tracks, func(track document.Track) bool { return track.ID == effect.TrackID && track.Type == "video" })
	if trackIndex < 0 {
		s.fail(path+".trackId", "invalid_track", "effect requires a video track")
	}
	if effect.Start < 0 || effect.Duration <= 0 || effect.Start+effect.Duration > s.composition.Duration {
		s.fail(path, "effect_interval", "effect interval must fit the composition")
	}
	if effect.OwnerClipID != "" {
		track, clip := s.findClip(effect.OwnerClipID)
		if clip == nil || track.ID != effect.TrackID || effect.Start < clip.Start || effect.Start+effect.Duration > clip.End() {
			s.fail(path+".ownerClipId", "effect_anchor", "attached effect must fit its owner clip")
		}
	}
}

func (s *compilation) verifyLockedTracks() {
	if s.input.Snapshot == nil {
		return
	}
	for _, before := range s.input.Snapshot.Tracks {
		if !before.Locked {
			continue
		}
		index := slices.IndexFunc(s.composition.Tracks, func(track document.Track) bool { return track.ID == before.ID })
		if index < 0 {
			s.fail("tracks."+before.ID, "locked_track", "cannot remove a locked track")
			continue
		}
		after := s.composition.Tracks[index]
		if before.Locked != after.Locked && !slices.ContainsFunc(s.input.Document.Commands, func(command document.Command) bool {
			return command.Type == "track.lock" && command.Value != nil && !*command.Value && slices.Contains(s.resolveSelector(command.Target), before.ID)
		}) {
			s.fail("tracks."+before.ID, "locked_track", "unlock a locked track explicitly before editing it")
		}
		after.Locked = before.Locked
		if !reflect.DeepEqual(before, after) {
			s.fail("tracks."+before.ID, "locked_track", "cannot modify locked track contents")
		}
		beforeEffects := []document.EffectBlock{}
		afterEffects := []document.EffectBlock{}
		for _, block := range s.input.Snapshot.Effects {
			if block.TrackID == before.ID {
				beforeEffects = append(beforeEffects, block)
			}
		}
		for _, block := range s.composition.Effects {
			if block.TrackID == before.ID {
				afterEffects = append(afterEffects, block)
			}
		}
		if !reflect.DeepEqual(beforeEffects, afterEffects) {
			s.fail("effects", "locked_track", "cannot modify effects on locked tracks")
		}
	}
}
