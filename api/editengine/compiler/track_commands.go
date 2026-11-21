package compiler

import (
	"slices"

	"ffmpeg-go-server/editengine/document"
)

func (s *compilation) applyTrackCommand(command document.Command, id, path string) {
	for index := range s.composition.Tracks {
		track := &s.composition.Tracks[index]
		if track.ID != id {
			continue
		}
		if track.Locked && command.Type != "track.lock" {
			s.fail(path, "locked_track", "track is locked")
			return
		}
		switch command.Type {
		case "track.mute":
			track.Muted = *command.Value
		case "track.hide":
			track.Hidden = *command.Value
		case "track.lock":
			track.Locked = *command.Value
		case "track.delete":
			ids := make([]string, 0, len(track.Clips))
			for _, clip := range track.Clips {
				ids = append(ids, clip.ID)
			}
			for _, clipID := range ids {
				if _, clip := s.findClip(clipID); clip != nil {
					s.deleteClip(clipID, path)
				}
			}
			s.composition.Tracks = slices.Delete(s.composition.Tracks, index, index+1)
			s.composition.Effects = slices.DeleteFunc(s.composition.Effects, func(block document.EffectBlock) bool { return block.TrackID == id })
		default:
			s.fail(path, "target_kind", "command does not apply to tracks")
		}
		return
	}
	s.fail(path, "unknown_track", "track is missing")
}

func (s *compilation) applyTransitionCommand(command document.Command, id, path string) {
	for index := range s.composition.Transitions {
		transition := &s.composition.Transitions[index]
		if transition.ID != id {
			continue
		}
		track, left := s.findClip(transition.LeftClipID)
		_, right := s.findClip(transition.RightClipID)
		if left == nil || right == nil || track.Locked {
			s.fail(path, "invalid_transition", "transition clips are missing or locked")
			return
		}
		switch command.Type {
		case "transition.set":
			transition.Preset = command.Preset
		case "transition.duration":
			if command.Duration < MinimumTransitionDuration || command.Duration > s.maxOverlap(*left, *right) {
				s.fail(path, "invalid_overlap", "transition duration does not fit")
				return
			}
			delta := transition.Duration - command.Duration
			boundary := right.Start
			for _, clip := range slices.Clone(track.Clips) {
				if clip.Start >= boundary {
					start := clip.Start + delta
					s.applyOverride(document.Override{Target: clip.ID, Start: &start}, path)
				}
			}
			transition.Duration = command.Duration
		case "transition.remove":
			if command.CloseGap {
				delta, boundary := transition.Duration, right.Start
				for _, clip := range slices.Clone(track.Clips) {
					if clip.Start >= boundary {
						start := clip.Start + delta
						s.applyOverride(document.Override{Target: clip.ID, Start: &start}, path)
					}
				}
				s.composition.Transitions = slices.Delete(s.composition.Transitions, index, index+1)
			} else {
				// Overlap remains an explicit cross-dissolve, matching the editor's overlap semantics.
				transition.Preset = "cross-dissolve"
			}
		default:
			s.fail(path, "target_kind", "command does not apply to transitions")
		}
		return
	}
	s.fail(path, "unknown_transition", "transition is missing")
}
