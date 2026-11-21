package render

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/catalog"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/filecache"
	"ffmpeg-go-server/internal/platform/storage"
)

type CompositionOptions struct {
	Root     string
	Progress func(float64, string)
}

type CompositionOutput struct {
	Filename      string `json:"filename"`
	Path          string `json:"-"`
	CompositionID string `json:"compositionId"`
}

func RenderComposition(ctx context.Context, resolved composition.Composition, options CompositionOptions) (CompositionOutput, error) {
	if err := validatePreviewComposition(ctx, resolved.Duration.Seconds(), resolved.Output.Format); err != nil {
		return CompositionOutput{}, err
	}
	request, err := compositionRequest(resolved)
	if err != nil {
		return CompositionOutput{}, err
	}
	if window, present := PreviewFromContext(ctx); present {
		var local PreviewWindow
		request, local = previewRequest(request, window)
		ctx = WithPreviewWindow(ctx, local)
	}
	staging, err := os.MkdirTemp(options.Root, "composition_")
	if err != nil {
		return CompositionOutput{}, fmt.Errorf("create composition staging directory: %w", err)
	}
	defer os.RemoveAll(staging)
	if err := stageCompositionAssets(ctx, resolved.Assets, collectAllClips(request), options.Root, staging); err != nil {
		return CompositionOutput{}, err
	}
	sceneShare := sceneProgressShare(request)
	request, err = materializeSceneClips(ctx, request, staging, options.Progress)
	if err != nil {
		return CompositionOutput{}, err
	}
	plan, err := prepareRenderPlan(request, fileScope{root: staging})
	if err != nil {
		return CompositionOutput{}, fmt.Errorf("prepare composition render: %w", err)
	}
	progress := newRenderProgress(estimateRenderWork(request, plan), func(ratio float64, message string) {
		if options.Progress != nil {
			options.Progress(sceneShare+(1-sceneShare)*ratio, message)
		}
	})
	progress.ctx = ctx
	filename, output, err := executeRender(request, plan, progress)
	if err != nil {
		return CompositionOutput{}, fmt.Errorf("render composition: %w", err)
	}
	finalPath := filepath.Join(options.Root, filename)
	if err := os.Rename(output, finalPath); err != nil {
		return CompositionOutput{}, fmt.Errorf("publish composition render: %w", err)
	}
	return CompositionOutput{Filename: filename, Path: finalPath, CompositionID: resolved.ID}, nil
}

func compositionRequest(resolved composition.Composition) (renderRequest, error) {
	request := renderRequest{FPS: resolved.Output.FPS, Fit: resolved.Output.Fit, Format: resolved.Output.Format, Quality: resolved.Output.Quality}
	duration := resolved.Duration.Seconds()
	request.Duration = &duration
	request.Resolution.W, request.Resolution.H = compositionResolution(resolved.Output)
	assets := make(map[string]document.Asset)
	for _, asset := range resolved.Assets {
		assets[asset.ID] = asset
	}
	registry := catalog.Load()
	for _, track := range resolved.Tracks {
		if track.Hidden || track.Muted || len(track.Clips) == 0 {
			continue
		}
		if request.Format == "mp3" && track.Type == "video" {
			continue
		}
		channel, err := compositionChannel(track, resolved, assets, registry)
		if err != nil {
			return request, err
		}
		if track.Type == "video" {
			request.VideoChannels = append(request.VideoChannels, channel)
		} else {
			request.AudioChannels = append(request.AudioChannels, channel)
		}
	}
	if request.Format != "mp3" && len(resolved.TextItems) > 0 {
		overlays, err := resolved.PreparedText.Resolve(resolved.TextItems, resolved.Output)
		if err != nil {
			return request, err
		}
		if err := convertJSON(overlays, &request.TextItems); err != nil {
			return request, err
		}
	}
	return request, nil
}

func compositionChannel(track document.Track, resolved composition.Composition, assets map[string]document.Asset, registry catalog.Registry) (channel, error) {
	result := channel{Clips: []clip{}, Transitions: []transition{}}
	for _, moving := range track.Clips {
		asset, ok := assets[moving.AssetID]
		if !ok || asset.Local {
			return result, fmt.Errorf("asset %s is not available on the server", moving.AssetID)
		}
		value := clip{File: asset.File, MediaKind: asset.Kind, InPoint: moving.InPoint.Seconds(), OutPoint: moving.OutPoint.Seconds(), Start: moving.Start.Seconds(),
			PlaybackRate: &moving.PlaybackRate, Volume: &moving.Volume, Opacity: &moving.Opacity}
		fadeIn, fadeOut := moving.FadeIn.Seconds(), moving.FadeOut.Seconds()
		value.FadeIn, value.FadeOut = &fadeIn, &fadeOut
		if err := convertJSON(moving.Transform, &value.Transform); err != nil {
			return result, err
		}
		if err := convertJSON(moving.TransformKeyframes, &value.TransformKeyframes); err != nil {
			return result, err
		}
		if err := convertJSON(resolved.Segments[moving.ID], &value.Segments); err != nil {
			return result, err
		}
		result.Clips = append(result.Clips, value)
	}
	for _, junction := range resolved.Transitions {
		if junction.TrackID != track.ID {
			continue
		}
		definition, ok := registry.Transition(junction.Preset)
		if !ok || !xfadeNames[definition.Xfade] {
			return result, fmt.Errorf("unsupported transition %s", junction.Preset)
		}
		index := slices.IndexFunc(track.Clips, func(clip document.Clip) bool { return clip.ID == junction.RightClipID })
		if index <= 0 {
			return result, fmt.Errorf("invalid transition pair %s", junction.ID)
		}
		result.Transitions = append(result.Transitions, transition{RightClipIndex: index, Xfade: definition.Xfade})
	}
	return result, nil
}

func compositionResolution(output document.Output) (int, int) {
	sizes := map[string][2]int{"480p": {854, 480}, "720p": {1280, 720}, "1080p": {1920, 1080}, "2k": {2560, 1440}, "4k": {3840, 2160}}
	size := sizes[output.Resolution]
	if output.Aspect == "portrait" {
		return size[1], size[0]
	}
	if output.Aspect == "classic" {
		if output.Resolution == "4k" {
			return 3840, 2880
		}
		return size[1] * 4 / 3, size[1]
	}
	return size[0], size[1]
}

func convertJSON(source, target any) error {
	data, err := json.Marshal(source)
	if err != nil {
		return fmt.Errorf("encode composition adapter: %w", err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("decode composition adapter: %w", err)
	}
	return nil
}

func stageCompositionAssets(ctx context.Context, assets []document.Asset, clips []clip, root, staging string) error {
	versions := make(map[string]string)
	for _, asset := range assets {
		if version, ok := versions[asset.File]; ok && version != asset.Version {
			return fmt.Errorf("conflicting versions for %s", asset.File)
		}
		versions[asset.File] = asset.Version
	}
	staged := make(map[string]bool)
	for _, moving := range clips {
		if staged[moving.File] {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := stageVersionedAsset(root, staging, moving.File, versions[moving.File]); err != nil {
			return err
		}
		staged[moving.File] = true
	}
	return nil
}

func stageVersionedAsset(root, staging, name, version string) error {
	if !strings.HasPrefix(version, "sha256:") {
		return fmt.Errorf("asset %s requires a sha256 version for server rendering", name)
	}
	source, err := storage.SafeJoinIn(root, name)
	if err != nil {
		return err
	}
	destination, err := storage.SafeJoinIn(staging, name)
	if err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open asset %s: %w", name, err)
	}
	defer input.Close()
	defer filecache.Release(input)
	output, err := os.Create(destination)
	if err != nil {
		return fmt.Errorf("stage asset %s: %w", name, err)
	}
	digest := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(output, digest), input)
	closeErr := output.Close()
	if copyErr != nil {
		return fmt.Errorf("copy asset %s: %w", name, copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close staged asset %s: %w", name, closeErr)
	}
	if "sha256:"+hex.EncodeToString(digest.Sum(nil)) != version {
		return fmt.Errorf("asset version changed: %s", name)
	}
	return nil
}
