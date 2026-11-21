package render

import (
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func directVideoClip(req renderRequest, plan renderPlan) (clip, segment, bool) {
	if plan.videoClipCount != 1 {
		return clip{}, segment{}, false
	}
	for _, channel := range req.VideoChannels {
		if len(channel.Clips) != 1 || len(channel.Transitions) > 0 {
			continue
		}
		moving := channel.Clips[0]
		if moving.sceneTransparent || hasClipCompositing(moving) || math.Abs(moving.Start) > fadeEps || math.Abs(clipDurT(moving)-plan.totalDuration) > fadeEps {
			return clip{}, segment{}, false
		}
		part := segment{SrcStart: moving.InPoint, SrcEnd: moving.OutPoint}
		if len(moving.Segments) > 0 {
			if len(moving.Segments) != 1 || moving.Segments[0].SrcStart != part.SrcStart || moving.Segments[0].SrcEnd != part.SrcEnd {
				return clip{}, segment{}, false
			}
			part = moving.Segments[0]
		}
		return moving, part, true
	}
	return clip{}, segment{}, false
}

func renderFusedOutput(req renderRequest, plan renderPlan, work, outputPath string, progress *renderProgress) (bool, error) {
	if !plan.hasVideo || plan.output.format != outputMP4 || req.previewBlank {
		return false, nil
	}
	frames := int(math.Round(plan.totalDuration * float64(plan.fps)))
	textInputs, ok := planFusedTextInputs(req.TextItems, req.Resolution.W, req.Resolution.H, plan.fps, frames)
	if !ok {
		return false, nil
	}
	moving, part, direct := directVideoClip(req, plan)
	usesTextLayer := false
	for _, input := range textInputs {
		usesTextLayer = usesTextLayer || len(input.layer.spans) > 0
	}
	if !direct && (len(textInputs) == 0 || (plan.videoClipCount == 0 && !usesTextLayer)) {
		return false, nil
	}
	if usesTextLayer {
		// Leave the caller's staging directory untouched if concat options are unsupported.
		var err error
		work, err = os.MkdirTemp(work, "fused_")
		if err != nil {
			return true, fmt.Errorf("create fused render work dir: %w", err)
		}
	}
	args, filter, err := fusedVideoInput(req, plan, moving, part, direct, frames, work, progress)
	if err != nil {
		return true, err
	}
	audio, err := buildAudio(req.AudioChannels, plan.hasAudio, plan.totalDuration, work, progress, plan.scope)
	if err != nil {
		return true, err
	}
	message := "encoding fused final video/text"
	if usesTextLayer {
		message = "encoding video with caption layer"
	}
	args, err = fusedEncodingArgs(args, filter, req.TextItems, textInputs, audio, work, plan, frames, progress)
	if err != nil {
		return true, err
	}
	duration := plan.totalDuration
	if progress != nil {
		if window, ok := PreviewFromContext(progress.ctx); ok {
			args = append(args, "-ss", ff(window.Start))
			duration = window.Duration
		}
	}
	args = append(args, "-t", ff(duration), "-movflags", "+faststart", "-y", outputPath)
	err = progress.runFFmpeg(duration, duration, message, args...)
	if err != nil && usesTextLayer && strings.Contains(err.Error(), "unknown keyword 'option'") {
		// Older FFmpeg builds may not support per-file concat options.
		log.Print("render_caption_layer fallback=unsupported_concat_options")
		_ = os.Remove(outputPath)
		return false, nil
	}
	return true, err
}

func fusedVideoInput(req renderRequest, plan renderPlan, moving clip, part segment, direct bool, frames int, work string, progress *renderProgress) ([]string, string, error) {
	if direct {
		path, err := plan.scope.join(moving.File)
		if err != nil {
			return nil, "", err
		}
		filter, _, err := videoSegmentFilter(moving, part, req.Resolution.W, req.Resolution.H, plan.fps, req.Fit)
		args := append(segmentInputArgs(part, moving.MediaKind), sceneDecoderArgs(moving)...)
		return append(args, "-i", path), filter, err
	}
	filter := fmt.Sprintf("setpts=N/(%d*TB)", plan.fps)
	if plan.videoClipCount == 0 {
		source := fmt.Sprintf("color=c=black:s=%dx%d:r=%d", req.Resolution.W, req.Resolution.H, plan.fps)
		return []string{"-f", "lavfi", "-i", source}, fmt.Sprintf("trim=end_frame=%d,%s", frames, filter), nil
	}
	video, err := buildVideo(req, plan.videoClipCount, plan.fps, plan.totalDuration, work, progress, plan.scope)
	return []string{"-i", video}, filter, err
}

func fusedEncodingArgs(args []string, filter string, items []textItem, inputs []fusedTextInput, audio, work string, plan renderPlan, frames int, progress *renderProgress) ([]string, error) {
	filters := []string{"[0:v]" + filter + ",format=" + videoPixFmt + "[v0]"}
	chunk := textOverlayChunk{endFrame: frames}
	for index, input := range inputs {
		inputArgs, options, err := fusedTextOverlay(items, input, chunk, plan.fps, work, progress)
		if err != nil {
			return nil, err
		}
		args = append(args, inputArgs...)
		filters = append(filters, fmt.Sprintf("[%d:v]format=rgba[text%d]", index+1, index),
			fmt.Sprintf("[v%d][text%d]overlay=%s:eof_action=repeat:repeatlast=1[v%d]", index, index, options, index+1))
	}
	filters = append(filters, fmt.Sprintf("[v%d]format=%s[delivery]", len(inputs), videoPixFmt))
	return finishFusedEncodingArgs(args, filters, audio, len(inputs)+1, plan, progress), nil
}

func fusedTextOverlay(items []textItem, input fusedTextInput, chunk textOverlayChunk, fps int, work string, progress *renderProgress) ([]string, string, error) {
	if len(input.layer.spans) > 0 {
		dir := filepath.Join(work, fmt.Sprintf("caption_layer_%d", input.index))
		path, err := prepareTextLayer(items[input.index:], input.layer, fps, chunk.endFrame, dir, progress)
		if err != nil {
			return nil, "", err
		}
		// Per-file frame rate options require safe=0. All manifest entries are generated names.
		args := []string{"-protocol_whitelist", "file", "-f", "concat", "-safe", "0", "-i", path}
		origin := input.layer.bounds.Min
		return args, fmt.Sprintf("x=%d:y=%d", origin.X, origin.Y), nil
	}
	item := items[input.index]
	path := filepath.Join(work, fmt.Sprintf("fused_text_%d.png", input.index))
	if err := os.WriteFile(path, item.data, 0o600); err != nil {
		return nil, "", fmt.Errorf("write fused text raster: %w", err)
	}
	options := fmt.Sprintf("x=%s:y=%s:enable='%s'", textOverlayX(item), textOverlayY(item), textOverlayFrameEnable(item, chunk, fps))
	return []string{"-i", path}, options, nil
}

func finishFusedEncodingArgs(args, filters []string, audio string, audioIndex int, plan renderPlan, progress *renderProgress) []string {
	if audio != "" {
		args = append(args, "-i", audio)
	}
	args = append(args, "-filter_complex_threads", progress.filterThreads(), "-filter_complex", strings.Join(filters, ";"), "-map", "[delivery]")
	if audio != "" {
		args = append(args, "-map", strconv.Itoa(audioIndex)+":a:0")
		args = append(args, plan.output.audioEncodingArgs()...)
	} else {
		args = append(args, "-an")
	}
	args = append(args, plan.output.videoEncodingArgs()...)
	return append(args, "-r", strconv.Itoa(plan.fps))
}
