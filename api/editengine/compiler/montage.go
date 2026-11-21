package compiler

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/document"
)

const MaxMontageRanges = 128

type montageMoment struct {
	rangeSpec document.MontageRange
	clip      document.Clip
	start     document.Time
	end       document.Time
}

func (s *compilation) validateMontage() {
	m := s.input.Document.Montage
	if m == nil {
		return
	}
	if m.Target.Kind != "video" || len(m.Ranges) > 0 && len(m.Candidates) > 0 {
		s.fail("montage", "invalid_montage", "use a video target and either exact ranges or scored candidates")
	}
	if len(m.Ranges)+len(m.Candidates) > MaxMontageRanges {
		s.fail("montage", "limit", fmt.Sprintf("at most %d montage ranges", MaxMontageRanges))
	}
	if len(m.Candidates) > 0 && m.TargetDuration <= 0 {
		s.fail("montage.targetDuration", "missing_duration", "candidate selection requires a target duration")
	}
	if m.TargetDuration < 0 || m.TargetDuration > document.MaxTime || m.Tolerance < 0 || m.Tolerance > document.MaxTime {
		s.fail("montage.targetDuration", "invalid_duration", "duration and tolerance must be between zero and 24 hours")
	}
	if m.Between != nil {
		if m.Between.Duration < MinimumTransitionDuration || !slices.Contains([]string{"", "error", "shrink"}, m.Between.Policy) {
			s.fail("montage.between", "invalid_transition", "use duration >= 100ms and policy error or shrink")
		}
		s.validateMontageChoice(m.Between.PresetChoice, false, "montage.between")
	}
	if m.Motion != nil {
		s.validateMontageChoice(*m.Motion, true, "montage.motion")
	}
}

func (s *compilation) montagePresets(choice document.PresetChoice, motion bool) []string {
	var ids []string
	if motion {
		for _, preset := range s.compiler.Catalog.Motions {
			if choice.Family == "zoom" && !strings.Contains(preset.ID, "zoom") {
				continue
			}
			if preset.ID != "none" {
				ids = append(ids, preset.ID)
			}
		}
	} else {
		for _, preset := range s.compiler.Catalog.Transitions {
			ids = append(ids, preset.ID)
		}
	}
	slices.Sort(ids)
	return ids
}

func (s *compilation) validateMontageChoice(choice document.PresetChoice, motion bool, path string) {
	if choice.Random == (choice.Preset != "") || choice.Family != "" && (!motion || choice.Family != "zoom") {
		s.fail(path, "invalid_choice", "choose an exact preset or random; the supported motion family is zoom")
		return
	}
	ids := s.montagePresets(choice, motion)
	if !choice.Random && !slices.Contains(ids, choice.Preset) || len(ids) == 0 {
		s.fail(path, "unknown_preset", "no compatible catalog preset")
	}
}

func (s *compilation) montagePreset(choice document.PresetChoice, motion bool, salt string) string {
	if !choice.Random {
		return choice.Preset
	}
	ids := s.montagePresets(choice, motion)
	hash := sha256.Sum256([]byte(s.input.Document.Montage.Seed + "/" + salt))
	return ids[binary.BigEndian.Uint64(hash[:8])%uint64(len(ids))]
}

func (s *compilation) montageMoments(m document.Montage) ([]montageMoment, string, document.Time, document.Time) {
	ids := s.resolveSelector(m.Target)
	if len(ids) == 0 {
		s.fail("montage.target", "empty_selector", "montage target has no video clips")
		return nil, "", 0, 0
	}
	start, end, trackID := document.MaxTime, document.Time(0), ""
	for _, id := range ids {
		track, clip := s.findClip(id)
		if track == nil || track.Locked || track.Type != "video" || trackID != "" && trackID != track.ID {
			s.fail("montage.target", "invalid_target", "montage requires unlocked video clips on one track")
			return nil, "", 0, 0
		}
		trackID, start, end = track.ID, min(start, clip.Start), max(end, clip.End())
	}
	for _, track := range s.composition.Tracks {
		if track.ID != trackID {
			continue
		}
		for _, clip := range track.Clips {
			if clip.Start < end && clip.End() > start && !slices.Contains(ids, clip.ID) {
				s.fail("montage.target", "scope_conflict", "select the intervening clips as well before making a synchronized montage")
			}
		}
	}
	ranges := append(slices.Clone(m.Ranges), m.Candidates...)
	if len(ranges) == 0 {
		for _, id := range ids {
			_, clip := s.findClip(id)
			ranges = append(ranges, document.MontageRange{ClipID: id, From: clip.InPoint, To: clip.OutPoint})
		}
	}
	var moments []montageMoment
	for index, spec := range ranges {
		_, clip := s.findClip(spec.ClipID)
		path := fmt.Sprintf("montage.ranges[%d]", index)
		if clip == nil || !slices.Contains(ids, spec.ClipID) || spec.From < clip.InPoint || spec.To > clip.OutPoint || spec.To <= spec.From || clip.PlaybackRate <= 0 || spec.Score < 0 || spec.Score > 100 {
			s.fail(path, "invalid_range", "range must lie inside a targeted clip; score must be 0–100")
			continue
		}
		a := clip.Start + document.Seconds((spec.From-clip.InPoint).Seconds()/clip.PlaybackRate)
		b := clip.Start + document.Seconds((spec.To-clip.InPoint).Seconds()/clip.PlaybackRate)
		if b-a < MinimumClipDuration {
			s.fail(path, "invalid_duration", "montage ranges must last at least 100ms")
			continue
		}
		moments = append(moments, montageMoment{spec, *clip, a, b})
	}
	slices.SortStableFunc(moments, func(a, b montageMoment) int {
		if a.start != b.start {
			return timeCompare(a.start, b.start)
		}
		return timeCompare(a.end, b.end)
	})
	for index := 1; index < len(moments); index++ {
		if moments[index].start < moments[index-1].end {
			s.fail("montage.ranges", "overlapping_ranges", "montage moments must not overlap")
		}
	}
	return moments, trackID, start, end
}

func timeCompare(a, b document.Time) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

func (s *compilation) montageOverlap(left, right montageMoment, between *document.MontageBetween) (document.Time, bool) {
	if between == nil {
		return 0, true
	}
	maximum := max(0, (min(left.end-left.start, right.end-right.start)-MinimumClipDuration)/2)
	if between.Duration <= maximum {
		return between.Duration, true
	}
	if between.Policy == "shrink" && maximum >= MinimumTransitionDuration {
		return maximum, true
	}
	return 0, false
}

func (s *compilation) applyMontage() {
	m := s.input.Document.Montage
	if m == nil {
		return
	}
	moments, trackID, start, end := s.montageMoments(*m)
	if s.hasErrors() {
		return
	}
	if len(m.Candidates) > 0 {
		moments = s.selectMontageMoments(moments, *m)
	}
	if len(moments) == 0 || s.hasErrors() {
		return
	}
	spans := []montageSpan{{from: 0, to: start, at: 0, index: -1}}
	cursor := start
	for index, moment := range moments {
		if index > 0 {
			overlap, fits := s.montageOverlap(moments[index-1], moment, m.Between)
			if !fits {
				s.fail("montage.between.duration", "transition_does_not_fit", "requested transition does not fit these complete moments; choose longer moments")
				return
			}
			cursor -= overlap
			if m.Between != nil && overlap != m.Between.Duration {
				s.result.Diagnostics = append(s.result.Diagnostics, document.Diagnostic{Path: "montage.between.duration", Code: "transition_shrunk", Severity: "warning", Message: fmt.Sprintf("transition reduced to %.3gs by explicit shrink policy", overlap.Seconds())})
			}
		}
		spans = append(spans, montageSpan{from: moment.start, to: moment.end, at: cursor, index: index})
		cursor += moment.end - moment.start
	}
	if m.TargetDuration > 0 && absTime(cursor-start-m.TargetDuration) > m.Tolerance {
		s.fail("montage.targetDuration", "duration_unreachable", fmt.Sprintf("complete moments produce %.3gs; expected %.3gs ± %.3gs", (cursor-start).Seconds(), m.TargetDuration.Seconds(), m.Tolerance.Seconds()))
		return
	}
	spans = append(spans, montageSpan{from: end, to: document.MaxTime, at: cursor, index: -2})
	s.remapMontage(spans, trackID)
	if s.hasErrors() {
		return
	}
	for index, moment := range moments {
		id := montageClipID(moment.clip.ID, index)
		_, clip := s.findClip(id)
		if clip == nil {
			continue
		}
		if m.Motion != nil {
			clip.Motion = s.montagePreset(*m.Motion, true, "motion")
			clip.TransformKeyframes = nil
		}
		if index > 0 && m.Between != nil {
			leftID := montageClipID(moments[index-1].clip.ID, index-1)
			_, left := s.findClip(leftID)
			s.composition.Transitions = append(s.composition.Transitions, document.Transition{
				ID: leftID + "/to/" + id, TrackID: trackID, LeftClipID: leftID, RightClipID: id,
				Preset: s.montagePreset(m.Between.PresetChoice, false, fmt.Sprintf("junction/%d", index)), Duration: left.End() - clip.Start,
			})
		}
	}
}

func absTime(value document.Time) document.Time {
	if value < 0 {
		return -value
	}
	return value
}
