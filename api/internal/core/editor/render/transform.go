package render

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

const (
	minZoom         = 0.01 // keeps perspective math from dividing by zero
	maxZoom         = 40.0 // matches the editor slider ceiling
	minPosition     = -100.0
	maxPosition     = 100.0
	minRotation     = -180.0
	maxRotation     = 180.0
	minAnchor       = 0.0
	maxAnchor       = 1.0
	minTilt         = -90.0
	maxTilt         = 90.0
	keyframeMinSpan = 0.000001 // avoids div-by-zero on coincident keyframes
	keyframeTimeEps = 1e-9     // offsets below this are float noise
)

// shearPerRadian converts yaw/pitch degrees to shear; tuned to match preview.
const shearPerRadian = 0.55

func normalizeTransform(value *transform) transform {
	transform := transform{
		ZoomX: 1, ZoomY: 1, LinkZoom: true, AnchorX: 0.5, AnchorY: 0.5,
	}
	if value != nil {
		transform = *value
		if transform.ZoomX <= 0 || math.IsNaN(transform.ZoomX) || math.IsInf(transform.ZoomX, 0) {
			transform.ZoomX = 1
		}
		if transform.ZoomY <= 0 || math.IsNaN(transform.ZoomY) || math.IsInf(transform.ZoomY, 0) {
			transform.ZoomY = 1
		}
		if transform.LinkZoom {
			transform.ZoomY = transform.ZoomX
		}
		transform.ZoomX = max(minZoom, min(maxZoom, transform.ZoomX))
		transform.ZoomY = max(minZoom, min(maxZoom, transform.ZoomY))
		transform.PositionX = max(minPosition, min(maxPosition, transform.PositionX))
		transform.PositionY = max(minPosition, min(maxPosition, transform.PositionY))
		transform.Rotation = max(minRotation, min(maxRotation, transform.Rotation))
		transform.AnchorX = max(minAnchor, min(maxAnchor, transform.AnchorX))
		transform.AnchorY = max(minAnchor, min(maxAnchor, transform.AnchorY))
		transform.Pitch = max(minTilt, min(maxTilt, transform.Pitch))
		transform.Yaw = max(minTilt, min(maxTilt, transform.Yaw))
	}
	return transform
}

func normalizeKeyframes(keyframes []transformKeyframe) []transformKeyframe {
	points := make([]transformKeyframe, len(keyframes))
	copy(points, keyframes)
	sort.SliceStable(points, func(i, j int) bool { return points[i].Time < points[j].Time })
	for i := range points {
		points[i].Transform = normalizeTransform(&points[i].Transform)
		if points[i].Time < 0 || math.IsNaN(points[i].Time) || math.IsInf(points[i].Time, 0) {
			points[i].Time = 0
		}
	}
	return points
}

func getTransformValue(value string, transform transform) float64 {
	switch value {
	case "zoomX":
		return transform.ZoomX
	case "zoomY":
		return transform.ZoomY
	case "positionX":
		return transform.PositionX
	case "positionY":
		return transform.PositionY
	case "rotation":
		return transform.Rotation
	case "anchorX":
		return transform.AnchorX
	case "anchorY":
		return transform.AnchorY
	case "pitch":
		return transform.Pitch
	case "yaw":
		return transform.Yaw
	}
	return 0
}

func transformValueExpressionAt(value string, base transform, keyframes []transformKeyframe, time string) string {
	points := normalizeKeyframes(keyframes)

	if len(points) == 0 {
		return ff(getTransformValue(value, base))
	}

	expression := ff(getTransformValue(value, points[len(points)-1].Transform))

	for i := len(points) - 2; i >= 0; i-- {
		left, right := points[i], points[i+1]
		span := math.Max(keyframeMinSpan, right.Time-left.Time)
		leftValue, rightValue := getTransformValue(value, left.Transform), getTransformValue(value, right.Transform)

		interpolated := fmt.Sprintf("%s+(%s-%s)*(%s-%s)/%s", ff(leftValue), ff(rightValue), ff(leftValue), time, ff(left.Time), ff(span))
		expression = fmt.Sprintf("if(lt(%s,%s),%s,%s)", time, ff(right.Time), interpolated, expression)
	}

	firstValue := getTransformValue(value, points[0].Transform)
	return fmt.Sprintf("if(lt(%s,%s),%s,%s)", time, ff(points[0].Time), ff(firstValue), expression)
}

func transformValueExpression(value string, base transform, keyframes []transformKeyframe, segmentOffset float64) string {
	time := "t"
	if math.Abs(segmentOffset) > keyframeTimeEps {
		time = "(t+" + ff(segmentOffset) + ")"
	}
	return transformValueExpressionAt(value, base, keyframes, time)
}

func transformFrameValueExpression(value string, base transform, keyframes []transformKeyframe, segmentOffset float64, fps int) string {
	time := "on/" + ff(float64(fps))
	if math.Abs(segmentOffset) > keyframeTimeEps {
		time = "(" + time + "+" + ff(segmentOffset) + ")"
	}
	return transformValueExpressionAt(value, base, keyframes, time)
}

func transformValueAt(value string, base transform, keyframes []transformKeyframe, time float64) float64 {
	if len(keyframes) == 0 {
		return getTransformValue(value, base)
	}
	points := normalizeKeyframes(keyframes)
	if time <= points[0].Time {
		return getTransformValue(value, points[0].Transform)
	}
	for i := 1; i < len(points); i++ {
		if time > points[i].Time {
			continue
		}
		left, right := points[i-1], points[i]
		span := math.Max(keyframeMinSpan, right.Time-left.Time)
		amount := (time - left.Time) / span
		leftValue := getTransformValue(value, left.Transform)
		rightValue := getTransformValue(value, right.Transform)
		return leftValue + (rightValue-leftValue)*amount
	}
	return getTransformValue(value, points[len(points)-1].Transform)
}

const transformGuardPixels = 4 // pads perspective sampling so edges never read outside the frame

type transformExpressions struct {
	zoomX, zoomY         string
	positionX, positionY string
	anchorX, anchorY     string
	rotation             string
}

func buildTransformExpressions(base transform, keyframes []transformKeyframe, segmentOffset float64, fps int) transformExpressions {
	return transformExpressions{
		zoomX:     transformFrameValueExpression("zoomX", base, keyframes, segmentOffset, fps),
		zoomY:     transformFrameValueExpression("zoomY", base, keyframes, segmentOffset, fps),
		positionX: transformFrameValueExpression("positionX", base, keyframes, segmentOffset, fps),
		positionY: transformFrameValueExpression("positionY", base, keyframes, segmentOffset, fps),
		anchorX:   transformFrameValueExpression("anchorX", base, keyframes, segmentOffset, fps),
		anchorY:   transformFrameValueExpression("anchorY", base, keyframes, segmentOffset, fps),
		rotation:  transformValueExpression("rotation", base, keyframes, segmentOffset),
	}
}

func buildShearFilter(base transform, keyframes []transformKeyframe, segmentOffset, segmentDuration float64, fps int) string {
	shearAt := func(time float64) (float64, float64) {
		return -transformValueAt("yaw", base, keyframes, time) * math.Pi / 180 * shearPerRadian,
			-transformValueAt("pitch", base, keyframes, time) * math.Pi / 180 * shearPerRadian
	}
	firstShearX, firstShearY := shearAt(segmentOffset)
	shearFilter := fmt.Sprintf("shear@transform_shear=shx=%s:shy=%s:fillcolor=black", ff(firstShearX), ff(firstShearY))
	shearCommands := make([]string, 0)
	previousShearX, previousShearY := firstShearX, firstShearY
	frameCount := int(math.Ceil(math.Max(0, segmentDuration) * float64(fps)))
	for frame := 1; frame < frameCount; frame++ {
		time := float64(frame) / float64(fps)
		shearX, shearY := shearAt(segmentOffset + time)
		if shearX == previousShearX && shearY == previousShearY {
			continue
		}
		if shearX != previousShearX {
			shearCommands = append(shearCommands, fmt.Sprintf("%s shear@transform_shear shx %s", ff(time), ff(shearX)))
		}
		if shearY != previousShearY {
			shearCommands = append(shearCommands, fmt.Sprintf("%s shear@transform_shear shy %s", ff(time), ff(shearY)))
		}
		previousShearX, previousShearY = shearX, shearY
	}
	if len(shearCommands) == 0 {
		return shearFilter
	}
	return "sendcmd=c='" + strings.Join(shearCommands, ";") + "'," + shearFilter
}

func buildPerspectiveFilter(width, height int, expressions transformExpressions) string {
	guard := transformGuardPixels
	paddedWidth := width + guard*2
	paddedHeight := height + guard*2
	stageX := fmt.Sprintf("(%d/2+(%s)*%d/100)", width, expressions.positionX, width)
	stageY := fmt.Sprintf("(%d/2+(%s)*%d/100)", height, expressions.positionY, height)
	sourceX := func(outputX string) string {
		return fmt.Sprintf("(%s)*%d+(%s-%d-(%s))/(%s)+%d", expressions.anchorX, width, outputX, guard, stageX, expressions.zoomX, guard)
	}
	sourceY := func(outputY string) string {
		return fmt.Sprintf("(%s)*%d+(%s-%d-(%s))/(%s)+%d", expressions.anchorY, height, outputY, guard, stageY, expressions.zoomY, guard)
	}
	return fmt.Sprintf(
		`perspective=x0='%s':y0='%s':x1='%s':y1='%s':x2='%s':y2='%s':x3='%s':y3='%s':eval=frame:interpolation=cubic:sense=source`,
		sourceX("0"), sourceY("0"),
		sourceX(strconv.Itoa(paddedWidth)), sourceY("0"),
		sourceX("0"), sourceY(strconv.Itoa(paddedHeight)),
		sourceX(strconv.Itoa(paddedWidth)), sourceY(strconv.Itoa(paddedHeight)),
	)
}

func transformFlipFilters(base transform, keyframes []transformKeyframe) []string {
	first, last := base, base
	if len(keyframes) > 0 {
		ordered := append([]transformKeyframe(nil), keyframes...)
		sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Time < ordered[j].Time })
		first = normalizeTransform(&ordered[0].Transform)
		last = normalizeTransform(&ordered[len(ordered)-1].Transform)
	}

	filters := make([]string, 0, 2)
	if first.FlipH && last.FlipH {
		filters = append(filters, "hflip")
	}
	if first.FlipV && last.FlipV {
		filters = append(filters, "vflip")
	}
	return filters
}

func clipTransformFilter(clip clip, width, height int, segmentOffset, segmentDuration float64, fps int) string {
	if clip.Transform == nil && len(clip.TransformKeyframes) == 0 {
		return ""
	}
	base := normalizeTransform(clip.Transform)
	keyframes := clip.TransformKeyframes
	expressions := buildTransformExpressions(base, keyframes, segmentOffset, fps)
	guard := transformGuardPixels
	paddedWidth := width + guard*2
	paddedHeight := height + guard*2

	filters := []string{
		fmt.Sprintf("pad=%d:%d:%d:%d:color=black", paddedWidth, paddedHeight, guard, guard),
		buildPerspectiveFilter(width, height, expressions),
		fmt.Sprintf("crop=%d:%d:%d:%d", width, height, guard, guard),
		fmt.Sprintf(`rotate=a='(%s)*PI/180'
		:ow=%d
		:oh=%d
		:fillcolor=black`, expressions.rotation, width, height),
		buildShearFilter(base, keyframes, segmentOffset, segmentDuration, fps),
	}
	return strings.Join(append(filters, transformFlipFilters(base, keyframes)...), ",")
}
