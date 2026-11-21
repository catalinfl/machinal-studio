package ai

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"ffmpeg-go-server/internal/core/editor/render"
)

const (
	maxInstructionLength = 4000
	maxRevisionLength    = 100

	maxTrackCount      = 32
	maxClipCount       = 4000
	maxSourceCount     = 4000
	maxEffectCount     = 2000
	maxTransitionCount = 2000
	maxTextCount       = 2000

	minFPS = 1
	maxFPS = 240

	maxSourceIDLen        = 200
	maxSourceNameLen      = 512
	maxTrackNameLen       = 200
	maxDimension          = 16384
	minRampAmount         = 0.05
	maxTransformKeyframes = 64
)

type requestValidationContext struct {
	project         project
	sourcesByID     map[string]mediaSource
	sourcesByName   map[string]mediaSource
	tracksByID      map[string]track
	clipsByID       map[string]clipTarget
	effectsByID     map[string]effect
	transitionsByID map[string]transition
	textsByID       map[string]text
}

func newRequestValidationContext(project project) *requestValidationContext {
	return &requestValidationContext{
		project:         project,
		sourcesByID:     make(map[string]mediaSource, len(project.Sources)),
		sourcesByName:   make(map[string]mediaSource, len(project.Sources)),
		tracksByID:      make(map[string]track, len(project.Tracks)),
		clipsByID:       make(map[string]clipTarget),
		effectsByID:     make(map[string]effect, len(project.Effects)),
		transitionsByID: make(map[string]transition, len(project.Transitions)),
		textsByID:       make(map[string]text, len(project.Texts)),
	}
}

func validateRequest(request editRequest) error {
	if err := validateRequestFields(request); err != nil {
		return err
	}

	if err := validateProjectMetadata(request.Project); err != nil {
		return err
	}

	ctx := newRequestValidationContext(request.Project)

	if err := ctx.validateSources(); err != nil {
		return err
	}

	if err := ctx.validateTracks(); err != nil {
		return err
	}

	if err := ctx.validateEffects(); err != nil {
		return err
	}

	if err := ctx.validateTransitions(); err != nil {
		return err
	}

	if err := ctx.validateTexts(); err != nil {
		return err
	}

	return ctx.validateFocus()
}

func validateRequestFields(request editRequest) error {
	request.Instruction = strings.TrimSpace(request.Instruction)
	if request.Instruction == "" || len(request.Instruction) > maxInstructionLength {
		return fmt.Errorf("instruction must contain 1 to %d characters", maxInstructionLength)
	}
	if request.Revision == "" || len(request.Revision) > maxRevisionLength {
		return fmt.Errorf("invalid project revision")
	}
	return nil
}

func validateProjectMetadata(project project) error {
	if !finite(project.Duration) || project.Duration < 0 || project.Duration > maxTimeline {
		return fmt.Errorf("invalid project metadata")
	}
	if project.FPS < minFPS || project.FPS > maxFPS {
		return fmt.Errorf("invalid project metadata")
	}
	if !oneOf(project.Aspect, "landscape", "portrait", "classic") {
		return fmt.Errorf("invalid project metadata")
	}
	if len(project.Tracks) > maxTrackCount || len(project.Effects) > maxEffectCount || len(project.Transitions) > maxTransitionCount || len(project.Texts) > maxTextCount {
		return fmt.Errorf("timeline context is too large")
	}
	if len(project.Sources) > maxSourceCount {
		return fmt.Errorf("media source context is too large")
	}
	return nil
}

func (ctx *requestValidationContext) validateSources() error {
	for _, source := range ctx.project.Sources {
		if err := source.validate(); err != nil {
			return err
		}
		if _, ok := ctx.sourcesByID[source.ID]; ok {
			return fmt.Errorf("duplicate media source %q", source.Name)
		}
		if _, ok := ctx.sourcesByName[source.Name]; ok {
			return fmt.Errorf("duplicate media source %q", source.Name)
		}
		ctx.sourcesByID[source.ID] = source
		ctx.sourcesByName[source.Name] = source
	}
	return nil
}

func (ctx *requestValidationContext) validateTracks() error {
	clipCount := 0
	for _, track := range ctx.project.Tracks {
		if track.ID == "" {
			return fmt.Errorf("invalid or duplicate track ID")
		}
		if _, ok := ctx.tracksByID[track.ID]; ok {
			return fmt.Errorf("invalid or duplicate track ID")
		}
		if len(track.Name) > maxTrackNameLen {
			return fmt.Errorf("invalid or duplicate track ID")
		}
		if track.Type != trackTypeVideo && track.Type != trackTypeAudio {
			return fmt.Errorf("invalid or duplicate track ID")
		}
		ctx.tracksByID[track.ID] = track
		clipCount += len(track.Clips)
		for _, clip := range track.Clips {
			if err := clip.validate(); err != nil {
				return fmt.Errorf("invalid clip in track %s: %w", track.ID, err)
			}
			if _, ok := ctx.clipsByID[clip.ID]; ok {
				return fmt.Errorf("duplicate clip ID %q in track %s", clip.ID, track.ID)
			}
			if clip.MediaKind != "" && !clip.MediaKind.valid() {
				return fmt.Errorf("invalid clip metadata in track %s", track.ID)
			}
			if clip.Volume != nil && !validVolume(*clip.Volume) {
				return fmt.Errorf("invalid clip metadata in track %s", track.ID)
			}
			if err := validateTransform(clip.Transform); err != nil {
				return fmt.Errorf("invalid transform on clip %s: %w", clip.ID, err)
			}
			if len(clip.TransformKeyframes) > 0 {
				if err := validateTransform(&transform{Keyframes: clip.TransformKeyframes}); err != nil {
					return fmt.Errorf("invalid transform keyframes on clip %s: %w", clip.ID, err)
				}
			}
			if clip.MotionPreset != "" && !presetID(transformPresets, clip.MotionPreset) {
				return fmt.Errorf("invalid motion preset on clip %s", clip.ID)
			}
			ctx.clipsByID[clip.ID] = clipTarget{Track: track, Clip: clip}
		}
	}
	if clipCount > maxClipCount {
		return fmt.Errorf("timeline contains too many clips")
	}
	for _, track := range ctx.project.Tracks {
		for _, clip := range track.Clips {
			if clip.LinkedID != "" {
				if _, ok := ctx.clipsByID[clip.LinkedID]; !ok {
					return fmt.Errorf("clip %s references an unknown linked clip", clip.ID)
				}
			}
		}
	}
	return ctx.validateSourceClipReferences()
}

func (ctx *requestValidationContext) validateSourceClipReferences() error {
	for _, source := range ctx.project.Sources {
		seenTimelineClips := make(map[string]bool)
		for _, clipID := range source.TimelineClipIDs {
			if _, ok := ctx.clipsByID[clipID]; !ok || seenTimelineClips[clipID] {
				return fmt.Errorf("media source %s has invalid timeline clip references", source.Name)
			}
			seenTimelineClips[clipID] = true
		}
	}
	return nil
}

func (ctx *requestValidationContext) validateEffects() error {
	for _, effect := range ctx.project.Effects {
		if effect.ID == "" {
			return fmt.Errorf("invalid or duplicate effect block")
		}
		if _, dup := ctx.effectsByID[effect.ID]; dup {
			return fmt.Errorf("invalid or duplicate effect block")
		}
		track, trackOK := ctx.tracksByID[effect.TrackID]
		if !trackOK || track.Type != trackTypeVideo {
			return fmt.Errorf("invalid or duplicate effect block")
		}
		if !validTimedItem(effect.Start, effect.Duration) {
			return fmt.Errorf("invalid or duplicate effect block")
		}
		if err := render.ValidateEffect(effect.Preset, effect.Params); err != nil {
			return fmt.Errorf("invalid effect block %s: %w", effect.ID, err)
		}
		if effect.OwnerID != "" {
			if _, ok := ctx.clipsByID[effect.OwnerID]; !ok {
				return fmt.Errorf("effect block %s has an unknown owner clip", effect.ID)
			}
		}
		if err := validateEffectRamp(effect); err != nil {
			return err
		}
		ctx.effectsByID[effect.ID] = effect
	}
	return nil
}

func validateEffectRamp(effect effect) error {
	if effect.Ramp == nil {
		return nil
	}
	if !oneOf(effect.Ramp.Mode, "in", "out", "in-out") || !oneOf(effect.Ramp.Curve, "linear", "ease-in", "ease-out", "ease-in-out") {
		return fmt.Errorf("effect block %s has an invalid ramp", effect.ID)
	}
	if !finite(effect.Ramp.Amount) || effect.Ramp.Amount < minRampAmount || effect.Ramp.Amount > 1 {
		return fmt.Errorf("effect block %s has an invalid ramp", effect.ID)
	}
	return nil
}

func (ctx *requestValidationContext) validateTransitions() error {
	for _, transition := range ctx.project.Transitions {
		if transition.ID == "" {
			return fmt.Errorf("invalid or duplicate transition")
		}
		if _, dup := ctx.transitionsByID[transition.ID]; dup {
			return fmt.Errorf("invalid or duplicate transition")
		}
		track, trackOK := ctx.tracksByID[transition.TrackID]
		if !trackOK || track.Type != trackTypeVideo {
			return fmt.Errorf("invalid or duplicate transition")
		}
		if _, leftOK := ctx.clipsByID[transition.LeftClipID]; !leftOK {
			return fmt.Errorf("invalid or duplicate transition")
		}
		if _, rightOK := ctx.clipsByID[transition.RightClipID]; !rightOK {
			return fmt.Errorf("invalid or duplicate transition")
		}
		if _, presetOK := transitionPresets[transition.Preset]; !presetOK {
			return fmt.Errorf("invalid or duplicate transition")
		}
		if !finite(transition.Duration) || transition.Duration < 0 {
			return fmt.Errorf("invalid or duplicate transition")
		}
		ctx.transitionsByID[transition.ID] = transition
	}
	return nil
}

func (ctx *requestValidationContext) validateTexts() error {
	for _, text := range ctx.project.Texts {
		if text.ID == "" {
			return fmt.Errorf("invalid or duplicate text item")
		}
		if _, ok := ctx.textsByID[text.ID]; ok {
			return fmt.Errorf("invalid or duplicate text item")
		}
		if !validTimedItem(text.Start, text.Duration) {
			return fmt.Errorf("invalid or duplicate text item")
		}
		if len(text.Text) > maxTextLen {
			return fmt.Errorf("invalid or duplicate text item")
		}
		ctx.textsByID[text.ID] = text
	}
	return nil
}

func (ctx *requestValidationContext) validateFocus() error {
	if !finite(ctx.project.Focus.Playhead) {
		return fmt.Errorf("invalid editor focus")
	}
	if ctx.project.Focus.Playhead < 0 || ctx.project.Focus.Playhead > ctx.project.Duration+timingEpsilon {
		return fmt.Errorf("invalid editor focus")
	}
	for _, id := range ctx.project.Focus.SelectedClipIDs {
		if _, ok := ctx.clipsByID[id]; !ok {
			return fmt.Errorf("editor focus references an unknown clip")
		}
	}
	for _, id := range ctx.project.Focus.SelectedTrackIDs {
		if _, ok := ctx.tracksByID[id]; !ok {
			return fmt.Errorf("editor focus references an unknown track")
		}
	}
	for _, id := range ctx.project.Focus.SelectedEffectIDs {
		if _, ok := ctx.effectsByID[id]; !ok {
			return fmt.Errorf("editor focus references an unknown effect")
		}
	}
	for _, id := range ctx.project.Focus.SelectedTextIDs {
		if _, ok := ctx.textsByID[id]; !ok {
			return fmt.Errorf("editor focus references unknown text")
		}
	}
	return nil
}

// validate checks the value rules of a media source. Duplicate detection is
// left to the caller because it needs the seen-ID/name maps.
func (source mediaSource) validate() error {
	switch {
	case source.ID == "" || len(source.ID) > maxSourceIDLen:
		return fmt.Errorf("media source has an invalid ID")
	case source.Name == "" || len(source.Name) > maxSourceNameLen:
		return fmt.Errorf("media source has an invalid name")
	case !source.Kind.valid():
		return fmt.Errorf("media source has an invalid kind")
	case source.SourceMode != "" && !oneOf(source.SourceMode, "proxy", "wasm"):
		return fmt.Errorf("media source has an invalid source mode")
	case !finite(source.Duration) || source.Duration <= 0 || source.Duration > maxTimeline:
		return fmt.Errorf("media source has an invalid duration")
	case source.Width < 0 || source.Width > maxDimension || source.Height < 0 || source.Height > maxDimension:
		return fmt.Errorf("media source has invalid dimensions")
	case source.Kind != mediaKindAudio && (source.Width == 0) != (source.Height == 0):
		return fmt.Errorf("visual media source %s has invalid dimensions", source.Name)
	}
	return nil
}

// validate checks the value rules of a clip. Duplicate detection is left to
// the caller because it needs the seen-ID map.
func (clip clip) validate() error {
	switch {
	case clip.ID == "":
		return fmt.Errorf("missing clip ID")
	case !finite(clip.Start, clip.End, clip.SourceIn, clip.SourceOut, clip.SourceDuration, clip.Rate):
		return fmt.Errorf("clip timing contains a non-finite number")
	case clip.Start < 0 || clip.End <= clip.Start:
		return fmt.Errorf("clip has an invalid start/end window")
	case clip.SourceIn < 0 || clip.SourceOut <= clip.SourceIn:
		return fmt.Errorf("clip has an invalid source window")
	case clip.SourceDuration < 0:
		return fmt.Errorf("clip has a negative source duration")
	case clip.SourceDuration > 0 && clip.SourceOut > clip.SourceDuration+timingEpsilon:
		return fmt.Errorf("clip source window exceeds the source duration")
	case clip.Rate < minPlaybackRate || clip.Rate > maxPlaybackRate:
		return fmt.Errorf("clip playback rate is out of range")
	}
	return nil
}

func trackByID(tracks []track, id string) (track, bool) {
	for _, track := range tracks {
		if track.ID == id {
			return track, true
		}
	}
	return track{}, false
}

type clipTarget struct {
	Track track
	Clip  clip
}

func clipTargets(project project) map[string]clipTarget {
	result := make(map[string]clipTarget)
	for _, track := range project.Tracks {
		for _, clip := range track.Clips {
			result[clip.ID] = clipTarget{Track: track, Clip: clip}
		}
	}
	return result
}

func sourceByName(sources []mediaSource, name string) (mediaSource, bool) {
	for _, source := range sources {
		if strings.EqualFold(source.Name, name) {
			return source, true
		}
	}
	return mediaSource{}, false
}

func sourceByID(sources []mediaSource, id string) (mediaSource, bool) {
	for _, source := range sources {
		if source.ID == id {
			return source, true
		}
	}
	return mediaSource{}, false
}

func clipSourceDuration(project project, clip clip) float64 {
	if clip.SourceID != "" {
		if source, ok := sourceByID(project.Sources, clip.SourceID); ok {
			return source.Duration
		}
	}
	if source, ok := sourceByName(project.Sources, clip.Name); ok {
		return source.Duration
	}
	if clip.SourceDuration > 0 {
		return clip.SourceDuration
	}
	return clip.SourceOut
}

func sourceForClip(project project, clip clip) (mediaSource, bool) {
	matchesKind := func(source mediaSource) bool { return clip.MediaKind == "" || clip.MediaKind == source.Kind }
	for _, source := range project.Sources {
		if slices.Contains(source.TimelineClipIDs, clip.ID) && matchesKind(source) {
			return source, true
		}
	}
	if clip.SourceID != "" {
		if source, ok := sourceByID(project.Sources, clip.SourceID); ok && matchesKind(source) {
			return source, true
		}
	}
	if source, ok := sourceByName(project.Sources, clip.Name); ok && matchesKind(source) {
		return source, true
	}
	return mediaSource{}, false
}

func clipMediaKind(project project, clip clip) mediaKind {
	if clip.MediaKind != "" {
		return clip.MediaKind
	}
	if source, ok := sourceForClip(project, clip); ok {
		return source.Kind
	}
	return ""
}

func maxTransitionOverlap(project project, left, right clip) float64 {
	shorter := math.Min(left.End-left.Start, right.End-right.Start)
	if clipMediaKind(project, left) == mediaKindImage && clipMediaKind(project, right) == mediaKindImage {
		return math.Max(0, shorter/2)
	}
	return math.Max(0, (shorter-minItemDuration)/2)
}

func validTransformZoom(v float64) bool     { return v >= 0.01 && v <= 40 }
func validTransformPosition(v float64) bool { return v >= -100 && v <= 100 }
func validTransformRotation(v float64) bool { return v >= -180 && v <= 180 }
func validTransformAnchor(v float64) bool   { return v >= 0 && v <= 1 }
func validTransformTilt(v float64) bool     { return v >= -90 && v <= 90 }

func hasAnyTransformField(t *transform) bool {
	return t.ZoomX != nil || t.ZoomY != nil || t.LinkZoom != nil || t.PositionX != nil ||
		t.PositionY != nil || t.Rotation != nil || t.AnchorX != nil || t.AnchorY != nil ||
		t.Pitch != nil || t.Yaw != nil || t.FlipH != nil || t.FlipV != nil || len(t.Keyframes) > 0
}

func validateTransform(transform *transform) error {
	if transform == nil {
		return nil
	}
	values := []*float64{transform.ZoomX, transform.ZoomY, transform.PositionX, transform.PositionY, transform.Rotation, transform.AnchorX, transform.AnchorY, transform.Pitch, transform.Yaw}
	for _, value := range values {
		if value != nil && !finite(*value) {
			return fmt.Errorf("transform contains a non-finite number")
		}
	}
	if transform.ZoomX != nil && !validTransformZoom(*transform.ZoomX) || transform.ZoomY != nil && !validTransformZoom(*transform.ZoomY) {
		return fmt.Errorf("transform zoom is out of range")
	}
	if transform.PositionX != nil && !validTransformPosition(*transform.PositionX) || transform.PositionY != nil && !validTransformPosition(*transform.PositionY) {
		return fmt.Errorf("transform position is out of range")
	}
	if transform.Rotation != nil && !validTransformRotation(*transform.Rotation) || transform.AnchorX != nil && !validTransformAnchor(*transform.AnchorX) || transform.AnchorY != nil && !validTransformAnchor(*transform.AnchorY) {
		return fmt.Errorf("transform rotation or anchor is out of range")
	}
	if transform.Pitch != nil && !validTransformTilt(*transform.Pitch) || transform.Yaw != nil && !validTransformTilt(*transform.Yaw) {
		return fmt.Errorf("transform tilt is out of range")
	}
	if !hasAnyTransformField(transform) {
		return fmt.Errorf("empty transform update")
	}
	if len(transform.Keyframes) > maxTransformKeyframes {
		return fmt.Errorf("too many transform keyframes")
	}
	previous := -1.0
	for _, keyframe := range transform.Keyframes {
		if !finite(keyframe.Time) || keyframe.Time < 0 || keyframe.Time <= previous {
			return fmt.Errorf("transform keyframe times must be increasing")
		}
		if err := validateTransform(&keyframe.Transform); err != nil {
			return fmt.Errorf("invalid transform keyframe: %w", err)
		}
		previous = keyframe.Time
	}
	return nil
}

func validateClipWindow(project project, target clipTarget, start, sourceIn, sourceOut, rate float64) error {
	sourceDuration := clipSourceDuration(project, target.Clip)
	if !finite(start, sourceIn, sourceOut, rate) {
		return fmt.Errorf("invalid clip source window or playback rate")
	}
	if start < 0 || sourceIn < 0 || sourceOut <= sourceIn {
		return fmt.Errorf("invalid clip source window or playback rate")
	}
	if rate < minPlaybackRate || rate > maxPlaybackRate || sourceOut > sourceDuration+timingEpsilon {
		return fmt.Errorf("invalid clip source window or playback rate")
	}
	duration := (sourceOut - sourceIn) / rate
	if duration < minItemDuration {
		return fmt.Errorf("clip timing is out of range")
	}
	if !validTimelinePosition(start, start+duration) {
		return fmt.Errorf("clip timing is out of range")
	}
	return nil
}
