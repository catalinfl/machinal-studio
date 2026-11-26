package compiler

import (
	"encoding/json"
	"fmt"
	"slices"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

func (s *compilation) plan() {
	data, err := json.Marshal(s.input.Document)
	if err != nil {
		s.fail("document", "invalid_document", err.Error())
		return
	}
	var doc document.Document
	if err := json.Unmarshal(data, &doc); err != nil {
		s.fail("document", "invalid_document", err.Error())
		return
	}
	for index := range doc.Texts {
		doc.Texts[index].Explicit = s.input.Document.Texts[index].Explicit
	}
	s.composition = composition.Composition{CatalogVersion: doc.CatalogVersion, CompilerVersion: Version,
		Assets: s.input.Assets, Output: doc.Output, Tracks: doc.Tracks, Effects: doc.Effects,
		Transitions: doc.Transitions, TextItems: doc.Texts, Segments: make(map[string][]composition.Segment)}
	if doc.Mode == "modify" {
		snapshot := s.input.Snapshot
		s.composition.TextItems = nil
		s.composition.Tracks = snapshot.Tracks
		s.composition.Effects = append(snapshot.Effects, doc.Effects...)
		s.composition.Transitions = append(snapshot.Transitions, doc.Transitions...)
		generated := make(map[string]bool)
		for _, item := range doc.Texts {
			generated[item.ID] = true
		}
		for _, job := range doc.After {
			for _, id := range job.ResultTextIDs {
				generated[id] = true
			}
		}
		for _, item := range snapshot.TextItems {
			if !generated[item.ID] {
				s.composition.TextItems = append(s.composition.TextItems, item)
			}
		}
		s.composition.TextItems = append(s.composition.TextItems, doc.Texts...)
	}
	if doc.Sequence != nil {
		s.assemble(*doc.Sequence)
	}
	s.applyMontage()
	if s.hasErrors() {
		return
	}
	for _, override := range doc.Overrides {
		s.applyOverride(override, "overrides")
	}
	s.resolveOmittedClipOutPoints()
	s.applyCommands()
	s.applyRules()
	s.expandTreatments()
	s.computeDuration()
	s.addAudio()
	s.placeJobResults()
	s.placeGenerated()
	s.materializeTexts()
	s.computeDuration()
	for index := range s.composition.Effects {
		block := &s.composition.Effects[index]
		params, err := s.compiler.Catalog.ResolveEffect(block.Preset, block.Params, block.Ramp)
		if err != nil {
			s.fail("effects."+block.ID, "invalid_effect", err.Error())
			continue
		}
		block.Params = params
	}
	s.flattenEffects()
}

func (s *compilation) assemble(sequence document.Sequence) {
	doc := s.input.Document
	ids := slices.Clone(s.input.Bindings[sequence.Use])
	if sequence.Order == "reverse" {
		slices.Reverse(ids)
	}
	video := document.Track{ID: doc.InstanceID + "/video", Name: "Sequence", Type: "video", Clips: []document.Clip{}}
	audio := document.Track{ID: doc.InstanceID + "/source-audio", Name: "Source audio", Type: "audio", Clips: []document.Clip{}}
	occurrences := make(map[string]int)
	for _, id := range ids {
		asset := s.assets[id]
		occurrences[id]++
		clipID := fmt.Sprintf("%s/%s/%s/%d", doc.InstanceID, sequence.Use, id, occurrences[id])
		moving := sequenceClip(clipID, asset, sequence.Each)
		moving.Provenance = &document.Provenance{InstanceID: doc.InstanceID, Rule: "sequence:" + sequence.Use}
		// Duration overrides participate before adjacency and overlaps are planned.
		for _, override := range doc.Overrides {
			if override.Target == clipID {
				patchClip(&moving, override)
			}
		}
		if len(video.Clips) > 0 {
			previous := video.Clips[len(video.Clips)-1]
			moving.Start = previous.End()
			if sequence.Between != nil {
				overlap := s.sequenceOverlap(previous, moving, *sequence.Between)
				moving.Start -= overlap
				s.composition.Transitions = append(s.composition.Transitions, document.Transition{
					ID: previous.ID + "/to/" + moving.ID, TrackID: video.ID, LeftClipID: previous.ID,
					RightClipID: moving.ID, Preset: sequence.Between.Preset, Duration: overlap})
			}
		}
		if sequence.Each.SourceAudio == "keep" && asset.Kind == "video" && asset.HasAudio {
			linked := moving
			linked.ID, linked.LinkedClipID = moving.ID+"/audio", moving.ID
			linked.Look, linked.Motion = "", ""
			moving.LinkedClipID = linked.ID
			audio.Clips = append(audio.Clips, linked)
		}
		video.Clips = append(video.Clips, moving)
	}
	s.composition.Tracks = append(s.composition.Tracks, video)
	if len(audio.Clips) > 0 {
		s.composition.Tracks = append(s.composition.Tracks, audio)
	}
}

func sequenceClip(id string, asset document.Asset, each document.Treatment) document.Clip {
	volume := 100.0
	if each.Volume != nil {
		volume = *each.Volume
	}
	return document.Clip{ID: id, AssetID: asset.ID, InPoint: each.Take.From,
		OutPoint:     each.Take.From + document.Seconds(each.Take.Duration.Seconds()*each.Rate),
		PlaybackRate: each.Rate, Volume: volume, Opacity: 1, Transform: document.IdentityTransform(),
		TransformKeyframes: []document.Keyframe{}, Look: each.Look, Motion: each.Motion}
}

func (s *compilation) sequenceOverlap(left, right document.Clip, between document.Between) document.Time {
	maximum := s.maxOverlap(left, right)
	if between.Duration <= maximum {
		return between.Duration
	}
	if between.Policy != "shrink" || maximum < MinimumTransitionDuration {
		s.fail("sequence.between.duration", "transition_does_not_fit", fmt.Sprintf("transition %.3gs does not fit between %s and %s (maximum %.3gs)", between.Duration.Seconds(), left.ID, right.ID, maximum.Seconds()))
		return 0
	}
	s.result.Diagnostics = append(s.result.Diagnostics, document.Diagnostic{Code: "transition_shrunk", Severity: "warning",
		Path: "sequence.between.duration", Message: fmt.Sprintf("transition %s → %s reduced to %.6gs by explicit shrink policy", left.ID, right.ID, maximum.Seconds())})
	return maximum
}

func (s *compilation) maxOverlap(left, right document.Clip) document.Time {
	shorter := min(left.Duration(), right.Duration())
	if s.assets[left.AssetID].Kind == "image" && s.assets[right.AssetID].Kind == "image" {
		return shorter / 2
	}
	return max(0, (shorter-MinimumClipDuration)/2)
}

func (s *compilation) expandTreatments() {
	for trackIndex := range s.composition.Tracks {
		track := &s.composition.Tracks[trackIndex]
		for clipIndex := range track.Clips {
			clip := &track.Clips[clipIndex]
			if clip.Duration() < MinimumClipDuration {
				continue
			}
			s.validatePresets(clip.Look, clip.Motion, "clips."+clip.ID)
			if clip.Look != "" {
				blocks, frames, err := s.compiler.Catalog.ExpandLook(clip.Look, *clip, track.ID, s.composition.Output.FPS)
				if err != nil {
					s.fail("clips."+clip.ID+".look", "invalid_look", err.Error())
					continue
				}
				s.composition.Effects = slices.DeleteFunc(s.composition.Effects, func(block document.EffectBlock) bool {
					return block.OwnerClipID == clip.ID && block.Provenance != nil && len(block.Provenance.Rule) >= 5 && block.Provenance.Rule[:5] == "look:"
				})
				s.composition.Effects = append(s.composition.Effects, blocks...)
				if len(clip.TransformKeyframes) == 0 {
					clip.TransformKeyframes = frames
				}
			}
			if clip.Motion != "" {
				frames, err := s.compiler.Catalog.ExpandMotion(clip.Motion, clip.Duration())
				if err != nil {
					s.fail("clips."+clip.ID+".motion", "invalid_motion", err.Error())
					continue
				}
				clip.TransformKeyframes = frames
			}
		}
	}
}

func (s *compilation) addAudio() {
	for index, audio := range s.input.Document.Audio {
		path := fmt.Sprintf("audio[%d]", index)
		ids := s.input.Bindings[audio.Use]
		if audio.ID == "" || len(ids) != 1 {
			s.fail(path, "invalid_audio", "audio needs an id and a slot bound to one audio asset")
			continue
		}
		asset := s.assets[ids[0]]
		if asset.Kind != "audio" {
			s.fail(path, "invalid_audio", "music requires an audio asset")
			continue
		}
		length := audio.Duration
		switch audio.Fit {
		case "sequence":
			length = s.composition.Duration - audio.Start
		case "", "source":
			if length == 0 {
				length = asset.Duration - audio.From
			}
		default:
			s.fail(path+".fit", "invalid_fit", "fit must be sequence or source")
			continue
		}
		available := asset.Duration - audio.From
		if audio.Start < 0 || audio.From < 0 || available <= 0 || length <= 0 || length > document.MaxTime {
			s.fail(path, "invalid_interval", "audio interval is invalid")
			continue
		}
		if length > available && !audio.Repeat {
			s.fail(path, "short_audio", "audio is shorter than requested; enable repeat explicitly")
			continue
		}
		track := document.Track{ID: audio.ID, Type: "audio", Name: "Music", Clips: []document.Clip{}}
		for cursor := document.Time(0); cursor < length; {
			if len(track.Clips) >= MaxClips {
				s.fail(path, "limit", "too many repeated audio clips")
				break
			}
			duration := min(available, length-cursor)
			clip := sequenceClip(fmt.Sprintf("%s/%d", audio.ID, len(track.Clips)), asset, document.Treatment{
				Take: document.Take{From: audio.From, Duration: duration}, Rate: 1, Volume: audio.Volume})
			clip.Start = audio.Start + cursor
			track.Clips = append(track.Clips, clip)
			cursor += duration
		}
		s.composition.Tracks = append(s.composition.Tracks, track)
	}
}

func (s *compilation) placeJobResults() {
	for jobIndex, job := range s.input.Document.Jobs {
		if job.ResultAssetID == "" || job.TrackID == "" {
			continue
		}
		path := fmt.Sprintf("jobs[%d]", jobIndex)
		asset, exists := s.assets[job.ResultAssetID]
		if !exists {
			continue
		}
		trackIndex := slices.IndexFunc(s.composition.Tracks, func(track document.Track) bool { return track.ID == job.TrackID })
		if trackIndex < 0 {
			continue
		}
		track := &s.composition.Tracks[trackIndex]
		if track.Type == "video" && asset.Kind == "audio" ||
			track.Type == "audio" && (asset.Kind == "image" || asset.Kind == "video" && !asset.HasAudio) {
			s.fail(path+".trackId", "incompatible_media", "generated media cannot be placed on this track")
			continue
		}
		duration := job.Duration
		if duration <= 0 {
			if asset.Kind == "image" {
				s.fail(path+".duration", "missing_duration", "image placement requires an explicit duration")
				continue
			}
			duration = asset.Duration
		}
		if asset.Kind != "image" && duration > asset.Duration {
			s.fail(path+".duration", "source_bounds", fmt.Sprintf("placement duration (%.3fs) exceeds asset %q (%s) duration (%.3fs)", duration.Seconds(), asset.ID, asset.File, asset.Duration.Seconds()))
			continue
		}
		if duration < MinimumClipDuration {
			s.fail(path+".duration", "invalid_duration", "placement duration must be at least 100ms")
			continue
		}
		start := job.Start
		if start == 0 && len(track.Clips) > 0 {
			end := track.Clips[0].End()
			for _, clip := range track.Clips[1:] {
				end = max(end, clip.End())
			}
			if end > 0 {
				start = end
			}
		}
		clipID := job.ID + "/result"
		for suffix := 2; slices.ContainsFunc(track.Clips, func(clip document.Clip) bool { return clip.ID == clipID }); suffix++ {
			clipID = fmt.Sprintf("%s/result/%d", job.ID, suffix)
		}
		track.Clips = append(track.Clips, document.Clip{ID: clipID, AssetID: asset.ID,
			Start: start, InPoint: 0, OutPoint: duration, PlaybackRate: 1, Volume: 100, Opacity: 1,
			Transform: document.IdentityTransform(), TransformKeyframes: []document.Keyframe{},
			Provenance: &document.Provenance{InstanceID: s.input.Document.InstanceID, Rule: "job:" + job.ID}})
		// Keep sibling lookup consistent for later placements on the same track.
		s.composition.Tracks[trackIndex] = *track
		s.placeSceneNarration(job, trackIndex, len(track.Clips)-1, job.ID)
	}
}

func (s *compilation) materializeTexts() {
	for index, text := range s.composition.TextItems {
		materialized, err := s.compiler.Catalog.MaterializeText(text, s.composition.Output.Aspect)
		if err != nil {
			s.fail(fmt.Sprintf("texts[%d]", index), "invalid_text", err.Error())
			continue
		}
		repairCaptionEncoding(&materialized)
		s.composition.TextItems[index] = materialized
	}
}

func (s *compilation) resolveOmittedClipOutPoints() {
	for trackIndex := range s.composition.Tracks {
		track := &s.composition.Tracks[trackIndex]
		for clipIndex := range track.Clips {
			clip := &track.Clips[clipIndex]
			if clip.OutPoint != 0 || clip.InPoint < 0 {
				continue
			}
			asset, exists := s.assets[clip.AssetID]
			if !exists || asset.Kind == "image" || asset.Duration <= clip.InPoint {
				continue
			}
			clip.OutPoint = asset.Duration
		}
	}
}

func (s *compilation) computeDuration() {
	s.composition.Duration = 0
	for _, track := range s.composition.Tracks {
		for _, clip := range track.Clips {
			s.composition.Duration = max(s.composition.Duration, clip.End())
		}
	}
	for _, text := range s.composition.TextItems {
		s.composition.Duration = max(s.composition.Duration, text.Start+text.Duration)
	}
}
