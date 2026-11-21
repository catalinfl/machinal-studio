package compositions

import (
	"context"
	"fmt"
	"slices"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/core/media"
)

var generateSceneCall = scenes.GenerateScene

func materializeSceneJob(ctx context.Context, root, session string, doc document.Document, assets []document.Asset, job document.Job) (document.Document, []document.Asset, error) {
	images, err := resolveSceneJobImages(doc, assets, job.Images)
	if err != nil {
		return doc, assets, err
	}
	job.Images = images
	request := sceneJobRequest(job, doc.Output)
	if job.NarrationJob != "" {
		request, err = bindSceneNarration(request, job, doc, assets)
		if err != nil {
			return doc, assets, err
		}
	}
	request.CaptionSafeArea = hasTimelineCaptions(doc)
	if job.Type == "scene.edit" {
		index := slices.IndexFunc(assets, func(asset document.Asset) bool { return asset.ID == job.AssetID })
		if index < 0 || assets[index].Local || !scenes.IsSource(assets[index].File) {
			return doc, assets, fmt.Errorf("job %q needs an existing live-scene assetId", job.ID)
		}
		request.SourceFile = assets[index].File
	}
	windowCtx, cancel := context.WithTimeout(ctx, orchestrationProviderTimeout)
	defer cancel()
	generated, err := generateSceneCall(windowCtx, session, root, request)
	if err != nil {
		return doc, assets, fmt.Errorf("create scene %q: %w", job.ID, err)
	}
	assets = append(assets, generated.Asset)
	for _, jobs := range [][]document.Job{doc.Before, doc.Jobs} {
		for index := range jobs {
			if jobs[index].ID == job.ID {
				jobs[index].Images = images
			}
		}
	}
	doc = setJobResult(doc, job.ID, generated.Asset.ID)
	if generated.Source != nil && generated.Source.Audio != nil {
		return materializeSceneNarration(ctx, root, session, doc, assets, job.ID, *generated.Source.Audio)
	}
	return doc, assets, nil
}

func materializeSceneNarration(ctx context.Context, root, session string, doc document.Document, assets []document.Asset, jobID string, audio scenes.Narration) (document.Document, []document.Asset, error) {
	media.WarmSession(ctx, session, root, audio.File)
	_, safeJoin := orchestrationSafeJoin(session, root)
	path, err := safeJoin(audio.File)
	if err != nil {
		return doc, assets, err
	}
	version, err := FileVersion(path)
	if err != nil {
		return doc, assets, err
	}
	index := slices.IndexFunc(assets, func(asset document.Asset) bool { return asset.File == audio.File && asset.Kind == "audio" })
	id := audio.File
	if index >= 0 {
		id = assets[index].ID
	} else {
		assets = append(assets, document.Asset{ID: id, File: audio.File, Version: version, Kind: "audio", Duration: document.Seconds(audio.Duration), HasAudio: true})
	}
	for _, jobs := range [][]document.Job{doc.Before, doc.Jobs} {
		for index := range jobs {
			if jobs[index].ID == jobID {
				jobs[index].ResultAudioAssetID, jobs[index].AudioStart = id, document.Seconds(audio.Start)
			}
		}
	}
	return doc, assets, nil
}

func sceneJobRequest(job document.Job, output document.Output) scenes.Request {
	width, height := 1920, 1080
	aspect := job.Aspect
	if aspect == "" {
		aspect = output.Aspect
	}
	switch aspect {
	case "portrait", "9:16":
		width, height = 1080, 1920
	case "classic", "4:3":
		width, height = 1440, 1080
	}
	if job.Width != 0 || job.Height != 0 {
		width, height = job.Width, job.Height
	}
	fps := job.FPS
	if fps == 0 {
		fps = float64(output.FPS)
		if fps == 0 {
			fps = 30
		}
	}
	images := make([]scenes.SceneImage, 0, len(job.Images))
	for _, image := range job.Images {
		images = append(images, scenes.SceneImage{ID: image.ID, File: image.File, Name: image.Name, Description: image.Description})
	}
	request := scenes.Request{Prompt: job.Prompt, VisualMode: job.VisualMode, Duration: job.Duration.Seconds(), Width: width, Height: height, FPS: fps, Model: job.Model, Images: images, Language: job.Language}
	if job.Type == "scene.generate" {
		request.Text = job.Text
	}
	return request
}

func resolveSceneJobImages(doc document.Document, assets []document.Asset, images []document.SceneImage) ([]document.SceneImage, error) {
	resolved := slices.Clone(images)
	for index, image := range resolved {
		if image.Job == "" {
			continue
		}
		jobIndex := slices.IndexFunc(doc.Before, func(job document.Job) bool { return job.ID == image.Job && job.Type == "image.generate" })
		if jobIndex < 0 {
			return nil, fmt.Errorf("scene image dependency %q is missing", image.Job)
		}
		assetIndex := slices.IndexFunc(assets, func(asset document.Asset) bool {
			return asset.ID == doc.Before[jobIndex].ResultAssetID && asset.Kind == "image" && !asset.Local
		})
		if assetIndex < 0 {
			return nil, fmt.Errorf("scene image dependency %q has not materialized", image.Job)
		}
		resolved[index].File, resolved[index].Job = assets[assetIndex].File, ""
	}
	return resolved, nil
}
