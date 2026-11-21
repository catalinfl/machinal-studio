package compiler

import (
	"fmt"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/document"
)

func (s *compilation) validateRules() {
	seen := make(map[string]bool)
	for index, rule := range s.input.Document.Rules {
		path := fmt.Sprintf("rules[%d]", index)
		if rule.ID == "" || seen[rule.ID] {
			s.fail(path+".id", "rule_identity", "rules need unique nonempty ids")
		}
		seen[rule.ID] = true
		if !slices.Contains([]string{"video", "image"}, rule.Target.Kind) {
			s.fail(path+".target.kind", "invalid_selector", "rules require a video or image selector")
		}
		if !slices.Contains([]string{"", "all", "first", "last", "nth"}, rule.Target.Position) ||
			rule.Target.Position == "nth" && rule.Target.Index < 1 {
			s.fail(path+".target.position", "invalid_selector", "position must be all, first, last or a 1-based nth")
		}
		if rule.Apply.Look == "" && rule.Apply.Motion == "" && rule.Apply.Effect == nil {
			s.fail(path+".apply", "empty_rule", "rule needs a look, motion or effect")
		}
		s.validatePresets(rule.Apply.Look, rule.Apply.Motion, path+".apply")
		if effect := rule.Apply.Effect; effect != nil {
			if _, err := s.compiler.Catalog.ResolveEffect(effect.Preset, effect.Params, effect.Ramp); err != nil {
				s.fail(path+".apply.effect", "invalid_effect", err.Error())
			}
		}
	}
}

func (s *compilation) applyRules() {
	for index, rule := range s.input.Document.Rules {
		path := fmt.Sprintf("rules[%d].target", index)
		ids := s.resolveSelector(rule.Target)
		if len(ids) == 0 {
			s.fail(path, "empty_selector", "rule matched no clips on the timeline")
			continue
		}
		for _, id := range ids {
			track, clip := s.findClip(id)
			if track == nil || track.Locked {
				s.fail(path, "locked_track", "rule cannot edit a locked track")
				continue
			}
			if rule.Apply.Look != "" {
				clip.Look = rule.Apply.Look
			}
			if rule.Apply.Motion != "" {
				clip.Motion = rule.Apply.Motion
			}
			if effect := rule.Apply.Effect; effect != nil {
				blockID := fmt.Sprintf("rule/%s/%s", rule.ID, clip.ID)
				s.composition.Effects = slices.DeleteFunc(s.composition.Effects, func(block document.EffectBlock) bool {
					return block.ID == blockID || block.OwnerClipID == clip.ID && block.Preset == effect.Preset &&
						(block.Provenance == nil || !strings.HasPrefix(block.Provenance.Rule, "look:"))
				})
				s.composition.Effects = append(s.composition.Effects, document.EffectBlock{
					ID: blockID, TrackID: track.ID, OwnerClipID: clip.ID, Preset: effect.Preset,
					Start: clip.Start, Duration: clip.Duration(), Params: effect.Params, Ramp: effect.Ramp,
					Provenance: &document.Provenance{InstanceID: s.input.Document.InstanceID, Rule: "rule:" + rule.ID},
				})
			}
		}
	}
}

func (s *compilation) validatePlacements() {
	jobs := make(map[string]document.Job)
	for _, job := range s.input.Document.Before {
		jobs[job.ID] = job
	}
	for index, placement := range s.input.Document.Placements {
		path := fmt.Sprintf("placements[%d]", index)
		job, exists := jobs[placement.Job]
		if !exists || !slices.Contains([]string{"image.generate", "speech.generate", "scene.generate", "scene.edit"}, job.Type) {
			s.fail(path+".job", "invalid_placement", "placement needs an image, speech or scene job from before")
		}
		if placement.Track.Type != "video" && placement.Track.Type != "audio" || placement.Track.Role == "" {
			s.fail(path+".track", "invalid_track", "placement needs a video or audio track with a role")
		}
		if exists && (job.Type != "speech.generate" && placement.Track.Type != "video" || job.Type == "speech.generate" && placement.Track.Type != "audio") {
			s.fail(path+".track", "incompatible_media", "generated media cannot be placed on this track")
		}
		if placement.Start < 0 || placement.Duration < 0 || job.Type == "image.generate" && placementDuration(placement, job) < MinimumClipDuration {
			s.fail(path, "invalid_interval", "placement needs a nonnegative start and image duration of at least 100ms")
		}
		if placement.Transform != nil {
			if placement.Track.Type != "video" {
				s.fail(path+".transform", "incompatible_transform", "placement transforms require a video track")
			}
			s.verifyTransform(*placement.Transform, path+".transform")
		}
	}
}

func (s *compilation) placeGenerated() {
	jobs := make(map[string]document.Job)
	for _, job := range s.input.Document.Before {
		jobs[job.ID] = job
	}
	for trackIndex := range s.composition.Tracks {
		track := &s.composition.Tracks[trackIndex]
		track.Clips = slices.DeleteFunc(track.Clips, func(clip document.Clip) bool {
			return clip.Provenance != nil && slices.ContainsFunc(s.input.Document.Placements, func(placement document.Placement) bool {
				return clip.Provenance.Rule == "job:"+placement.Job
			})
		})
	}
	for index, placement := range s.input.Document.Placements {
		path := fmt.Sprintf("placements[%d]", index)
		job := jobs[placement.Job]
		asset, exists := s.assets[job.ResultAssetID]
		if !exists || job.ResultAssetID == "" {
			s.fail(path+".job", "missing_result", "generated asset is missing")
			continue
		}
		duration := placementDuration(placement, job)
		if duration == 0 {
			duration = asset.Duration
		}
		if duration < MinimumClipDuration || asset.Kind != "image" && duration > asset.Duration {
			s.fail(path+".duration", "source_bounds", "placement duration does not fit the generated asset")
			continue
		}
		trackID := "recipe/" + placement.Track.Type + "/" + placement.Track.Role
		trackIndex := slices.IndexFunc(s.composition.Tracks, func(track document.Track) bool { return track.ID == trackID })
		if trackIndex < 0 {
			s.composition.Tracks = append(s.composition.Tracks, document.Track{ID: trackID, Name: placement.Track.Role, Type: placement.Track.Type, Clips: []document.Clip{}})
			trackIndex = len(s.composition.Tracks) - 1
		}
		track := &s.composition.Tracks[trackIndex]
		if track.Type != placement.Track.Type || track.Locked {
			s.fail(path+".track", "invalid_track", "generated track is incompatible or locked")
			continue
		}
		clip := sequenceClip("recipe/"+job.ID+"/placement/"+fmt.Sprint(index), asset, document.Treatment{
			Take: document.Take{Duration: duration}, Rate: 1,
		})
		clip.Start = placement.Start
		if placement.Transform != nil {
			clip.Transform = *placement.Transform
		}
		clip.Provenance = &document.Provenance{InstanceID: s.input.Document.InstanceID, Rule: "job:" + job.ID}
		track.Clips = append(track.Clips, clip)
		s.placeSceneNarration(job, trackIndex, len(track.Clips)-1, placement.Track.Role)
	}
}

func (s *compilation) placeSceneNarration(job document.Job, videoTrack, videoClip int, role string) {
	if job.ResultAudioAssetID == "" {
		return
	}
	asset, exists := s.assets[job.ResultAudioAssetID]
	if !exists {
		return
	}
	video := s.composition.Tracks[videoTrack].Clips[videoClip]
	trackID := "recipe/audio/" + role + "/narration"
	index := slices.IndexFunc(s.composition.Tracks, func(track document.Track) bool { return track.ID == trackID })
	if index < 0 {
		s.composition.Tracks = append(s.composition.Tracks, document.Track{ID: trackID, Name: "Scene narration", Type: "audio", Clips: []document.Clip{}})
		index = len(s.composition.Tracks) - 1
	}
	track := &s.composition.Tracks[index]
	if track.Locked || track.Type != "audio" {
		s.fail("jobs."+job.ID, "invalid_track", "scene narration track is incompatible or locked")
		return
	}
	audio := sequenceClip(video.ID+"/audio", asset, document.Treatment{Take: document.Take{From: job.AudioStart, Duration: min(video.Duration(), asset.Duration-job.AudioStart)}, Rate: 1})
	audio.Start, audio.LinkedClipID, audio.Provenance = video.Start, video.ID, video.Provenance
	s.composition.Tracks[videoTrack].Clips[videoClip].LinkedClipID = audio.ID
	track.Clips = append(track.Clips, audio)
}

func placementDuration(placement document.Placement, job document.Job) document.Time {
	if placement.Duration != 0 {
		return placement.Duration
	}
	return job.Duration
}
