package compositions

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

func AssetMetadata(c *fiber.Ctx) error {
	var request struct {
		Files []struct {
			ID   string `json:"id"`
			File string `json:"file"`
		} `json:"files"`
	}
	if err := document.DecodeJSON(c.Body(), &request); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid asset request")
	}
	if len(request.Files) == 0 || len(request.Files) > 100 {
		return fiber.NewError(fiber.StatusBadRequest, "request 1–100 assets at a time")
	}
	session := sessions.FromRequest(c)
	root, err := sessions.Touch(session)
	if err != nil {
		return media.AssetError(c, err)
	}
	assets := make([]document.Asset, 0, len(request.Files))
	for _, file := range request.Files {
		asset, err := AssetFromFile(c.UserContext(), root, session, file.File, file.ID)
		if err != nil {
			return media.AssetError(c, err)
		}
		assets = append(assets, asset)
	}
	return c.JSON(assets)
}

func AssetFromFile(ctx context.Context, root, session, file, id string) (document.Asset, error) {
	media.WarmSession(ctx, session, root, file)
	if scenes.IsSource(file) {
		return scenes.SourceAsset(root, file, id)
	}
	source, err := media.ResolveSource(root, file)
	if err != nil {
		return document.Asset{}, err
	}
	metadata, err := media.LoadMetadata(ctx, &mediacache.Default, source, mediacache.Run)
	if err != nil {
		return document.Asset{}, err
	}
	version, err := FileVersion(source.Path)
	if err != nil {
		return document.Asset{}, err
	}
	kind := "video"
	if metadata.VideoCodec == "" {
		kind = "audio"
	}
	if strings.Contains("|.png|.jpg|.jpeg|.webp|.bmp|.gif|", "|"+strings.ToLower(filepath.Ext(file))+"|") {
		kind = "image"
	}
	return document.Asset{ID: id, File: file, Version: version, Kind: kind, Duration: document.Seconds(metadata.Duration),
		Width: metadata.Width, Height: metadata.Height, HasAudio: metadata.AudioCodec != ""}, nil
}

func ResolveProjectAssets(ctx context.Context, input compiler.Input, root, session string) (compiler.Input, error) {
	assets := append([]document.Asset(nil), input.Assets...)
	known := make(map[string]bool, len(assets))
	for _, asset := range assets {
		known[asset.ID] = true
	}
	reference := func(id string) {
		if id != "" && !known[id] {
			assets = append(assets, document.Asset{ID: id, File: id})
			known[id] = true
		}
	}
	slots := make([]string, 0, len(input.Bindings))
	for slot := range input.Bindings {
		slots = append(slots, slot)
	}
	slices.Sort(slots)
	for _, slot := range slots {
		ids := input.Bindings[slot]
		for _, id := range ids {
			reference(id)
		}
	}
	for _, track := range input.Document.Tracks {
		for _, clip := range track.Clips {
			reference(clip.AssetID)
		}
	}
	if input.Snapshot != nil {
		for _, track := range input.Snapshot.Tracks {
			for _, clip := range track.Clips {
				reference(clip.AssetID)
			}
		}
	}
	for _, jobs := range [][]document.Job{input.Document.Jobs, input.Document.Before, input.Document.After} {
		for _, job := range jobs {
			reference(job.AssetID)
			reference(job.ResultAssetID)
		}
	}
	if len(assets) > 1000 {
		return input, fmt.Errorf("use at most 1000 source assets")
	}
	for index, asset := range assets {
		if strings.HasPrefix(asset.Version, "sha256:") && asset.Kind != "" && !asset.Local {
			continue
		}
		resolved, err := AssetFromFile(ctx, root, session, asset.File, asset.ID)
		if err != nil {
			return input, fmt.Errorf("resolve asset %q: %w", asset.ID, err)
		}
		if strings.HasPrefix(asset.Version, "sha256:") && resolved.Version != asset.Version {
			return input, fmt.Errorf("asset %q changed since the recipe was saved", asset.ID)
		}
		assets[index] = resolved
	}
	input.Assets = assets
	return input, nil
}

func FileVersion(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open asset for fingerprinting: %w", err)
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", fmt.Errorf("fingerprint asset: %w", err)
	}
	return "sha256:" + hex.EncodeToString(digest.Sum(nil)), nil
}
