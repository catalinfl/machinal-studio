package ai

import (
	"fmt"
	"math"
	"slices"
)

const (
	// 1920x1080 design canvas; portrait swaps axes, classic narrows width.
	// Bounds keep model-placed text on canvas instead of off-screen.
	landscapeCanvasWidth  = 1920.0
	landscapeCanvasHeight = 1080.0
	portraitCanvasWidth   = 1080.0
	portraitCanvasHeight  = 1920.0
	classicCanvasWidth    = 1440.0

	minFontSize = 8.0
	maxFontSize = 600.0

	maxStrokeWidth       = 40.0
	maxBackgroundPadding = 200.0
	maxBackgroundRadius  = 200.0
	minRotationDegrees   = -180.0
	maxRotationDegrees   = 180.0

	minTextAnimationDuration = 0.1
	maxTextAnimationDuration = 2.0
)

var (
	textAlignValues      = []string{"left", "center", "right", "justify"}
	textBannerStyles     = []string{"none", "rail", "block", "underline"}
	textAnimationValues  = []string{"none", "slide-left", "slide-right", "rise", "pop", "drop", "bounce", "shake", "float"}
	textHighlightModes   = []string{"none", "word"}
	textHighlightAnimations = []string{"pop", "bounce", "slide-up", "glow", "none"}
	textFontFamilyValues = []string{"sans", "system", "roboto", "open-sans", "lato", "montserrat", "oswald", "helvetica", "verdana", "trebuchet", "tahoma", "arial-black", "serif", "playfair-display", "merriweather", "times", "palatino", "mono", "roboto-mono", "lucida-console", "display", "comic-sans"}
)

func floatPtr(value float64) *float64 { return new(value) }
func intPtr(value int) *int           { return new(value) }
func boolPtr(value bool) *bool        { return new(value) }
func stringPtr(value string) *string  { return new(value) }

func valueOr(value *float64, fallback float64) float64 {
	if value == nil {
		return fallback
	}
	return *value
}

func presetID(presets []presetInfo, id string) bool {
	for _, preset := range presets {
		if preset.ID == id {
			return true
		}
	}
	return false
}

func hasEditOperationFields(operation editOperation, allowed ...string) bool {
	fields := make(map[string]bool, len(allowed))
	for _, field := range allowed {
		fields[field] = true
	}
	used := map[string]bool{
		"start":        operation.Start != nil,
		"end":          operation.End != nil,
		"duration":     operation.Duration != nil,
		"time":         operation.Time != nil,
		"delta":        operation.Delta != nil,
		"channelIds":   operation.ChannelIDs != nil,
		"channelId":    operation.ChannelID != "",
		"blockId":      operation.BlockID != "",
		"clipId":       operation.ClipID != "",
		"sourceId":     operation.SourceID != "",
		"resultId":     operation.ResultID != "",
		"sourceIn":     operation.SourceIn != nil,
		"sourceOut":    operation.SourceOut != nil,
		"inPoint":      operation.InPoint != nil,
		"outPoint":     operation.OutPoint != nil,
		"playbackRate": operation.PlaybackRate != nil,
		"volume":       operation.Volume != nil,
		"includeAudio": operation.IncludeAudio != nil,
		"transform":    operation.Transform != nil,
		"motionPreset": operation.MotionPreset != "",
		"presetId":     operation.PresetID != "",
		"leftClipId":   operation.LeftClipID != "",
		"rightClipId":  operation.RightClipID != "",
		"count":        operation.Count != nil,
		"effectId":     operation.EffectID != "",
		"params":       operation.Params != nil,
		"textId":       operation.TextID != "",
		"text":         operation.Text != nil,
		"textPresetId": operation.TextPresetID != "",
		"style":        operation.Style != nil,
	}
	for field, present := range used {
		if present && !fields[field] {
			return false
		}
	}
	return true
}

func validTimedItem(start, duration float64) bool {
	return finite(start, duration, start+duration) && start >= 0 && duration >= 0.2 && start+duration <= maxTimeline
}

func findText(texts []text, id string) text {
	for _, text := range texts {
		if text.ID == id {
			return text
		}
	}
	return text{}
}

func approxEqual(a, b float64) bool {
	return math.Abs(a-b) <= timingEpsilon
}

func finite(values ...float64) bool {
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

func validateTextStyle(style *textStyle, aspect string) error {
	if style == nil {
		return nil
	}
	if err := validateTextNumbers(style); err != nil {
		return err
	}
	if err := validateTextRanges(style, aspect); err != nil {
		return err
	}
	if err := validateTextEnums(style); err != nil {
		return err
	}
	return validateTextColors(style)
}

func validateTextNumbers(style *textStyle) error {
	for _, value := range []*float64{style.X, style.Y, style.FontSize, style.StrokeWidth, style.BackgroundOpacity, style.BackgroundPadding, style.BackgroundRadius, style.AnimationDuration, style.Opacity, style.Rotation} {
		if value != nil && !finite(*value) {
			return fmt.Errorf("text style contains a non-finite number")
		}
	}
	return nil
}

func textCanvasSize(aspect string) (float64, float64) {
	width, height := landscapeCanvasWidth, landscapeCanvasHeight
	switch aspect {
	case "portrait":
		width, height = portraitCanvasWidth, portraitCanvasHeight
	case "classic":
		width = classicCanvasWidth
	}
	return width, height
}

func validateTextRanges(style *textStyle, aspect string) error {
	width, height := textCanvasSize(aspect)
	if outOfRange(style.X, 0, width) || outOfRange(style.Y, 0, height) || outOfRange(style.FontSize, minFontSize, maxFontSize) {
		return fmt.Errorf("text style value is out of range")
	}
	if outOfRange(style.StrokeWidth, 0, maxStrokeWidth) || !unitValue(style.BackgroundOpacity) || !unitValue(style.Opacity) || !unitValue(style.HighlightBackgroundOpacity) {
		return fmt.Errorf("text style value is out of range")
	}
	if outOfRange(style.BackgroundPadding, 0, maxBackgroundPadding) || outOfRange(style.BackgroundRadius, 0, maxBackgroundRadius) || outOfRange(style.Rotation, minRotationDegrees, maxRotationDegrees) {
		return fmt.Errorf("text style value is out of range")
	}
	if outOfRange(style.AnimationDuration, minTextAnimationDuration, maxTextAnimationDuration) {
		return fmt.Errorf("text style value is out of range")
	}
	return nil
}

func outOfRange(value *float64, min, max float64) bool {
	return value != nil && (*value < min || *value > max)
}

func validateTextEnums(style *textStyle) error {
	if style.FontWeight != nil && *style.FontWeight != 400 && *style.FontWeight != 700 {
		return fmt.Errorf("invalid text font weight")
	}
	if style.Align != nil && !oneOf(*style.Align, textAlignValues...) {
		return fmt.Errorf("invalid text alignment")
	}
	if style.FontFamily != nil && !oneOf(*style.FontFamily, textFontFamilyValues...) {
		return fmt.Errorf("invalid text font family")
	}
	if style.BannerStyle != nil && !oneOf(*style.BannerStyle, textBannerStyles...) {
		return fmt.Errorf("invalid text banner style")
	}
	if style.Animation != nil && !oneOf(*style.Animation, textAnimationValues...) {
		return fmt.Errorf("invalid text animation")
	}
	if style.HighlightMode != nil && !oneOf(*style.HighlightMode, textHighlightModes...) {
		return fmt.Errorf("invalid text highlight mode")
	}
	if style.HighlightAnimation != nil && !oneOf(*style.HighlightAnimation, textHighlightAnimations...) {
		return fmt.Errorf("invalid text highlight animation")
	}
	return nil
}

func validateTextColors(style *textStyle) error {
	for _, color := range []*string{style.Color, style.StrokeColor, style.BackgroundColor, style.AccentColor, style.HighlightColor, style.HighlightBackgroundColor} {
		if color != nil && !validHexColor(*color) {
			return fmt.Errorf("text colors must use #RRGGBB or #RRGGBBAA")
		}
	}
	return nil
}

func unitValue(value *float64) bool { return value == nil || *value >= 0 && *value <= 1 }

func oneOf(value string, allowed ...string) bool { return slices.Contains(allowed, value) }

func validHexColor(value string) bool {
	if (len(value) != 7 && len(value) != 9) || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if !(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f') && !(char >= 'A' && char <= 'F') {
			return false
		}
	}
	return true
}
