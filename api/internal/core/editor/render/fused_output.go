package render

import (
	"fmt"
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
	if !plan.hasVideo || plan.output.format != outputMP4 || len(req.TextItems) > maxTextOverlaysPerPass || req.previewBlank {
		return false, nil
	}
	var args []string
	filter := fmt.Sprintf("setpts=N/(%d*TB)", plan.fps)
	if moving, part, direct := directVideoClip(req, plan); direct {
		path, err := plan.scope.join(moving.File)
		if err != nil {
			return true, err
		}
		filter, _, err = videoSegmentFilter(moving, part, req.Resolution.W, req.Resolution.H, plan.fps, req.Fit)
		if err != nil {
			return true, err
		}
		args = append(segmentInputArgs(part, moving.MediaKind), sceneDecoderArgs(moving)...)
		args = append(args, "-i", path)
	} else {
		if len(req.TextItems) == 0 || plan.videoClipCount == 0 {
			return false, nil
		}
		video, err := buildVideo(req, plan.videoClipCount, plan.fps, plan.totalDuration, work, progress, plan.scope)
		if err != nil {
			return true, err
		}
		args = []string{"-i", video}
	}
	audio, err := buildAudio(req.AudioChannels, plan.hasAudio, plan.totalDuration, work, progress, plan.scope)
	if err != nil {
		return true, err
	}
	args, err = fusedEncodingArgs(args, filter, req.TextItems, audio, work, plan, progress)
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
	return true, progress.runFFmpeg(duration, duration, "encoding fused final video/text", args...)
}

func fusedEncodingArgs(args []string, filter string, items []textItem, audio, work string, plan renderPlan, progress *renderProgress) ([]string, error) {
	filters := []string{"[0:v]" + filter + ",format=" + videoPixFmt + "[v0]"}
	chunk := textOverlayChunk{endFrame: int(math.Round(plan.totalDuration * float64(plan.fps)))}
	for index, item := range items {
		path := filepath.Join(work, fmt.Sprintf("fused_text_%d.png", index))
		if err := os.WriteFile(path, item.data, 0600); err != nil {
			return nil, fmt.Errorf("write fused text raster: %w", err)
		}
		args = append(args, "-i", path)
		filters = append(filters, fmt.Sprintf("[%d:v]format=rgba[text%d]", index+1, index),
			fmt.Sprintf("[v%d][text%d]overlay=x=%s:y=%s:eof_action=repeat:repeatlast=1:enable='%s'[v%d]", index, index, textOverlayX(item), textOverlayY(item), textOverlayFrameEnable(item, chunk, plan.fps), index+1))
	}
	if audio != "" {
		args = append(args, "-i", audio)
	}
	filters = append(filters, fmt.Sprintf("[v%d]format=%s[delivery]", len(items), videoPixFmt))
	args = append(args, "-filter_complex_threads", progress.filterThreads(), "-filter_complex", strings.Join(filters, ";"), "-map", "[delivery]")
	if audio != "" {
		args = append(args, "-map", strconv.Itoa(len(items)+1)+":a:0")
		args = append(args, plan.output.audioEncodingArgs()...)
	} else {
		args = append(args, "-an")
	}
	args = append(args, plan.output.videoEncodingArgs()...)
	return append(args, "-r", strconv.Itoa(plan.fps)), nil
}
