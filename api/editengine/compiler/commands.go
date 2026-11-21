package compiler

import (
	"fmt"
	"slices"

	"ffmpeg-go-server/editengine/document"
)

var commandTypes = []string{
	"clip.move", "clip.trim", "clip.duration", "clip.speed", "clip.delete", "clip.duplicate", "clip.split", "clip.source_audio.remove",
	"track.create", "track.delete", "track.mute", "track.hide", "track.lock",
	"look.apply", "look.remove", "motion.apply", "transform.set", "transform.reset", "keyframe.clear",
	"transition.set", "transition.duration", "transition.remove",
}

func SupportedCommands() []string { return slices.Clone(commandTypes) }

func (s *compilation) validateCommands() {
	for index, command := range s.input.Document.Commands {
		path := fmt.Sprintf("commands[%d]", index)
		if !slices.Contains(commandTypes, command.Type) {
			s.fail(path+".type", "unsupported_command", "unsupported command "+command.Type)
		}
		if !slices.Contains([]string{"", "all", "first", "last", "nth"}, command.Target.Position) {
			s.fail(path+".target.position", "invalid_selector", "unknown selector position")
		}
		if command.Target.Position == "nth" && command.Target.Index < 1 {
			s.fail(path+".target.index", "invalid_selector", "nth is 1-based")
		}
		if !slices.Contains([]string{"", "clip", "video", "audio", "image", "track", "transition"}, command.Target.Kind) {
			s.fail(path+".target.kind", "invalid_selector", "unsupported selector kind")
		}
		switch command.Type {
		case "clip.move", "clip.trim", "clip.duration", "clip.speed", "transform.set":
			if command.Patch == nil {
				s.fail(path+".patch", "missing_patch", "this command requires a patch")
			}
		case "track.create":
			if command.Track == nil {
				s.fail(path+".track", "missing_track", "track.create requires a track")
			}
		case "track.mute", "track.hide", "track.lock":
			if command.Value == nil {
				s.fail(path+".value", "missing_value", "use an explicit boolean value")
			}
		case "look.apply":
			s.validatePresets(command.Preset, "", path)
		case "motion.apply":
			s.validatePresets("", command.Preset, path)
		case "transition.set":
			if _, ok := s.compiler.Catalog.Transition(command.Preset); !ok {
				s.fail(path+".preset", "unknown_preset", "unknown transition")
			}
		}
	}
}

func (s *compilation) resolveSelector(selector document.Selector) []string {
	targets := []string{}
	selected := []string{}
	if s.input.Snapshot != nil {
		selected = s.input.Snapshot.SelectedIDs
	}
	include := func(id string) {
		if len(selector.IDs) > 0 && !slices.Contains(selector.IDs, id) {
			return
		}
		if selector.Selected && !slices.Contains(selected, id) {
			return
		}
		targets = append(targets, id)
	}
	if selector.Kind == "transition" {
		for _, transition := range s.composition.Transitions {
			if selector.TrackID == "" || selector.TrackID == transition.TrackID {
				include(transition.ID)
			}
		}
	} else {
		for _, track := range s.composition.Tracks {
			if selector.TrackID != "" && selector.TrackID != track.ID {
				continue
			}
			if selector.Kind == "track" {
				include(track.ID)
				continue
			}
			clips := slices.Clone(track.Clips)
			slices.SortStableFunc(clips, func(a, b document.Clip) int {
				if a.Start < b.Start {
					return -1
				}
				if a.Start > b.Start {
					return 1
				}
				return 0
			})
			for _, clip := range clips {
				kind := s.assets[clip.AssetID].Kind
				if track.Type == "audio" {
					kind = "audio"
				}
				if selector.Kind == "" || selector.Kind == "clip" || selector.Kind == kind {
					include(clip.ID)
				}
			}
		}
	}
	if len(selector.IDs) > 0 && len(targets) != len(selector.IDs) {
		return nil
	}
	if len(targets) == 0 {
		return targets
	}
	switch selector.Position {
	case "first":
		return targets[:1]
	case "last":
		return targets[len(targets)-1:]
	case "nth":
		if selector.Index > len(targets) {
			return nil
		}
		return targets[selector.Index-1 : selector.Index]
	}
	return targets
}

func (s *compilation) applyCommands() {
	commands := s.input.Document.Commands
	targets := make([][]string, len(commands))
	for index, command := range commands {
		if command.Type == "track.create" {
			continue
		}
		targets[index] = s.resolveSelector(command.Target)
		if len(targets[index]) == 0 {
			s.fail(fmt.Sprintf("commands[%d].target", index), "empty_selector", "selector has no results in the captured snapshot")
		}
	}
	if s.hasErrors() {
		return
	}
	for index, command := range commands {
		path := fmt.Sprintf("commands[%d]", index)
		if command.Type == "track.create" {
			s.composition.Tracks = append(s.composition.Tracks, *command.Track)
			continue
		}
		for _, id := range targets[index] {
			s.applyCommand(command, id, path)
		}
	}
}

func (s *compilation) findClip(id string) (*document.Track, *document.Clip) {
	for trackIndex := range s.composition.Tracks {
		track := &s.composition.Tracks[trackIndex]
		for clipIndex := range track.Clips {
			if track.Clips[clipIndex].ID == id {
				return track, &track.Clips[clipIndex]
			}
		}
	}
	return nil, nil
}

func (s *compilation) applyOverride(override document.Override, path string) {
	track, clip := s.findClip(override.Target)
	if clip == nil {
		s.fail(path, "unknown_target", "unknown clip "+override.Target)
		return
	}
	if track.Locked {
		s.fail(path, "locked_track", "clip is on a locked track")
		return
	}
	previous := *clip
	patchClip(clip, override)
	s.moveAttachments(previous, *clip)
	if clip.LinkedClipID != "" {
		linkedTrack, linked := s.findClip(clip.LinkedClipID)
		if linked == nil {
			s.fail(path, "broken_link", "linked audio is missing")
			return
		}
		if linkedTrack.Locked {
			s.fail(path, "locked_track", "linked clip is on a locked track")
			return
		}
		if s.sceneNarrationPair(previous, *linked) {
			offset := linked.InPoint - previous.InPoint
			linked.InPoint = clip.InPoint + offset
			linked.OutPoint = min(clip.OutPoint+offset, s.assets[linked.AssetID].Duration)
		} else {
			linked.InPoint, linked.OutPoint = clip.InPoint, clip.OutPoint
		}
		linked.Start, linked.PlaybackRate = clip.Start, clip.PlaybackRate
	}
}

func patchClip(clip *document.Clip, patch document.Override) {
	duration := clip.Duration()
	if patch.Start != nil {
		clip.Start = *patch.Start
	}
	if patch.From != nil {
		clip.InPoint = *patch.From
	}
	if patch.Rate != nil {
		clip.PlaybackRate = *patch.Rate
	}
	if patch.Duration != nil {
		duration = *patch.Duration
	}
	if patch.From != nil || patch.Duration != nil {
		clip.OutPoint = clip.InPoint + document.Seconds(duration.Seconds()*clip.PlaybackRate)
	}
	if patch.Volume != nil {
		clip.Volume = *patch.Volume
	}
	if patch.Opacity != nil {
		clip.Opacity = *patch.Opacity
	}
	if patch.FadeIn != nil {
		clip.FadeIn = *patch.FadeIn
	}
	if patch.FadeOut != nil {
		clip.FadeOut = *patch.FadeOut
	}
	if patch.Transform != nil {
		clip.Transform = *patch.Transform
	}
	if patch.Keyframes != nil {
		clip.TransformKeyframes = slices.Clone(*patch.Keyframes)
		clip.Motion = ""
	}
	if patch.Look != nil {
		clip.Look = *patch.Look
		clip.TransformKeyframes = nil
	}
	if patch.Motion != nil {
		clip.Motion = *patch.Motion
		clip.TransformKeyframes = nil
	}
}

func (s *compilation) moveAttachments(previous, next document.Clip) {
	delta := next.Start - previous.Start
	for index := range s.composition.Effects {
		block := &s.composition.Effects[index]
		if block.OwnerClipID == next.ID {
			block.Start += delta
		}
	}
	for index := range s.composition.TextItems {
		item := &s.composition.TextItems[index]
		if item.SourceClipID == next.ID {
			item.Start += delta
		}
	}
}

func (s *compilation) applyCommand(command document.Command, id, path string) {
	if command.Target.Kind == "track" {
		s.applyTrackCommand(command, id, path)
		return
	}
	if command.Target.Kind == "transition" {
		s.applyTransitionCommand(command, id, path)
		return
	}
	track, clip := s.findClip(id)
	if clip == nil {
		s.fail(path, "missing_target", "target was removed by an earlier command")
		return
	}
	if track.Locked {
		s.fail(path, "locked_track", "target is locked")
		return
	}
	switch command.Type {
	case "clip.move", "clip.trim", "clip.duration", "clip.speed", "transform.set":
		patch := *command.Patch
		patch.Target = id
		s.applyOverride(patch, path)
		if command.TrackID != "" && command.TrackID != track.ID {
			s.moveToTrack(id, command.TrackID, path)
		}
	case "look.apply":
		clip.Look, clip.TransformKeyframes = command.Preset, nil
	case "look.remove":
		clip.Look = ""
		s.composition.Effects = slices.DeleteFunc(s.composition.Effects, func(block document.EffectBlock) bool {
			return block.OwnerClipID == id && block.Provenance != nil && len(block.Provenance.Rule) >= 5 && block.Provenance.Rule[:5] == "look:"
		})
	case "motion.apply":
		clip.Motion, clip.TransformKeyframes = command.Preset, nil
	case "transform.reset":
		clip.Transform, clip.TransformKeyframes, clip.Motion = document.IdentityTransform(), nil, ""
	case "keyframe.clear":
		clip.TransformKeyframes, clip.Motion = nil, ""
	case "clip.delete":
		s.deleteClip(id, path)
	case "clip.source_audio.remove":
		if track.Type != "video" || clip.LinkedClipID == "" {
			s.fail(path, "missing_audio", "video has no linked source audio")
			return
		}
		linkedID := clip.LinkedClipID
		linkedTrack, linked := s.findClip(linkedID)
		if linked == nil || linkedTrack.Type != "audio" || linkedTrack.Locked {
			s.fail(path, "locked_audio", "source audio is unavailable or locked")
			return
		}
		clip.LinkedClipID, linked.LinkedClipID = "", ""
		s.deleteClip(linkedID, path)
	case "clip.duplicate":
		if clip.LinkedClipID != "" || len(clip.TransformKeyframes) > 0 || s.hasAttachments(id) {
			s.fail(path, "unsupported_duplicate", "duplicate with links, keyframes or attachments requires explicit document items")
			return
		}
		copy := *clip
		copy.ID, copy.Start = id+"/copy", command.Time
		track.Clips = append(track.Clips, copy)
	case "clip.split":
		s.splitClip(id, command.Time, path)
	default:
		s.fail(path, "target_kind", "command does not apply to clips")
	}
}

func (s *compilation) moveToTrack(id, destination, path string) {
	source, clip := s.findClip(id)
	for index := range s.composition.Tracks {
		target := &s.composition.Tracks[index]
		if target.ID != destination {
			continue
		}
		if target.Type != source.Type || target.Locked {
			s.fail(path, "incompatible_track", "destination is locked or incompatible")
			return
		}
		target.Clips = append(target.Clips, *clip)
		source.Clips = slices.DeleteFunc(source.Clips, func(candidate document.Clip) bool { return candidate.ID == id })
		for index := range s.composition.Effects {
			if s.composition.Effects[index].OwnerClipID == id {
				s.composition.Effects[index].TrackID = destination
			}
		}
		return
	}
	s.fail(path, "unknown_track", "destination track is missing")
}

func (s *compilation) deleteClip(id, path string) {
	track, clip := s.findClip(id)
	if clip == nil {
		s.fail(path, "unknown_clip", "clip is missing")
		return
	}
	if track.Locked {
		s.fail(path, "locked_track", "track is locked")
		return
	}
	linkedID := clip.LinkedClipID
	if linkedID != "" {
		linkedTrack, linked := s.findClip(linkedID)
		if linked == nil || linkedTrack.Locked {
			s.fail(path, "locked_track", "linked track is locked or missing")
			return
		}
		linked.LinkedClipID = ""
		s.deleteClip(linkedID, path)
	}
	track.Clips = slices.DeleteFunc(track.Clips, func(candidate document.Clip) bool { return candidate.ID == id })
	s.composition.Effects = slices.DeleteFunc(s.composition.Effects, func(block document.EffectBlock) bool { return block.OwnerClipID == id })
	s.composition.TextItems = slices.DeleteFunc(s.composition.TextItems, func(item document.TextItem) bool { return item.SourceClipID == id })
	s.composition.Transitions = slices.DeleteFunc(s.composition.Transitions, func(t document.Transition) bool { return t.LeftClipID == id || t.RightClipID == id })
}

func (s *compilation) hasAttachments(id string) bool {
	return slices.ContainsFunc(s.composition.Effects, func(b document.EffectBlock) bool { return b.OwnerClipID == id }) ||
		slices.ContainsFunc(s.composition.TextItems, func(t document.TextItem) bool { return t.SourceClipID == id })
}

func (s *compilation) splitClip(id string, at document.Time, path string) {
	track, clip := s.findClip(id)
	if at-clip.Start < MinimumClipDuration || clip.End()-at < MinimumClipDuration {
		s.fail(path, "invalid_split", "split must leave at least 100ms on both sides")
		return
	}
	if clip.LinkedClipID != "" || len(clip.TransformKeyframes) > 0 || s.hasAttachments(id) ||
		slices.ContainsFunc(s.composition.Transitions, func(t document.Transition) bool { return t.LeftClipID == id || t.RightClipID == id }) {
		s.fail(path, "unsupported_split", "split with links, keyframes, transitions or attachments requires explicit document items")
		return
	}
	right := *clip
	right.ID, right.Start = id+"/split", at
	right.InPoint = clip.InPoint + document.Seconds((at-clip.Start).Seconds()*clip.PlaybackRate)
	clip.OutPoint = right.InPoint
	track.Clips = append(track.Clips, right)
}
