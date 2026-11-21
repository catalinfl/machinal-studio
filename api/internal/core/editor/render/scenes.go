package render

import (
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"golang.org/x/sync/errgroup"
)

const sceneExportWorkShare = 0.2

type sceneExport struct {
	file        string
	transparent bool
	start       float64
	end         float64
	capture     *scenes.CaptureRange
}

type sceneCaptureTask struct {
	source string
	output sceneExport
}

func sceneDecoderArgs(clip clip) []string {
	if clip.sceneTransparent {
		// FFmpeg's native VP9 decoder discards WebM alpha; libvpx preserves it.
		return []string{"-c:v", "libvpx-vp9"}
	}
	return nil
}

func sceneProgressShare(request renderRequest) float64 {
	for _, channel := range request.VideoChannels {
		for _, clip := range channel.Clips {
			if scenes.IsSource(clip.File) {
				return sceneExportWorkShare
			}
		}
	}
	return 0
}

func materializeSceneClips(ctx context.Context, request renderRequest, root string, progress func(float64, string)) (renderRequest, error) {
	tasks, err := planSceneCaptures(request, root)
	if err != nil {
		return request, err
	}
	for _, task := range tasks {
		request.sceneExports = append(request.sceneExports, task.output.file)
	}
	if err := renderSceneCaptures(ctx, root, tasks, progress); err != nil {
		return request, err
	}
	files := make(map[string]sceneExport, len(tasks))
	for _, task := range tasks {
		files[task.source] = task.output
	}
	for channelIndex := range request.VideoChannels {
		clips := request.VideoChannels[channelIndex].Clips
		for index, moving := range clips {
			if output := files[moving.File]; output.file != "" {
				clips[index] = rebaseSceneClip(moving, output)
			}
		}
	}
	return request, nil
}

func planSceneCaptures(request renderRequest, root string) ([]sceneCaptureTask, error) {
	files := make(map[string]sceneExport)
	names := []string{}
	for _, channel := range request.VideoChannels {
		for _, clip := range channel.Clips {
			if scenes.IsSource(clip.File) {
				if _, exists := files[clip.File]; !exists {
					names = append(names, clip.File)
				}
				bounds, exists := files[clip.File]
				if !exists || clip.InPoint < bounds.start {
					bounds.start = clip.InPoint
				}
				bounds.end = max(bounds.end, clip.OutPoint)
				files[clip.File] = bounds
			}
		}
	}
	tasks := make([]sceneCaptureTask, len(names))
	for index, file := range names {
		source, err := scenes.ReadSource(root, file)
		if err != nil {
			return nil, fmt.Errorf("read scene %s for export: %w", file, err)
		}
		extension := "mp4"
		if source.Config.Transparent {
			extension = "webm"
		}
		output := strings.Replace(uniqueOutputName(extension), "render_", "scene_export_", 1)
		bounds := files[file]
		if source.Config.FPS == float64(normalizedFPS(request.FPS)) {
			bounds.start = neededSceneStart(request, file, source.Config.FPS)
		}
		startFrame := max(0, int(math.Floor(bounds.start*source.Config.FPS+1e-7)))
		endFrame := min(source.Config.Frames, int(math.Ceil(bounds.end*source.Config.FPS-1e-7)))
		var capture *scenes.CaptureRange
		if startFrame > 0 || endFrame < source.Config.Frames {
			capture = &scenes.CaptureRange{StartFrame: startFrame, EndFrame: endFrame}
		}
		tasks[index] = sceneCaptureTask{source: file, output: sceneExport{file: output, transparent: source.Config.Transparent, start: float64(startFrame) / source.Config.FPS, capture: capture}}
	}
	return tasks, nil
}

func renderSceneCaptures(ctx context.Context, root string, tasks []sceneCaptureTask, progress func(float64, string)) error {
	group, sceneCtx := errgroup.WithContext(ctx)
	group.SetLimit(2)
	reporter := newSceneProgressReporter(ctx, len(tasks), progress)
	for index, task := range tasks {
		group.Go(func() error {
			report := func(update scenes.ExportProgress) { reporter(index, update) }
			report(scenes.ExportProgress{Stage: "compiling"})
			if err := scenes.MaterializeRange(scenes.WithExportProgress(sceneCtx, report), root, task.source, filepath.Join(root, task.output.file), task.output.capture); err != nil {
				return fmt.Errorf("materialize scene %s: %w", task.source, err)
			}
			report(scenes.ExportProgress{Stage: "scene-complete", WrittenFrames: 1, TotalFrames: 1})
			return nil
		})
	}
	return group.Wait()
}

func newSceneProgressReporter(ctx context.Context, count int, progress func(float64, string)) func(int, scenes.ExportProgress) {
	var mu sync.Mutex
	fractions := make([]float64, count)
	return func(index int, update scenes.ExportProgress) {
		mu.Lock()
		defer mu.Unlock()
		if update.TotalFrames > 0 {
			fractions[index] = max(fractions[index], float64(update.WrittenFrames)/float64(update.TotalFrames))
		}
		ratio := sceneExportWorkShare * sumChunkWork(fractions) / float64(count)
		message := fmt.Sprintf("Rendering scene %d of %d · %s · %d/%d frames", index+1, count, update.Stage, update.WrittenFrames, update.TotalFrames)
		stage := jobqueue.Stage{Name: update.Stage, Scope: "scene", Index: index + 1, Count: count, Completed: update.WrittenFrames, Total: update.TotalFrames, ElapsedSeconds: update.ElapsedMS / 1000}
		if !jobqueue.ReportStage(ctx, ratio, message, stage) && progress != nil {
			progress(ratio, message)
		}
	}
}

func rebaseSceneClip(moving clip, output sceneExport) clip {
	consumed := min(moving.previewPreroll*clipPlaybackRate(moving), max(0, output.start-moving.InPoint))
	moving.InPoint += consumed
	moving.previewPreroll -= consumed / clipPlaybackRate(moving)
	moving.InPoint -= output.start
	moving.OutPoint -= output.start
	moving.Segments = append([]segment(nil), moving.Segments...)
	for index := range moving.Segments {
		moving.Segments[index].SrcStart -= output.start
		moving.Segments[index].SrcEnd -= output.start
	}
	moving.File, moving.sceneTransparent = output.file, output.transparent
	return moving
}

func neededSceneStart(request renderRequest, file string, fps float64) float64 {
	start := math.Inf(1)
	for _, track := range request.VideoChannels {
		for _, moving := range track.Clips {
			if moving.File != file {
				continue
			}
			point := moving.InPoint
			if math.Abs(point*fps-math.Round(point*fps)) < fadeEps && math.Abs(moving.previewPreroll*fps-math.Round(moving.previewPreroll*fps)) < fadeEps {
				point += moving.previewPreroll * clipPlaybackRate(moving)
			}
			start = min(start, point)
		}
	}
	return start
}

func removeSceneExports(root string, files []string) {
	for _, file := range files {
		if err := os.Remove(filepath.Join(root, file)); err != nil && !os.IsNotExist(err) {
			log.Printf("remove temporary scene export: %v", err)
		}
	}
}
