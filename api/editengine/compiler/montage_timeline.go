package compiler

import (
	"fmt"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/document"
)

type montageSpan struct {
	from, to, at document.Time
	index        int
}

func (span montageSpan) intersect(start, end document.Time) (document.Time, document.Time, bool) {
	a, b := max(start, span.from), min(end, span.to)
	return a, b, b > a
}

func montageClipID(id string, index int) string { return fmt.Sprintf("%s/montage/%d", id, index) }

type montageReference struct {
	id   string
	span int
}

func (s *compilation) remapMontage(spans []montageSpan, targetTrack string) {
	references := make(map[montageReference]string)
	primary := make(map[string]bool)
	for _, track := range s.composition.Tracks {
		if track.ID == targetTrack {
			for _, clip := range track.Clips {
				primary[clip.ID] = true
				primary[clip.LinkedClipID] = true
			}
		}
	}
	for trackIndex := range s.composition.Tracks {
		track := &s.composition.Tracks[trackIndex]
		var clips []document.Clip
		for _, clip := range track.Clips {
			for _, span := range spans {
				a, b, exists := span.intersect(clip.Start, clip.End())
				if !exists {
					continue
				}
				unchanged := a == clip.Start && b == clip.End() && span.at == span.from
				if track.Locked && !unchanged {
					s.fail("montage.target", "locked_track", "synchronized montage would change locked track "+track.ID)
					continue
				}
				if b-a < MinimumClipDuration {
					s.fail("montage.ranges", "short_fragment", "montage would leave a sub-100ms clip on track "+track.ID)
					continue
				}
				part := montageClipPart(clip, span, a, b)
				if span.index >= 0 && primary[clip.ID] {
					part.Provenance = &document.Provenance{InstanceID: s.input.Document.InstanceID, Rule: "montage"}
				}
				references[montageReference{clip.ID, span.index}] = part.ID
				clips = append(clips, part)
			}
		}
		track.Clips = clips
	}
	for trackIndex := range s.composition.Tracks {
		for clipIndex := range s.composition.Tracks[trackIndex].Clips {
			clip := &s.composition.Tracks[trackIndex].Clips[clipIndex]
			if clip.LinkedClipID == "" {
				continue
			}
			_, linked := s.findClip(clip.LinkedClipID)
			if linked == nil {
				s.fail("montage", "broken_link", "montage must preserve linked audio and video together")
			}
		}
	}
	s.remapMontageEffects(spans, references)
	s.remapMontageTexts(spans, references)
	var transitions []document.Transition
	for _, transition := range s.composition.Transitions {
		for _, span := range spans {
			if span.index >= 0 && transition.TrackID == targetTrack {
				continue
			}
			left := references[montageReference{transition.LeftClipID, span.index}]
			right := references[montageReference{transition.RightClipID, span.index}]
			if left == "" || right == "" {
				continue
			}
			part := transition
			part.LeftClipID, part.RightClipID = left, right
			if left != transition.LeftClipID || right != transition.RightClipID {
				part.ID = montageClipID(part.ID, span.index)
			}
			transitions = append(transitions, part)
		}
	}
	s.composition.Transitions = transitions
}

func montageClipPart(clip document.Clip, span montageSpan, a, b document.Time) document.Clip {
	part := clip
	part.Start = span.at + a - span.from
	part.InPoint = clip.InPoint + document.Seconds((a-clip.Start).Seconds()*clip.PlaybackRate)
	part.OutPoint = clip.InPoint + document.Seconds((b-clip.Start).Seconds()*clip.PlaybackRate)
	if span.index >= 0 || a != clip.Start || b != clip.End() {
		part.ID = montageClipID(clip.ID, span.index)
		if clip.LinkedClipID != "" {
			part.LinkedClipID = montageClipID(clip.LinkedClipID, span.index)
		}
	}
	part.FadeIn, part.FadeOut = min(part.FadeIn, part.Duration()), min(part.FadeOut, part.Duration())
	if a != clip.Start || b != clip.End() {
		part.TransformKeyframes = montageKeyframes(clip, a-clip.Start, b-clip.Start)
	}
	return part
}

func (s *compilation) remapMontageEffects(spans []montageSpan, references map[montageReference]string) {
	var effects []document.EffectBlock
	for _, block := range s.composition.Effects {
		for _, span := range spans {
			a, b, exists := span.intersect(block.Start, block.Start+block.Duration)
			if !exists {
				continue
			}
			part := block
			if block.OwnerClipID != "" {
				part.OwnerClipID = references[montageReference{block.OwnerClipID, span.index}]
				if part.OwnerClipID == "" {
					continue
				}
				if block.Provenance != nil && strings.HasPrefix(block.Provenance.Rule, "look:") {
					continue
				}
			}
			if block.Ramp != nil && (a != block.Start || b != block.Start+block.Duration) {
				s.fail("montage", "ramp_cut", "a montage boundary crosses an authored ramp; choose a boundary outside the ramp")
				continue
			}
			part.Start, part.Duration = span.at+a-span.from, b-a
			if span.index >= 0 || a != block.Start || b != block.Start+block.Duration {
				part.ID = montageClipID(block.ID, span.index)
			}
			effects = append(effects, part)
		}
	}
	s.composition.Effects = effects
}

func (s *compilation) remapMontageTexts(spans []montageSpan, references map[montageReference]string) {
	generated := make(map[string]bool)
	for _, job := range s.input.Document.After {
		for _, id := range job.ResultTextIDs {
			generated[id] = true
		}
	}
	var texts []document.TextItem
	for _, item := range s.composition.TextItems {
		if generated[item.ID] {
			texts = append(texts, item)
			continue
		}
		for _, span := range spans {
			a, b, exists := span.intersect(item.Start, item.Start+item.Duration)
			if !exists {
				continue
			}
			part := item
			if item.SourceClipID != "" {
				part.SourceClipID = references[montageReference{item.SourceClipID, span.index}]
				if part.SourceClipID == "" {
					continue
				}
			}
			part.Start, part.Duration = span.at+a-span.from, b-a
			if span.index >= 0 || a != item.Start || b != item.Start+item.Duration {
				part.ID = montageClipID(item.ID, span.index)
			}
			part.Words = nil
			for _, word := range item.Words {
				if item.Start+word.Start < a || item.Start+word.End > b {
					continue
				}
				word.Start += item.Start - a
				word.End += item.Start - a
				part.Words = append(part.Words, word)
			}
			if len(item.Words) > 0 {
				if len(part.Words) == 0 {
					continue
				}
				words := make([]string, len(part.Words))
				for index, word := range part.Words {
					words[index] = word.Text
				}
				part.Text = strings.Join(words, " ")
			}
			texts = append(texts, part)
		}
	}
	s.composition.TextItems = texts
}

func montageKeyframes(clip document.Clip, from, to document.Time) []document.Keyframe {
	if len(clip.TransformKeyframes) == 0 {
		return slices.Clone(clip.TransformKeyframes)
	}
	frames := []document.Keyframe{{Time: 0, Transform: montageTransformAt(clip, from)}}
	for _, frame := range clip.TransformKeyframes {
		if frame.Time > from && frame.Time < to {
			frame.Time -= from
			frames = append(frames, frame)
		}
	}
	return append(frames, document.Keyframe{Time: to - from, Transform: montageTransformAt(clip, to)})
}

func montageTransformAt(clip document.Clip, at document.Time) document.Transform {
	frames := clip.TransformKeyframes
	if at <= frames[0].Time {
		return frames[0].Transform
	}
	for index := 1; index < len(frames); index++ {
		if at > frames[index].Time {
			continue
		}
		a, b := frames[index-1], frames[index]
		ratio := float64(at-a.Time) / float64(b.Time-a.Time)
		return interpolateMontageTransform(a.Transform, b.Transform, ratio)
	}
	return frames[len(frames)-1].Transform
}

func interpolateMontageTransform(a, b document.Transform, ratio float64) document.Transform {
	lerp := func(x, y float64) float64 { return x + (y-x)*ratio }
	t := a
	t.ZoomX, t.ZoomY = lerp(a.ZoomX, b.ZoomX), lerp(a.ZoomY, b.ZoomY)
	t.PositionX, t.PositionY = lerp(a.PositionX, b.PositionX), lerp(a.PositionY, b.PositionY)
	t.AnchorX, t.AnchorY = lerp(a.AnchorX, b.AnchorX), lerp(a.AnchorY, b.AnchorY)
	t.Rotation, t.Pitch, t.Yaw = lerp(a.Rotation, b.Rotation), lerp(a.Pitch, b.Pitch), lerp(a.Yaw, b.Yaw)
	if ratio >= 1 {
		t.FlipH, t.FlipV, t.LinkZoom = b.FlipH, b.FlipV, b.LinkZoom
	}
	return t
}
