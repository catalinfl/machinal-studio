package compiler

import (
	"slices"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

func (s *compilation) flattenEffects() {
	for _, track := range s.composition.Tracks {
		if track.Type != "video" {
			continue
		}
		for _, clip := range track.Clips {
			s.composition.Segments[clip.ID] = flatten(clip, track.ID, s.composition.Effects)
		}
	}
}

func flatten(clip document.Clip, trackID string, blocks []document.EffectBlock) []composition.Segment {
	boundaries := []document.Time{clip.Start, clip.End()}
	active := []document.EffectBlock{}
	for _, block := range blocks {
		if block.TrackID != trackID || block.OwnerClipID != "" && block.OwnerClipID != clip.ID {
			continue
		}
		if block.Start >= clip.End() || block.Start+block.Duration <= clip.Start {
			continue
		}
		active = append(active, block)
		boundaries = append(boundaries, max(clip.Start, block.Start), min(clip.End(), block.Start+block.Duration))
	}
	slices.Sort(boundaries)
	boundaries = slices.Compact(boundaries)
	segments := make([]composition.Segment, 0, len(boundaries)-1)
	for index := 1; index < len(boundaries); index++ {
		start, end := boundaries[index-1], boundaries[index]
		segment := composition.Segment{SrcStart: sourceTime(clip, start), SrcEnd: sourceTime(clip, end), Effects: []composition.Effect{}}
		for _, block := range active {
			if block.Start >= end || block.Start+block.Duration <= start {
				continue
			}
			effect := composition.Effect{ID: block.Preset, Params: block.Params}
			if block.Ramp != nil {
				effect.Ramp = &composition.Ramp{Ramp: *block.Ramp, BlockDuration: block.Duration, Offset: start - block.Start}
			}
			segment.Effects = append(segment.Effects, effect)
		}
		segments = append(segments, segment)
	}
	return segments
}

func sourceTime(clip document.Clip, timeline document.Time) document.Time {
	if timeline == clip.End() {
		return clip.OutPoint
	}
	return clip.InPoint + document.Seconds((timeline-clip.Start).Seconds()*clip.PlaybackRate)
}
