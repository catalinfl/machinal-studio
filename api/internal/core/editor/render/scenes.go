package render

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/platform/jobqueue"
)

const sceneExportWorkShare = 0.2

type sceneExport struct {
	file        string
	transparent bool
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
	files := make(map[string]sceneExport)
	names := []string{}
	for _, channel := range request.VideoChannels {
		for _, clip := range channel.Clips {
			if scenes.IsSource(clip.File) {
				if _, exists := files[clip.File]; !exists {
					names = append(names, clip.File)
				}
				files[clip.File] = sceneExport{}
			}
		}
	}
	completed := 0
	for _, file := range names {
		if err := ctx.Err(); err != nil {
			return request, err
		}
		message := fmt.Sprintf("Rendering scene %d of %d for export", completed+1, len(files))
		ratio := sceneExportWorkShare * float64(completed) / float64(len(files))
		if !jobqueue.ReportStage(ctx, ratio, message, jobqueue.Stage{Name: "compiling", Scope: "scene", Index: completed + 1, Count: len(files)}) && progress != nil {
			progress(ratio, message)
		}
		source, err := scenes.ReadSource(root, file)
		if err != nil {
			return request, fmt.Errorf("read scene %s for export: %w", file, err)
		}
		extension := "mp4"
		if source.Config.Transparent {
			extension = "webm"
		}
		output := strings.Replace(uniqueOutputName(extension), "render_", "scene_export_", 1)
		request.sceneExports = append(request.sceneExports, output)
		sceneContext := scenes.WithExportProgress(ctx, sceneProgressReporter(ctx, completed, len(files), message, progress))
		if err := scenes.Materialize(sceneContext, root, file, filepath.Join(root, output)); err != nil {
			return request, fmt.Errorf("materialize scene %s: %w", file, err)
		}
		files[file] = sceneExport{file: output, transparent: source.Config.Transparent}
		completed++
		ratio = sceneExportWorkShare * float64(completed) / float64(len(files))
		if !jobqueue.ReportStage(ctx, ratio, message, jobqueue.Stage{Name: "scene-complete", Scope: "scene", Index: completed, Count: len(files)}) && progress != nil {
			progress(ratio, message)
		}
	}
	for channelIndex := range request.VideoChannels {
		clips := request.VideoChannels[channelIndex].Clips
		for clipIndex := range clips {
			if output := files[clips[clipIndex].File]; output.file != "" {
				clips[clipIndex].File = output.file
				clips[clipIndex].sceneTransparent = output.transparent
			}
		}
	}
	return request, nil
}

func sceneProgressReporter(ctx context.Context, completed, count int, message string, progress func(float64, string)) func(scenes.ExportProgress) {
	return func(update scenes.ExportProgress) {
		ratio := float64(completed) / float64(count)
		if update.TotalFrames > 0 {
			ratio += float64(update.WrittenFrames) / float64(update.TotalFrames) / float64(count)
		}
		detail := fmt.Sprintf("%s · %s · %d/%d frames", message, update.Stage, update.WrittenFrames, update.TotalFrames)
		if !jobqueue.ReportStage(ctx, sceneExportWorkShare*ratio, detail, jobqueue.Stage{Name: update.Stage, Scope: "scene", Index: completed + 1, Count: count, Completed: update.WrittenFrames, Total: update.TotalFrames, ElapsedSeconds: update.ElapsedMS / 1000}) && progress != nil {
			progress(sceneExportWorkShare*ratio, detail)
		}
	}
}

func removeSceneExports(root string, files []string) {
	for _, file := range files {
		if err := os.Remove(filepath.Join(root, file)); err != nil && !os.IsNotExist(err) {
			log.Printf("remove temporary scene export: %v", err)
		}
	}
}
