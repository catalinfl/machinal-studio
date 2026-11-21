package render

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	minPlaybackRate = 0.25 // atempo chains below this without quality loss
	maxPlaybackRate = 4.0
)

const (
	minClipOpacity = 0.0
	maxClipOpacity = 1.0
)

// fadeEps drops sub-microsecond fades from float rounding at clip edges.
const fadeEps = 0.000001

const (
	maxTextItems      = 200000   // 2,000 cues × 50 timed words × punch/hold frames
	maxTextImageBytes = 16 << 20 // 16 MB: single PNG must fit decoded in memory
	maxTextTotalBytes = 64 << 20 // 64 MB: caps total PNG payload per export
)

var validTextAnimations = map[string]bool{
	"slide-left":  true,
	"slide-right": true,
	"rise":        true,
	"pop":         true,
	"drop":        true,
	"bounce":      true,
	"shake":       true,
	"float":       true,
}

const (
	defaultAudioVolume = 100.0
	maxAudioVolume     = 200.0
)

const (
	minAtempoRate = 0.5 // ffmpeg atempo only accepts 0.5..2 per instance
	maxAtempoRate = 2.0
)

func sanitizePlaybackRate(rate float64) float64 {
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate <= 0 {
		return 1
	}
	return rate
}

func clipPlaybackRate(clip clip) float64 {
	if clip.PlaybackRate == nil {
		return 1
	}

	return sanitizePlaybackRate(*clip.PlaybackRate)
}

// clampTransitionOverlap bounds a transition overlap by the incoming clip
// duration and the accumulated timeline duration (shared by audio/video).
func clampTransitionOverlap(overlap, clipDur, accumulatedDur float64) float64 {
	if maxOverlap := clipDur - transitionEps; overlap > maxOverlap {
		overlap = maxOverlap
	}
	if maxOverlap := accumulatedDur - transitionEps; overlap > maxOverlap {
		overlap = maxOverlap
	}
	return overlap
}

func validatePlaybackRates(clips []clip) error {
	for _, clip := range clips {
		if clip.PlaybackRate == nil {
			continue
		}
		rate := *clip.PlaybackRate
		if math.IsNaN(rate) || math.IsInf(rate, 0) || rate < minPlaybackRate || rate > maxPlaybackRate {
			return fmt.Errorf("invalid playback rate %s: must be between %s and %s", ff(rate), ff(minPlaybackRate), ff(maxPlaybackRate))
		}
	}
	return nil
}

func validateClipCompositing(clips []clip) error {
	for _, clip := range clips {
		if clip.Opacity != nil {
			opacity := *clip.Opacity
			if math.IsNaN(opacity) || math.IsInf(opacity, 0) || opacity < minClipOpacity || opacity > maxClipOpacity {
				return fmt.Errorf("invalid clip opacity")
			}
		}
		for _, fade := range []*float64{clip.FadeIn, clip.FadeOut} {
			if fade == nil {
				continue
			}
			if math.IsNaN(*fade) || math.IsInf(*fade, 0) || *fade < 0 || *fade > clipDurT(clip) {
				return fmt.Errorf("invalid clip fade duration")
			}
		}
	}
	return nil
}

func clipSourceDur(clip clip) float64 { return clip.OutPoint - clip.InPoint }

func clipDurT(clip clip) float64 {
	return clipSourceDur(clip)/clipPlaybackRate(clip) - clip.previewPreroll
}

func clipEndT(clip clip) float64 { return clip.Start + clipDurT(clip) }

func clipVisualOpacity(clip clip) float64 {
	if clip.Opacity == nil {
		return 1
	}
	return max(0, min(1, *clip.Opacity))
}

func clipFadeDuration(value *float64, duration float64) float64 {
	if value == nil {
		return 0
	}
	fade := max(0, min(duration, *value))
	if fade < fadeEps {
		return 0
	}
	return fade
}

func clipFadeInDuration(clip clip) float64 { return clipFadeDuration(clip.FadeIn, clipDurT(clip)) }

func clipFadeOutDuration(clip clip) float64 { return clipFadeDuration(clip.FadeOut, clipDurT(clip)) }

// compositingEps distinguishes a real opacity/fade from float rounding.
const compositingEps = 1e-9

func hasClipCompositing(clip clip) bool {
	return clipVisualOpacity(clip) < 1-compositingEps || clipFadeInDuration(clip) > compositingEps || clipFadeOutDuration(clip) > compositingEps
}

func videoSegmentFrameCount(clip clip, segment segment, fps int) int {
	rate := clipPlaybackRate(clip)
	startFrame := math.Round(math.Max(0, (segment.SrcStart-clip.InPoint)/rate-clip.previewPreroll) * float64(fps))
	endFrame := math.Round(math.Max(0, (segment.SrcEnd-clip.InPoint)/rate-clip.previewPreroll) * float64(fps))
	return max(0, int(endFrame-startFrame))
}

func exactVideoFrameFilter(fps, frameCount int) string {
	return fmt.Sprintf("tpad=stop_mode=clone:stop=-1,trim=end_frame=%d,setpts=N/(%d*TB)", frameCount, fps)
}

func ff(value float64) string {
	// Keep floating-point noise out of FFmpeg arguments without changing timing math.
	rounded := math.Round(value*1e6) / 1e6
	if rounded == 0 {
		rounded = 0
	}
	return strconv.FormatFloat(rounded, 'f', -1, 64)
}

func prepareTextItems(items []textItem) error {
	if len(items) > maxTextItems {
		return fmt.Errorf("too many rendered text layers: at most %d", maxTextItems)
	}
	textBytes := 0
	for index := range items {
		item := &items[index]
		if err := validateTextTiming(item); err != nil {
			return err
		}
		if err := validateTextAnimation(item); err != nil {
			return err
		}
		decoded, err := decodeTextImage(item.Image)
		if err != nil {
			return err
		}
		if len(decoded) > maxTextImageBytes || textBytes+len(decoded) > maxTextTotalBytes {
			return fmt.Errorf("text image payload too large: at most %d bytes per image, %d total", maxTextImageBytes, maxTextTotalBytes)
		}
		textBytes += len(decoded)
		item.data = decoded
	}
	return nil
}

func validateTextTiming(item *textItem) error {
	if item.Start < 0 || item.Duration <= 0 || math.IsNaN(item.Start) || math.IsNaN(item.Duration) || math.IsInf(item.Start, 0) || math.IsInf(item.Duration, 0) {
		return fmt.Errorf("invalid text timing")
	}
	if item.MotionStart != nil && (*item.MotionStart < 0 || math.IsNaN(*item.MotionStart) || math.IsInf(*item.MotionStart, 0)) {
		return fmt.Errorf("invalid text motion start")
	}
	if item.MotionDuration != nil && (*item.MotionDuration <= 0 || math.IsNaN(*item.MotionDuration) || math.IsInf(*item.MotionDuration, 0)) {
		return fmt.Errorf("invalid text motion duration")
	}
	return nil
}

func validateTextAnimation(item *textItem) error {
	if item.Animation != "" && !validTextAnimations[item.Animation] {
		return fmt.Errorf("invalid text animation")
	}
	if item.Animation != "" && (item.AnimationDuration <= 0 || math.IsNaN(item.AnimationDuration) || math.IsInf(item.AnimationDuration, 0)) {
		return fmt.Errorf("invalid text animation duration")
	}
	return nil
}

func decodeTextImage(encoded string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || !bytes.HasPrefix(decoded, []byte("\x89PNG\r\n\x1a\n")) {
		return nil, fmt.Errorf("invalid text image")
	}
	return decoded, nil
}

func audioClipGain(clip clip) float64 {
	volume := defaultAudioVolume
	if clip.Volume != nil {
		volume = *clip.Volume
	}
	return max(0, min(maxAudioVolume, volume)) / 100
}

func audioVolumeFilter(clip clip) string {
	return "volume=" + ff(audioClipGain(clip))
}

func audioTempoFilter(rate float64) string {
	filters := make([]string, 0, 2)
	for rate < minAtempoRate {
		filters = append(filters, "atempo="+ff(minAtempoRate))
		rate /= minAtempoRate
	}
	for rate > maxAtempoRate {
		filters = append(filters, "atempo="+ff(maxAtempoRate))
		rate /= maxAtempoRate
	}
	filters = append(filters, "atempo="+ff(rate))
	return strings.Join(filters, ",")
}

func audioClipFilter(clip clip) string {
	filters := make([]string, 0, 2)
	if rate := clipPlaybackRate(clip); rate != 1 {
		filters = append(filters, audioTempoFilter(rate))
	}
	filters = append(filters, audioVolumeFilter(clip))
	return strings.Join(filters, ",")
}

func videoClipFilter(clip clip, effectFilter, scaleFilter string) string {
	filters := []string{"setpts=(PTS-STARTPTS)/" + ff(clipPlaybackRate(clip))}
	if effectFilter != "" {
		filters = append(filters, effectFilter)
	}
	filters = append(filters, scaleFilter)
	return strings.Join(filters, ",")
}
