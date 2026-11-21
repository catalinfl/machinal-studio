package catalog

import (
	"encoding/json"
	"fmt"
	"maps"
	"math"

	"ffmpeg-go-server/editengine/document"
)

func (r Registry) ExpandMotion(id string, duration document.Time) ([]document.Keyframe, error) {
	motion, ok := r.Motion(id)
	if !ok {
		return nil, fmt.Errorf("unknown motion %q", id)
	}
	span := duration
	if motion.Cap > 0 {
		span = min(span, document.Seconds(motion.Cap))
	}
	frames := expandFrames(motion.Frames, span)
	if len(frames) > 0 && frames[len(frames)-1].Time < duration {
		last := frames[len(frames)-1]
		last.Time = duration
		frames = append(frames, last)
	}
	return frames, nil
}

func expandFrames(frames []Frame, span document.Time) []document.Keyframe {
	result := make([]document.Keyframe, 0, len(frames))
	for _, frame := range frames {
		result = append(result, document.Keyframe{Time: document.Seconds(frame.At * span.Seconds()), Transform: frame.Transform})
	}
	return result
}

func (r Registry) ExpandLook(id string, clip document.Clip, trackID string, fps int) ([]document.EffectBlock, []document.Keyframe, error) {
	look, ok := r.Look(id)
	if !ok {
		return nil, nil, fmt.Errorf("unknown look %q", id)
	}
	frames := expandFrames(look.Frames, clip.Duration())
	if look.Motion != "" {
		var err error
		frames, err = r.ExpandMotion(look.Motion, clip.Duration())
		if err != nil {
			return nil, nil, err
		}
	}
	effects := make([]document.EffectBlock, 0, len(look.Effects))
	for index, effect := range look.Effects {
		block, err := r.expandLookEffect(effect, clip, trackID, index, fps)
		if err != nil {
			return nil, nil, err
		}
		effects = append(effects, block)
	}
	return effects, frames, nil
}

func (r Registry) expandLookEffect(effect LookEffect, clip document.Clip, trackID string, index, fps int) (document.EffectBlock, error) {
	const minimumEffectDuration document.Time = 1000
	offset := min(clip.Duration()-minimumEffectDuration, document.Seconds(effect.Start*clip.Duration().Seconds()))
	duration := min(clip.Duration()-offset, document.Seconds(effect.Length.Fraction*clip.Duration().Seconds()))
	if effect.Length.Cap > 0 {
		duration = min(duration, document.Seconds(effect.Length.Cap))
	}
	params := maps.Clone(effect.Params)
	if effect.FPSParameter != "" {
		params[effect.FPSParameter] = max(2, math.Round(float64(fps)*0.1))
	}
	params, err := r.ResolveEffect(effect.ID, params, effect.Ramp)
	if err != nil {
		return document.EffectBlock{}, err
	}
	return document.EffectBlock{ID: fmt.Sprintf("%s/look/%d", clip.ID, index), TrackID: trackID,
		Preset: effect.ID, Start: clip.Start + offset, Duration: max(minimumEffectDuration, duration),
		Params: params, Ramp: effect.Ramp, OwnerClipID: clip.ID,
		Provenance: &document.Provenance{InstanceID: clip.ID, Rule: "look:" + clip.Look}}, nil
}

func (r Registry) MaterializeText(item document.TextItem, aspect string) (document.TextItem, error) {
	if item.Preset == "" {
		return item, nil
	}
	var preset *TextPreset
	for _, candidate := range r.TextPresets {
		if candidate.ID == item.Preset {
			preset = &candidate
			break
		}
	}
	if preset == nil {
		return item, fmt.Errorf("unknown text preset %q", item.Preset)
	}
	fields := maps.Clone(preset.Values)
	for _, key := range []string{"text", "duration", "start", "words"} {
		delete(fields, key)
	}
	for key, value := range item.Explicit {
		fields[key] = value
	}
	// Preset positions are authored in the landscape design space.
	for key, factor := range map[string]float64{"x": designWidth(aspect) / 1920, "y": designHeight(aspect) / 1080} {
		if _, explicit := item.Explicit[key]; explicit {
			continue
		}
		if raw, ok := fields[key]; ok {
			var position float64
			if err := json.Unmarshal(raw, &position); err != nil {
				return item, err
			}
			encoded, err := json.Marshal(position * factor)
			if err != nil {
				return item, err
			}
			fields[key] = encoded
		}
	}
	data, err := json.Marshal(fields)
	if err != nil {
		return item, err
	}
	var materialized document.TextItem
	if err := json.Unmarshal(data, &materialized); err != nil {
		return item, err
	}
	materialized.ID, materialized.Text = item.ID, item.Text
	materialized.Start, materialized.Duration = item.Start, item.Duration
	materialized.Words, materialized.SourceClipID = item.Words, item.SourceClipID
	materialized.Preset = ""
	materialized.Explicit = nil
	return materialized, nil
}

func designWidth(aspect string) float64 {
	if aspect == "portrait" {
		return 1080
	}
	if aspect == "classic" {
		return 1440
	}
	return 1920
}
func designHeight(aspect string) float64 {
	if aspect == "portrait" {
		return 1920
	}
	return 1080
}
