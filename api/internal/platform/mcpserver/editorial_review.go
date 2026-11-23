package mcpserver

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

const editorialDetailLimit = 64

type editorialJunction struct {
	TrackID     string  `json:"trackId"`
	LeftClipID  string  `json:"leftClipId"`
	RightClipID string  `json:"rightClipId"`
	Kind        string  `json:"kind"`
	Preset      string  `json:"preset,omitempty"`
	Start       float64 `json:"startSeconds"`
	Duration    float64 `json:"durationSeconds"`
}

type editorialTreatment struct {
	Kind     string  `json:"kind"`
	ID       string  `json:"id"`
	Preset   string  `json:"preset"`
	TrackID  string  `json:"trackId"`
	ClipID   string  `json:"clipId,omitempty"`
	Start    float64 `json:"startSeconds"`
	Duration float64 `json:"durationSeconds"`
	Origin   string  `json:"origin,omitempty"`
}

type editorialReview struct {
	Status           string                `json:"status"`
	Evidence         string                `json:"evidence"`
	VisualInspection bool                  `json:"visualInspection"`
	VisualClips      int                   `json:"visualClips"`
	TotalJunctions   int                   `json:"totalJunctions"`
	TotalTreatments  int                   `json:"totalTreatments"`
	Truncated        bool                  `json:"truncated"`
	Junctions        []editorialJunction   `json:"junctions"`
	Treatments       []editorialTreatment  `json:"treatments"`
	Notices          []document.Diagnostic `json:"notices"`
	Limitations      string                `json:"limitations"`
}

func attachEditorialReview(output Output) Output {
	if output.StatusCode != 200 {
		return output
	}
	fields, ok := output.Data.(map[string]any)
	if !ok {
		return output
	}
	encoded, err := json.Marshal(fields)
	if err != nil {
		return output
	}
	var result composition.Result
	if json.Unmarshal(encoded, &result) != nil {
		return output
	}
	review := newEditorialReview()
	if result.Composition != nil && len(result.Requirements) == 0 && !hasEditorialCompileErrors(result.Diagnostics) {
		review = reviewEditorialPlan(*result.Composition)
	}
	// The original compiler result remains authoritative and must fit the MCP envelope.
	reviewBytes, err := json.Marshal(review)
	if err != nil {
		return output
	}
	const fieldOverhead = len(`,"editorialReview":`)
	if len(encoded)+len(reviewBytes)+fieldOverhead > MaxResultBytes {
		review.Junctions, review.Treatments = []editorialJunction{}, []editorialTreatment{}
		review.Truncated = true
		reviewBytes, err = json.Marshal(review)
		if err != nil || len(encoded)+len(reviewBytes)+fieldOverhead > MaxResultBytes {
			return output
		}
	}
	fields["editorialReview"] = review
	return output
}

func hasEditorialCompileErrors(diagnostics []document.Diagnostic) bool {
	return slices.ContainsFunc(diagnostics, func(diagnostic document.Diagnostic) bool { return diagnostic.Severity == "error" })
}

func newEditorialReview() editorialReview {
	return editorialReview{
		Status: "not_ready", Evidence: "normalized-plan", Junctions: []editorialJunction{},
		Treatments: []editorialTreatment{}, Notices: []document.Diagnostic{},
		Limitations: "Recipe-level evidence only, not aesthetic approval. Scene-internal animation/effects, source pixels, occlusion and audio have not been inspected. Hidden tracks and zero-opacity clips are excluded; other occlusion is not inferred. Compare this inventory with the production contract in the current client; inspect frames/video only with available tools and appropriate approval.",
	}
}

func reviewEditorialPlan(plan composition.Composition) editorialReview {
	review := newEditorialReview()
	review.Status = "review_required"
	visibleTracks := make(map[string]bool)
	visibleClips := make(map[string]bool)
	for _, track := range plan.Tracks {
		if track.Type != "video" || track.Hidden {
			continue
		}
		visibleTracks[track.ID] = true
		clips := slices.DeleteFunc(slices.Clone(track.Clips), func(clip document.Clip) bool { return clip.Opacity <= 0 })
		slices.SortFunc(clips, func(left, right document.Clip) int {
			if left.Start < right.Start {
				return -1
			}
			if left.Start > right.Start {
				return 1
			}
			return strings.Compare(left.ID, right.ID)
		})
		review.VisualClips += len(clips)
		for index, clip := range clips {
			visibleClips[clip.ID] = true
			review.Treatments = append(review.Treatments, clipEditorialTreatments(track.ID, clip)...)
			if index > 0 {
				review.Junctions = append(review.Junctions, reviewJunction(track.ID, clips[index-1], clip, plan.Transitions))
			}
		}
	}
	for _, effect := range plan.Effects {
		if !visibleTracks[effect.TrackID] || effect.OwnerClipID != "" && !visibleClips[effect.OwnerClipID] {
			continue
		}
		origin := "effect"
		if effect.Provenance != nil && strings.HasPrefix(effect.Provenance.Rule, "look:") {
			origin = effect.Provenance.Rule
		}
		review.Treatments = append(review.Treatments, editorialTreatment{Kind: "effect", ID: effect.ID, Preset: effect.Preset,
			TrackID: effect.TrackID, ClipID: effect.OwnerClipID, Start: effect.Start.Seconds(), Duration: effect.Duration.Seconds(), Origin: origin})
	}
	review.Notices = editorialNotices(review, plan)
	review.TotalJunctions, review.TotalTreatments = len(review.Junctions), len(review.Treatments)
	review.Truncated = review.TotalJunctions > editorialDetailLimit || review.TotalTreatments > editorialDetailLimit
	review.Junctions = review.Junctions[:min(len(review.Junctions), editorialDetailLimit)]
	review.Treatments = review.Treatments[:min(len(review.Treatments), editorialDetailLimit)]
	return review
}

func clipEditorialTreatments(trackID string, clip document.Clip) []editorialTreatment {
	result := []editorialTreatment{}
	for _, selected := range []struct{ kind, preset string }{{"look", clip.Look}, {"motion", clip.Motion}} {
		if selected.preset != "" {
			result = append(result, editorialTreatment{Kind: selected.kind, ID: clip.ID, Preset: selected.preset,
				TrackID: trackID, ClipID: clip.ID, Start: clip.Start.Seconds(), Duration: clip.Duration().Seconds()})
		}
	}
	if clip.Motion == "" && len(clip.TransformKeyframes) > 1 {
		result = append(result, editorialTreatment{Kind: "motion", ID: clip.ID, Preset: "transform-keyframes",
			TrackID: trackID, ClipID: clip.ID, Start: clip.Start.Seconds(), Duration: clip.Duration().Seconds(), Origin: "resolved-keyframes"})
	}
	return result
}

func reviewJunction(trackID string, left, right document.Clip, transitions []document.Transition) editorialJunction {
	junction := editorialJunction{TrackID: trackID, LeftClipID: left.ID, RightClipID: right.ID, Kind: "cut", Start: right.Start.Seconds()}
	overlap := left.End() - right.Start
	if overlap < 0 {
		junction.Kind, junction.Start, junction.Duration = "gap", left.End().Seconds(), (-overlap).Seconds()
		return junction
	}
	if overlap == 0 {
		return junction
	}
	junction.Kind, junction.Preset, junction.Duration = "implicit-transition", "cross-dissolve", overlap.Seconds()
	for _, transition := range transitions {
		if transition.TrackID == trackID && transition.LeftClipID == left.ID && transition.RightClipID == right.ID {
			junction.Kind, junction.Preset = "transition", transition.Preset
			break
		}
	}
	return junction
}

func editorialNotices(review editorialReview, plan composition.Composition) []document.Diagnostic {
	notices := []document.Diagnostic{}
	if len(review.Junctions) > 0 && !slices.ContainsFunc(review.Junctions, func(junction editorialJunction) bool { return junction.Kind != "cut" }) {
		notices = append(notices, document.Diagnostic{Code: "all_junctions_are_cuts", Severity: "info", Path: "editorialReview.junctions",
			Message: "Every same-track junction is a hard cut. Keep motivated cuts, but implement any transitions promised in the production contract; omission is not an editorial decision."})
	}
	if review.VisualClips > 0 && !slices.ContainsFunc(review.Treatments, func(treatment editorialTreatment) bool { return treatment.Kind == "effect" }) {
		notices = append(notices, document.Diagnostic{Code: "no_recipe_effects", Severity: "info", Path: "editorialReview.treatments",
			Message: "No recipe-level visual effects are present on visible video tracks. Check the effect score; scene-internal effects are unknown, and intentionally untreated/minimal edits are valid."})
	}
	assetsByID := make(map[string]document.Asset, len(plan.Assets))
	for _, asset := range plan.Assets {
		assetsByID[asset.ID] = asset
	}
	var maxVideoEnd, maxNarrationEnd document.Time
	allStaticImages := len(plan.Assets) > 0 && review.VisualClips > 0
	exposedBlackBars := false
	for _, track := range plan.Tracks {
		if track.Type == "video" && !track.Hidden {
			for _, clip := range track.Clips {
				if clip.Opacity <= 0 {
					continue
				}
				if end := clip.End(); end > maxVideoEnd {
					maxVideoEnd = end
				}
				asset, exists := assetsByID[clip.AssetID]
				if !exists || asset.Kind != "image" {
					allStaticImages = false
				}
				if clip.Opacity >= 1 && !exposedBlackBars {
					if editorialTransformExposesBlackBars(clip.Transform) || slices.ContainsFunc(clip.TransformKeyframes, func(kf document.Keyframe) bool { return editorialTransformExposesBlackBars(kf.Transform) }) {
						exposedBlackBars = true
					}
				}
			}
		}
		if track.Type == "audio" && !track.Muted && !track.Hidden {
			isNarrationTrack := track.ID == "recipe/audio/narration" || strings.Contains(strings.ToLower(track.Name+" "+track.ID), "narration")
			for _, clip := range track.Clips {
				if clip.Volume <= 0 {
					continue
				}
				asset, exists := assetsByID[clip.AssetID]
				if !exists || asset.Kind != "audio" {
					continue
				}
				isNarration := isNarrationTrack || strings.HasPrefix(asset.File, "voice_")
				if !isNarration {
					continue
				}
				if end := clip.End(); end > maxNarrationEnd {
					maxNarrationEnd = end
				}
				if asset.Duration > 0 && (clip.InPoint > document.Seconds(0.15) || clip.OutPoint < asset.Duration-document.Seconds(0.15)) {
					notices = append(notices, document.Diagnostic{
						Code: "narration_audio_truncated", Severity: "warning", Path: "tracks." + track.ID + "." + clip.ID,
						Message: fmt.Sprintf("Narration clip %q uses %.2fs–%.2fs of %s (full duration %.2fs). Extend outPoint and video timeline so speech is not cut off.", clip.ID, clip.InPoint.Seconds(), clip.OutPoint.Seconds(), asset.File, asset.Duration.Seconds()),
					})
				}
			}
		}
	}
	if maxNarrationEnd > 0 && maxVideoEnd > 0 && maxVideoEnd < maxNarrationEnd-document.Seconds(0.1) {
		notices = append(notices, document.Diagnostic{
			Code: "video_shorter_than_narration", Severity: "warning", Path: "editorialReview.tracks",
			Message: fmt.Sprintf("Visible video ends at %.2fs while narration continues until %.2fs. Extend visual clips/scenes to cover the full narration.", maxVideoEnd.Seconds(), maxNarrationEnd.Seconds()),
		})
	}
	if exposedBlackBars {
		notices = append(notices, document.Diagnostic{
			Code: "transform_exposes_black_bars", Severity: "warning", Path: "editorialReview.treatments",
			Message: "A video clip transform pans beyond the edge-safe margin of its zoom (positionX/positionY are percentages -100..100, not pixels; keep |pos| <= 50*(zoom-1) or use built-in edge-safe motion presets).",
		})
	}
	if slices.ContainsFunc(plan.TextItems, func(item document.TextItem) bool {
		return item.IsCaption && item.StrokeWidth == 0 && item.BackgroundOpacity == 0
	}) {
		notices = append(notices, document.Diagnostic{
			Code: "low_contrast_captions", Severity: "warning", Path: "editorialReview.texts",
			Message: "Captions have zero strokeWidth and zero backgroundOpacity, making text washed out over bright or detailed video. Add a dark pill background or stroke.",
		})
	}
	if allStaticImages {
		notices = append(notices, document.Diagnostic{
			Code: "static_images_without_scenes", Severity: "info", Path: "editorialReview.tracks",
			Message: "All visible video clips are static images with no Svelte/Hyperframes scenes. Unless a photo-only slideshow was requested, discover installed Hyperframes templates via get_library_reference(topic=component-discovery) and compile animated scenes with compile_scene.",
		})
	}
	return notices
}

func editorialTransformExposesBlackBars(t document.Transform) bool {
	if t.ZoomX < 1 || t.ZoomY < 1 || t.Rotation != 0 || t.Pitch != 0 || t.Yaw != 0 {
		return false
	}
	if t.PositionX == 0 && t.PositionY == 0 {
		return false
	}
	if t.PositionX <= -50 || t.PositionX >= 50 || t.PositionY <= -50 || t.PositionY >= 50 {
		return false
	}
	minX, maxX := (0.5-(1-t.AnchorX)*t.ZoomX)*100, (t.AnchorX*t.ZoomX-0.5)*100
	minY, maxY := (0.5-(1-t.AnchorY)*t.ZoomY)*100, (t.AnchorY*t.ZoomY-0.5)*100
	const eps = 0.05
	return t.PositionX < minX-eps || t.PositionX > maxX+eps || t.PositionY < minY-eps || t.PositionY > maxY+eps
}
