package render

import (
	"math"
	"slices"
	"sort"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	textengine "ffmpeg-go-server/editengine/text"
)

type previewWork struct {
	start float64
	end   float64
}

func previewRequest(req renderRequest, window PreviewWindow) (renderRequest, PreviewWindow) {
	req.FPS = normalizedFPS(req.FPS)
	hadVideo := len(req.VideoChannels) > 0 || len(req.TextItems) > 0
	work := previewWork{start: math.Floor(window.Start*float64(req.FPS)+1e-7) / float64(req.FPS), end: math.Ceil((window.Start+window.Duration)*float64(req.FPS)-1e-7) / float64(req.FPS)}
	target := work
	req.VideoChannels = previewChannels(req.VideoChannels, target, &work, true)
	req.AudioChannels = previewChannels(req.AudioChannels, target, &work, false)
	for _, channels := range [][]channel{req.VideoChannels, req.AudioChannels} {
		for index := range channels {
			for clipIndex := range channels[index].Clips {
				channels[index].Clips[clipIndex].Start -= work.start
			}
		}
	}
	items := make([]textItem, 0)
	for _, item := range req.TextItems {
		if item.Start >= window.Start+window.Duration || item.Start+item.Duration <= window.Start {
			continue
		}
		motionStart, motionDuration := textMotionWindow(item)
		end := min(item.Start+item.Duration, work.end)
		item.Start = max(item.Start, work.start) - work.start
		item.Duration = end - work.start - item.Start
		localMotionStart := max(0, motionStart-work.start)
		item.motionOffset = min(0, motionStart-work.start)
		item.MotionStart, item.MotionDuration = &localMotionStart, &motionDuration
		items = append(items, item)
	}
	req.TextItems = items
	req.previewBlank = hadVideo && len(req.VideoChannels) == 0 && len(items) == 0
	duration := work.end - work.start
	req.Duration = &duration
	return req, PreviewWindow{Start: window.Start - work.start, Duration: window.Duration}
}

func previewChannels(channels []channel, target previewWork, work *previewWork, video bool) []channel {
	result := make([]channel, 0, len(channels))
	for _, track := range channels {
		clips := slices.Clone(track.Clips)
		sort.SliceStable(clips, func(i, j int) bool { return clips[i].Start < clips[j].Start })
		kept := channel{}
		indices := make(map[int]int)
		for _, group := range groupOverlapping(clips) {
			last := group[1]
			if clips[group[0]].Start >= target.end || clipEndT(clips[last]) <= target.start {
				continue
			}
			for index := group[0]; index <= last; index++ {
				moving := clips[index]
				if group[0] == last && previewCanTrim(moving) {
					start := max(moving.Start, target.start)
					end := min(clipEndT(moving), target.end)
					if video && moving.MediaKind != "image" {
						// Preserve the original decoder/fps sampling phase; discard
						// preroll only after cadence conversion, before writing frames.
						moving.previewPreroll = start - moving.Start
						moving.OutPoint = moving.InPoint + (end-moving.Start)*clipPlaybackRate(moving)
					} else {
						moving.InPoint += (start - moving.Start) * clipPlaybackRate(moving)
						moving.OutPoint = moving.InPoint + (end-start)*clipPlaybackRate(moving)
					}
					moving.Start, moving.Segments = start, nil
				}
				work.start = min(work.start, moving.Start)
				work.end = max(work.end, clipEndT(moving))
				indices[index] = len(kept.Clips)
				kept.Clips = append(kept.Clips, moving)
			}
		}
		for _, transition := range track.Transitions {
			if right, ok := indices[transition.RightClipIndex]; ok && right > 0 {
				transition.RightClipIndex = right
				kept.Transitions = append(kept.Transitions, transition)
			}
		}
		if len(kept.Clips) > 0 {
			result = append(result, kept)
		}
	}
	return result
}

func previewCanTrim(moving clip) bool {
	if clipPlaybackRate(moving) != 1 || clipFadeInDuration(moving) > 0 || clipFadeOutDuration(moving) > 0 || len(moving.TransformKeyframes) > 0 {
		return false
	}
	for _, part := range moving.Segments {
		if len(part.Effects) > 0 {
			return false
		}
	}
	return true
}

// PreviewProcessingDuration reports timeline work including conservative temporal
// dependencies; it does not change the source composition or any caption entry.
func PreviewProcessingDuration(resolved composition.Composition, window PreviewWindow) (float64, error) {
	resolved.TextItems = nil
	req, err := compositionRequest(resolved)
	if err != nil {
		return 0, err
	}
	req, _ = previewRequest(req, window)
	return *req.Duration, nil
}

func PreviewSourceFiles(resolved composition.Composition, window PreviewWindow) (map[string]bool, error) {
	resolved.TextItems = nil
	req, err := compositionRequest(resolved)
	if err != nil {
		return nil, err
	}
	req, _ = previewRequest(req, window)
	files := make(map[string]bool)
	for _, moving := range collectAllClips(req) {
		files[moving.File] = true
	}
	return files, nil
}

func PreviewTextComposition(resolved composition.Composition, window PreviewWindow) (composition.Composition, error) {
	items := make([]document.TextItem, 0)
	for _, item := range resolved.TextItems {
		if item.Start.Seconds() < window.Start+window.Duration && (item.Start+item.Duration).Seconds() > window.Start {
			items = append(items, item)
		}
	}
	prepared, err := resolved.PreparedText.Resolve(resolved.TextItems, resolved.Output)
	resolved.TextItems = items
	key, keyErr := textengine.SourceKey(items, resolved.Output)
	if keyErr != nil {
		return resolved, keyErr
	}
	resolved.TextRenderKey, resolved.PreparedText = key, nil
	if err == nil {
		overlays := make([]textengine.Overlay, 0)
		for _, overlay := range prepared {
			if overlay.Start.Seconds() < window.Start+window.Duration && (overlay.Start+overlay.Duration).Seconds() > window.Start {
				overlays = append(overlays, overlay)
			}
		}
		resolved.PreparedText = &textengine.Prepared{Key: key, Overlays: overlays}
	}
	return resolved, nil
}
