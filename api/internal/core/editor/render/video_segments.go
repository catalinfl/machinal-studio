package render

import (
	"fmt"
	"path/filepath"
	"strconv"

	"ffmpeg-go-server/editengine/document"
)

type videoSegmentTask struct {
	clipIndex    int
	segmentIndex int
	clip         clip
	segment      segment
}

func planVideoSegments(clips []clip, fps int) ([]videoSegmentTask, []float64, error) {
	var tasks []videoSegmentTask
	var weights []float64
	for index, moving := range clips {
		segments := moving.Segments
		if len(segments) == 0 {
			segments = []segment{{SrcStart: moving.InPoint, SrcEnd: moving.OutPoint}}
		}
		first := len(tasks)
		for segmentIndex, part := range segments {
			if part.SrcEnd <= part.SrcStart || videoSegmentFrameCount(moving, part, fps) == 0 {
				continue
			}
			tasks = append(tasks, videoSegmentTask{index, segmentIndex, moving, part})
			weights = append(weights, (part.SrcEnd-part.SrcStart)/clipPlaybackRate(moving)*(1+segmentEffectsCost(part.Effects)))
		}
		if first == len(tasks) {
			return nil, nil, fmt.Errorf("clip %d produced no segments", index)
		}
	}
	return tasks, weights, nil
}

func renderVideoSegments(clips []clip, w, h, fps int, work string, progress *renderProgress, scope fileScope, fit document.VideoFit) ([]string, error) {
	tasks, weights, err := planVideoSegments(clips, fps)
	if err != nil {
		return nil, err
	}
	files, err := renderTasks("video", weights, w, h, progress, func(index int, taskProgress *renderProgress) (string, error) {
		return renderVideoSegment(tasks[index], weights[index], w, h, fps, work, taskProgress, scope, fit)
	})
	if err != nil {
		return nil, err
	}
	byClip := make([][]string, len(clips))
	for index, task := range tasks {
		byClip[task.clipIndex] = append(byClip[task.clipIndex], files[index])
	}
	clipFiles := make([]string, len(clips))
	for index, pieces := range byClip {
		clipFiles[index] = filepath.Join(work, fmt.Sprintf("vclip_%d.mp4", index))
		if err := concatFiles(pieces, clipFiles[index], work, fmt.Sprintf("vclist_%d.txt", index)); err != nil {
			return nil, fmt.Errorf("concat clip %d: %w", index, err)
		}
	}
	return clipFiles, nil
}

func renderVideoSegment(task videoSegmentTask, weight float64, w, h, fps int, work string, progress *renderProgress, scope fileScope, fit document.VideoFit) (string, error) {
	moving, part := task.clip, task.segment
	inputPath, err := scope.join(moving.File)
	if err != nil {
		return "", fmt.Errorf("resolve clip %d: %w", task.clipIndex, err)
	}
	duration := (part.SrcEnd - part.SrcStart) / clipPlaybackRate(moving)
	effectFilter, err := buildFilterForDuration(part.Effects, duration)
	if err != nil {
		return "", fmt.Errorf("clip %d segment %d filter: %w", task.clipIndex, task.segmentIndex, err)
	}
	cadencedEffect := "fps=" + strconv.Itoa(fps)
	if effectFilter != "" {
		cadencedEffect += "," + effectFilter
	}
	videoFilter := videoClipFilter(moving, cadencedEffect, videoFitFilter(w, h, fit, "")+",fps="+strconv.Itoa(fps))
	segmentOffset := (part.SrcStart - moving.InPoint) / clipPlaybackRate(moving)
	if transformFilter := clipTransformFilter(moving, w, h, segmentOffset, duration, fps); transformFilter != "" {
		videoFilter += "," + transformFilter
	}
	videoFilter += "," + exactVideoFrameFilter(fps, videoSegmentFrameCount(moving, part, fps))
	inputArgs := append(segmentInputArgs(part, moving.MediaKind), sceneDecoderArgs(moving)...)
	debugVideoSegment(task.clipIndex, task.segmentIndex, moving.File, part, clipPlaybackRate(moving), effectFilter, videoFilter, inputArgs, inputPath)
	piece := filepath.Join(work, fmt.Sprintf("vc%d_s%d.mp4", task.clipIndex, task.segmentIndex))
	message := fmt.Sprintf("rendering video clip %d, segment %d", task.clipIndex+1, task.segmentIndex+1)
	err = progress.runFFmpeg(duration, weight, message, append(inputArgs, "-i", inputPath,
		"-vf", videoFilter, "-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf,
		"-pix_fmt", videoPixFmt, "-an", "-r", strconv.Itoa(fps), "-threads", progress.videoThreads(), "-y", piece)...)
	if err != nil {
		return "", fmt.Errorf("ffmpeg segment error (clip %d seg %d): %w", task.clipIndex, task.segmentIndex, err)
	}
	return piece, nil
}
