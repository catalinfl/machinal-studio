package render

import (
	"fmt"
	"math"
	"path/filepath"
	"strconv"
	"strings"

	"ffmpeg-go-server/editengine/document"
)

type windowedTransition struct {
	groupIndex int
	leftClip   int
	rightClip  int
	frames     int
	duration   float64
	xfade      string
}

type windowedClipSlices struct {
	headSegments []segment
	bodySegments []segment
	tailSegments []segment
}

type windowedGroup struct {
	startIndex  int
	endIndex    int
	windowed    bool
	transitions []windowedTransition
}

type windowedVideoTask struct {
	clipIndex    int
	role         string // "head", "body", "tail", "full"
	segmentIndex int
	clip         clip
	segment      segment
}

func cloneEffectsWithRampShift(effects []effect, shiftSeconds float64) []effect {
	if len(effects) == 0 {
		return nil
	}
	cloned := make([]effect, len(effects))
	for i, item := range effects {
		cloned[i] = item
		if item.Ramp != nil {
			r := *item.Ramp
			r.Offset += shiftSeconds
			cloned[i].Ramp = &r
		}
	}
	return cloned
}

// splitSegmentsAt divides clip segments at source-time boundary splitSrc,
// keeping ramped effect offsets continuous across the split.
func splitSegmentsAt(segments []segment, splitSrc, playbackRate float64) (left, right []segment) {
	const eps = 1e-7
	for _, part := range segments {
		switch {
		case part.SrcEnd <= splitSrc+eps:
			left = append(left, part)
		case part.SrcStart >= splitSrc-eps:
			right = append(right, part)
		default:
			left = append(left, segment{
				SrcStart: part.SrcStart,
				SrcEnd:   splitSrc,
				Effects:  cloneEffectsWithRampShift(part.Effects, 0),
			})
			shift := (splitSrc - part.SrcStart) / playbackRate
			right = append(right, segment{
				SrcStart: splitSrc,
				SrcEnd:   part.SrcEnd,
				Effects:  cloneEffectsWithRampShift(part.Effects, shift),
			})
		}
	}
	return left, right
}

func clipBaseSegments(moving clip) []segment {
	if len(moving.Segments) > 0 {
		return moving.Segments
	}
	return []segment{{SrcStart: moving.InPoint, SrcEnd: moving.OutPoint}}
}

func planWindowedGroup(groupIndex int, startIndex, endIndex int, clips []clip, fps int, xfadeByRight map[int]string) (windowedGroup, map[int]windowedClipSlices) {
	group := windowedGroup{startIndex: startIndex, endIndex: endIndex}
	groupClips := clips[startIndex : endIndex+1]
	if len(groupClips) < 2 {
		return group, nil
	}

	overlaps := make([]float64, len(groupClips))
	overlapFrames := make([]int, len(groupClips))
	accumulated := clipDurT(groupClips[0])
	for i := 1; i < len(groupClips); i++ {
		if groupClips[i-1].previewPreroll > 0 || groupClips[i].previewPreroll > 0 {
			return group, nil
		}
		ov := clampTransitionOverlap(clipEndT(groupClips[i-1])-groupClips[i].Start, clipDurT(groupClips[i]), accumulated)
		frames := int(math.Round(ov * float64(fps)))
		if ov <= transitionEps || frames < 1 {
			return group, nil
		}
		overlaps[i] = ov
		overlapFrames[i] = frames
		accumulated += clipDurT(groupClips[i]) - ov
	}

	slicesByClip := make(map[int]windowedClipSlices, len(groupClips))
	for i, moving := range groupClips {
		inFrames := 0
		if i > 0 {
			inFrames = overlapFrames[i]
		}
		outFrames := 0
		if i+1 < len(groupClips) {
			outFrames = overlapFrames[i+1]
		}
		totalFrames := videoSegmentFrameCount(moving, segment{SrcStart: moving.InPoint, SrcEnd: moving.OutPoint}, fps)
		if inFrames+outFrames >= totalFrames {
			// Adjacent transitions collide or leave no body frames: fall back to chained xfadeGroup.
			return group, nil
		}

		rate := clipPlaybackRate(moving)
		remaining := clipBaseSegments(moving)
		var head, body, tail []segment
		if inFrames > 0 {
			splitIn := moving.InPoint + (float64(inFrames)/float64(fps))*rate
			head, remaining = splitSegmentsAt(remaining, splitIn, rate)
			if len(head) == 0 || len(remaining) == 0 {
				return group, nil
			}
		}
		if outFrames > 0 {
			splitOut := moving.InPoint + (float64(totalFrames-outFrames)/float64(fps))*rate
			body, tail = splitSegmentsAt(remaining, splitOut, rate)
			if len(body) == 0 || len(tail) == 0 {
				return group, nil
			}
		} else {
			body = remaining
		}
		slicesByClip[startIndex+i] = windowedClipSlices{
			headSegments: head,
			bodySegments: body,
			tailSegments: tail,
		}
	}

	transitions := make([]windowedTransition, 0, len(groupClips)-1)
	for i := 1; i < len(groupClips); i++ {
		frames := overlapFrames[i]
		transitions = append(transitions, windowedTransition{
			groupIndex: groupIndex,
			leftClip:   startIndex + i - 1,
			rightClip:  startIndex + i,
			frames:     frames,
			duration:   float64(frames) / float64(fps),
			xfade:      xfadeByRight[startIndex+i],
		})
	}
	group.windowed = true
	group.transitions = transitions
	return group, slicesByClip
}

func renderWindowedVideoTrack(clips []clip, w, h, fps int, work string, xfadeByRight map[int]string, progress *renderProgress, scope fileScope, fit document.VideoFit) ([]trackGroup, error) {
	clipGroups := groupOverlapping(clips)
	plannedGroups := make([]windowedGroup, len(clipGroups))
	slicesByClip := make(map[int]windowedClipSlices)
	for groupIndex, indices := range clipGroups {
		planned, groupSlices := planWindowedGroup(groupIndex, indices[0], indices[1], clips, fps, xfadeByRight)
		plannedGroups[groupIndex] = planned
		for clipIdx, slices := range groupSlices {
			slicesByClip[clipIdx] = slices
		}
	}

	var tasks []windowedVideoTask
	var weights []float64
	appendRoleSegments := func(clipIndex int, moving clip, role string, segs []segment) error {
		added := 0
		for segIndex, part := range segs {
			if part.SrcEnd <= part.SrcStart || videoSegmentFrameCount(moving, part, fps) == 0 {
				continue
			}
			effects := segmentEffectsForClip(moving, part.Effects)
			tasks = append(tasks, windowedVideoTask{
				clipIndex:    clipIndex,
				role:         role,
				segmentIndex: segIndex,
				clip:         moving,
				segment:      part,
			})
			weights = append(weights, (part.SrcEnd-part.SrcStart)/clipPlaybackRate(moving)*(1+segmentEffectsCost(effects)))
			added++
		}
		if added == 0 {
			return fmt.Errorf("clip %d (%s) produced no segments", clipIndex, role)
		}
		return nil
	}

	for clipIndex, moving := range clips {
		if slices, ok := slicesByClip[clipIndex]; ok {
			if len(slices.headSegments) > 0 {
				if err := appendRoleSegments(clipIndex, moving, "head", slices.headSegments); err != nil {
					return nil, err
				}
			}
			if err := appendRoleSegments(clipIndex, moving, "body", slices.bodySegments); err != nil {
				return nil, err
			}
			if len(slices.tailSegments) > 0 {
				if err := appendRoleSegments(clipIndex, moving, "tail", slices.tailSegments); err != nil {
					return nil, err
				}
			}
		} else {
			if err := appendRoleSegments(clipIndex, moving, "full", clipBaseSegments(moving)); err != nil {
				return nil, err
			}
		}
	}

	renderedFiles, err := renderTasks("video", weights, w, h, progress, func(index int, taskProgress *renderProgress) (string, error) {
		task := tasks[index]
		name := fmt.Sprintf("vc%d_s%d.mp4", task.clipIndex, task.segmentIndex)
		if task.role != "full" {
			name = fmt.Sprintf("vc%d_%s_s%d.mp4", task.clipIndex, task.role, task.segmentIndex)
		}
		return renderVideoSegmentTo(videoSegmentTask{
			clipIndex:    task.clipIndex,
			segmentIndex: task.segmentIndex,
			clip:         task.clip,
			segment:      task.segment,
		}, weights[index], w, h, fps, filepath.Join(work, name), taskProgress, scope, fit)
	})
	if err != nil {
		return nil, err
	}

	type clipParts struct {
		head []string
		body []string
		tail []string
		full []string
	}
	partsByClip := make([]clipParts, len(clips))
	for index, task := range tasks {
		switch task.role {
		case "head":
			partsByClip[task.clipIndex].head = append(partsByClip[task.clipIndex].head, renderedFiles[index])
		case "body":
			partsByClip[task.clipIndex].body = append(partsByClip[task.clipIndex].body, renderedFiles[index])
		case "tail":
			partsByClip[task.clipIndex].tail = append(partsByClip[task.clipIndex].tail, renderedFiles[index])
		default:
			partsByClip[task.clipIndex].full = append(partsByClip[task.clipIndex].full, renderedFiles[index])
		}
	}

	// Collect all windowed transitions across groups and render only their short overlap windows in parallel.
	var allTransitions []windowedTransition
	var transitionWeights []float64
	for _, group := range plannedGroups {
		if !group.windowed {
			continue
		}
		for _, tr := range group.transitions {
			allTransitions = append(allTransitions, tr)
			transitionWeights = append(transitionWeights, tr.duration)
		}
	}

	transitionFiles := make([]string, len(allTransitions))
	if len(allTransitions) > 0 {
		// Materialize single-file tail/head inputs (hardlinked in O(1) when single segment).
		leftInputs := make([]string, len(allTransitions))
		rightInputs := make([]string, len(allTransitions))
		for i, tr := range allTransitions {
			leftPieces := partsByClip[tr.leftClip].tail
			if len(leftPieces) == 1 {
				leftInputs[i] = leftPieces[0]
			} else {
				leftFile := filepath.Join(work, fmt.Sprintf("xleft_%d.mp4", i))
				if err := concatFiles(leftPieces, leftFile, work, fmt.Sprintf("xleft_list_%d.txt", i)); err != nil {
					return nil, fmt.Errorf("concat transition %d left tail: %w", i, err)
				}
				leftInputs[i] = leftFile
			}
			rightPieces := partsByClip[tr.rightClip].head
			if len(rightPieces) == 1 {
				rightInputs[i] = rightPieces[0]
			} else {
				rightFile := filepath.Join(work, fmt.Sprintf("xright_%d.mp4", i))
				if err := concatFiles(rightPieces, rightFile, work, fmt.Sprintf("xright_list_%d.txt", i)); err != nil {
					return nil, fmt.Errorf("concat transition %d right head: %w", i, err)
				}
				rightInputs[i] = rightFile
			}
		}

		renderedTransitions, err := renderTasks("transition", transitionWeights, w, h, progress, func(index int, taskProgress *renderProgress) (string, error) {
			return renderWindowedXfade(leftInputs[index], rightInputs[index], allTransitions[index], index, fps, work, taskProgress)
		})
		if err != nil {
			return nil, err
		}
		transitionFiles = renderedTransitions
	}

	groups := make([]trackGroup, 0, len(plannedGroups))
	trCursor := 0
	for groupIndex, planned := range plannedGroups {
		groupClips := clips[planned.startIndex : planned.endIndex+1]
		if planned.windowed {
			var groupPieces []string
			for i := range groupClips {
				clipIdx := planned.startIndex + i
				groupPieces = append(groupPieces, partsByClip[clipIdx].body...)
				if i+1 < len(groupClips) {
					groupPieces = append(groupPieces, transitionFiles[trCursor])
					trCursor++
				}
			}
			out := filepath.Join(work, fmt.Sprintf("xgroup_%d.mp4", groupIndex))
			if err := concatFiles(groupPieces, out, work, fmt.Sprintf("xgroup_list_%d.txt", groupIndex)); err != nil {
				return nil, fmt.Errorf("concat windowed transition group %d: %w", groupIndex, err)
			}
			groups = append(groups, trackGroup{
				file:  out,
				start: groupClips[0].Start,
				dur:   clipEndT(groupClips[len(groupClips)-1]) - groupClips[0].Start,
			})
			continue
		}

		// Single clip or non-windowed fallback group.
		fullFiles := make([]string, len(groupClips))
		for i := range groupClips {
			clipIdx := planned.startIndex + i
			pieces := partsByClip[clipIdx].full
			clipFile := filepath.Join(work, fmt.Sprintf("vclip_%d.mp4", clipIdx))
			if err := concatFiles(pieces, clipFile, work, fmt.Sprintf("vclist_%d.txt", clipIdx)); err != nil {
				return nil, fmt.Errorf("concat clip %d: %w", clipIdx, err)
			}
			fullFiles[i] = clipFile
		}
		if len(groupClips) == 1 {
			groups = append(groups, trackGroup{
				file:  fullFiles[0],
				start: groupClips[0].Start,
				dur:   clipDurT(groupClips[0]),
			})
			continue
		}
		out, err := xfadeGroup(groupClips, fullFiles, fps, work, groupIndex, planned.startIndex, xfadeByRight, progress)
		if err != nil {
			return nil, fmt.Errorf("video xfade group %d: %w", groupIndex, err)
		}
		groups = append(groups, trackGroup{
			file:  out,
			start: groupClips[0].Start,
			dur:   clipEndT(groupClips[len(groupClips)-1]) - groupClips[0].Start,
		})
	}
	return groups, nil
}

func renderWindowedXfade(leftFile, rightFile string, tr windowedTransition, index, fps int, work string, progress *renderProgress) (string, error) {
	out := filepath.Join(work, fmt.Sprintf("xfade_win_%d.mp4", index))
	filters := []string{
		fmt.Sprintf("[0:v]settb=AVTB,setpts=PTS-STARTPTS,fps=%d,format=rgb24,format=yuv444p[v0]", fps),
		fmt.Sprintf("[1:v]settb=AVTB,setpts=PTS-STARTPTS,fps=%d,format=rgb24,format=yuv444p[v1]", fps),
		fmt.Sprintf("[v0][v1]xfade=%s:duration=%s:offset=0,%s[vx]", xfadeFilter(tr.xfade), ff(tr.duration), exactVideoFrameFilter(fps, tr.frames)),
	}
	args := []string{
		"-i", leftFile,
		"-i", rightFile,
		"-filter_complex_threads", progress.filterThreads(),
		"-filter_complex", strings.Join(filters, ";"),
		"-map", "[vx]",
		"-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt,
		"-r", strconv.Itoa(fps), "-an", "-threads", progress.videoThreads(), "-y", out,
	}
	message := fmt.Sprintf("rendering video transition %d", index+1)
	if err := progress.runFFmpeg(tr.duration, tr.duration, message, args...); err != nil {
		return "", fmt.Errorf("ffmpeg windowed xfade %d: %w", index, err)
	}
	return out, nil
}
