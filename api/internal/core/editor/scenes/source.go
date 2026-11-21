package scenes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

// Image/video/model byte caps expand to under 91 MiB as data URLs, leaving room for source and bundle.
const maxSourceBytes = 96 << 20
const previewEnvironmentVersion = 9

type Narration struct {
	File     string  `json:"file"`
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
}

type LiveSource struct {
	Version            int               `json:"version"`
	Title              string            `json:"title,omitempty"`
	Component          string            `json:"component"`
	Explanation        string            `json:"explanation,omitempty"`
	Text               string            `json:"text,omitempty"`
	VisualMode         string            `json:"visualMode,omitempty"`
	JavaScript         string            `json:"javascript"`
	Config             Config            `json:"config"`
	Audio              *Narration        `json:"audio,omitempty"`
	Images             map[string]string `json:"images,omitempty"`
	Videos             map[string]string `json:"videos,omitempty"`
	Models             map[string]string `json:"models,omitempty"`
	Parameters         SceneParameters   `json:"parameters,omitempty"`
	Handoff            *SceneHandoff     `json:"handoff,omitempty"`
	EnvironmentVersion int               `json:"environmentVersion,omitempty"`
}

func DownloadSource(c *fiber.Ctx) error {
	// Viewing uses the saved browser bundle; only explicit authoring/export wakes the worker.
	return media.Download(c)
}

func IsSource(filename string) bool {
	return storage.IsSceneSource(filename)
}

func ReadSource(root, filename string) (LiveSource, error) {
	source, _, err := readSourceVersion(root, filename)
	return source, err
}

func readSourceVersion(root, filename string) (LiveSource, string, error) {
	if !IsSource(filename) {
		return LiveSource{}, "", fmt.Errorf("invalid scene source filename")
	}
	path, err := storage.SafeJoinIn(root, filename)
	if err != nil {
		return LiveSource{}, "", err
	}
	file, err := os.Open(path)
	if err != nil {
		return LiveSource{}, "", fmt.Errorf("open scene source: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSourceBytes+1))
	if err != nil {
		return LiveSource{}, "", fmt.Errorf("read scene source: %w", err)
	}
	if len(data) > maxSourceBytes {
		return LiveSource{}, "", fmt.Errorf("scene source exceeds size limits")
	}
	var source LiveSource
	if err := json.Unmarshal(data, &source); err != nil {
		return source, "", fmt.Errorf("decode scene source: %w", err)
	}
	if err := source.validate(); err != nil {
		return source, "", err
	}
	digest := sha256.Sum256(data)
	return source, "sha256:" + hex.EncodeToString(digest[:]), nil
}

func (source LiveSource) validate() error {
	if source.Version != 1 || source.Component == "" || len(source.Component) > maxComponentBytes || source.JavaScript == "" {
		return fmt.Errorf("invalid live scene source")
	}
	if err := validateImageSources(source.Images); err != nil {
		return err
	}
	if err := validateVideoSources(source.Videos); err != nil {
		return err
	}
	if err := source.Parameters.Validate(); err != nil {
		return err
	}
	if err := validateModelSources(source.Models); err != nil {
		return err
	}
	if source.Handoff != nil {
		if err := source.Handoff.Validate(); err != nil {
			return err
		}
	}
	config := source.Config
	request := Request{Prompt: "scene", Text: source.Text, VisualMode: source.VisualMode, Width: config.Width, Height: config.Height, FPS: config.FPS, Duration: 1}
	if config.Frames <= 0 || float64(config.Frames)/config.FPS > maxSceneSeconds {
		return fmt.Errorf("scene frame count must be positive")
	}
	return request.validate()
}

func SourceAsset(root, filename, id string) (document.Asset, error) {
	source, version, err := readSourceVersion(root, filename)
	if err != nil {
		return document.Asset{}, err
	}
	return document.Asset{ID: id, File: filename, Version: version, Kind: "video",
		Duration: document.Seconds(float64(source.Config.Frames) / source.Config.FPS), Width: source.Config.Width, Height: source.Config.Height}, nil
}

func Materialize(ctx context.Context, root, filename, output string) error {
	source, err := ReadSource(root, filename)
	if err != nil {
		return err
	}
	duration := float64(source.Config.Frames) / source.Config.FPS
	if err := credits.CheckSceneRender(ctx, duration); err != nil {
		return fmt.Errorf("authorize scene rendering: %w", err)
	}
	manifest, err := renderParameterizedRemote(ctx, source.Component, source.Config, source.compilationMedia(), output)
	if err != nil {
		return fmt.Errorf("render live scene: %w", err)
	}
	if _, err := importScene(filepath.Dir(output), filepath.Base(output), filename, manifest, false); err != nil {
		return err
	}
	return credits.ChargeSceneRender(ctx, filename, duration)
}

func (source LiveSource) compilationMedia() compilationMedia {
	return compilationMedia{Images: source.Images, Videos: source.Videos, Parameters: source.Parameters, Models: source.Models}
}
