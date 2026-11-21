package scenes

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/storage"
)

const (
	maxSceneVideos         = 2
	maxSceneVideoBytes     = 20 << 20
	maxSceneVideoDimension = 3840
	maxVideoDescription    = 600
)

var videoID = regexp.MustCompile(`^video_[1-2]$`)

type SceneVideo struct {
	ID          string  `json:"id"`
	File        string  `json:"file"`
	Name        string  `json:"name"`
	Description string  `json:"description,omitempty"`
	Look        string  `json:"look,omitempty"`
	Width       int     `json:"width,omitempty"`
	Height      int     `json:"height,omitempty"`
	Duration    float64 `json:"duration,omitempty"`
	DataURL     string  `json:"-"`
}

type sceneVideoError struct {
	message string
	cause   error
}

func (err *sceneVideoError) Error() string { return err.message + ": " + err.cause.Error() }
func (err *sceneVideoError) Unwrap() error { return err.cause }

func validateVideoInputs(videos []SceneVideo) error {
	if len(videos) > maxSceneVideos {
		return fmt.Errorf("attach at most %d videos", maxSceneVideos)
	}
	seen := make(map[string]bool)
	for _, video := range videos {
		if !videoID.MatchString(video.ID) || seen[video.ID] {
			return fmt.Errorf("each scene video needs a unique video_1 through video_%d ID", maxSceneVideos)
		}
		seen[video.ID] = true
		if video.File == "" || len(video.File) > 255 || strings.ContainsAny(video.File, `/\`) || video.File == "." || video.File == ".." {
			return fmt.Errorf("choose an uploaded video filename")
		}
		ext := strings.ToLower(filepath.Ext(video.File))
		if ext != ".mp4" && ext != ".webm" {
			return fmt.Errorf("choose MP4 or WebM videos")
		}
		if strings.TrimSpace(video.Name) == "" || len(video.Name) > 255 || utf8.RuneCountInString(video.Description) > maxVideoDescription {
			return fmt.Errorf("each video needs a name and directions of at most %d characters", maxVideoDescription)
		}
		switch video.Look {
		case "", "original", "cinematic", "noir", "vintage", "warm", "cool", "vivid", "faded", "dreamy", "dramatic", "sepia", "negative", "night", "retro":
		default:
			return fmt.Errorf("choose an available video look")
		}
	}
	return nil
}

func probeSceneVideo(ctx context.Context, root, file string) (media.Metadata, error) {
	source, err := media.ResolveSource(root, file)
	if err != nil {
		return media.Metadata{}, err
	}
	return media.LoadMetadata(ctx, &mediacache.Default, source, mediacache.Run)
}

func loadSceneVideos(ctx context.Context, session, root string, inputs []SceneVideo) ([]SceneVideo, error) {
	videos := make([]SceneVideo, 0, len(inputs))
	for _, input := range inputs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		media.WarmSession(ctx, session, root, input.File)
		loaded, err := readSceneVideo(ctx, root, input, probeSceneVideo)
		if err != nil {
			return nil, &sceneVideoError{message: fmt.Sprintf("Could not use %q. Choose H.264 MP4 or VP8/VP9 WebM, up to %d MB and %d seconds.", input.Name, maxSceneVideoBytes>>20, maxSceneSeconds), cause: err}
		}
		videos = append(videos, loaded)
	}
	return videos, nil
}

func readSceneVideo(ctx context.Context, root string, input SceneVideo, probe func(context.Context, string, string) (media.Metadata, error)) (SceneVideo, error) {
	path, err := storage.SafeJoinIn(root, input.File)
	if err != nil {
		return SceneVideo{}, fmt.Errorf("resolve scene video: %w", err)
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > maxSceneVideoBytes {
		return SceneVideo{}, fmt.Errorf("video must be a regular file of at most %d MB", maxSceneVideoBytes>>20)
	}
	metadata, err := probe(ctx, root, input.File)
	if err != nil {
		return SceneVideo{}, fmt.Errorf("inspect scene video: %w", err)
	}
	mime, err := sceneVideoMIME(metadata)
	if err != nil {
		return SceneVideo{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		return SceneVideo{}, fmt.Errorf("open scene video: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSceneVideoBytes+1))
	if err != nil {
		return SceneVideo{}, fmt.Errorf("read scene video: %w", err)
	}
	if len(data) == 0 || len(data) > maxSceneVideoBytes {
		return SceneVideo{}, fmt.Errorf("video is empty or exceeds %d MB", maxSceneVideoBytes>>20)
	}
	input.Width, input.Height, input.Duration = metadata.Width, metadata.Height, metadata.Duration
	input.DataURL = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	return input, nil
}

func sceneVideoMIME(metadata media.Metadata) (string, error) {
	if !finite(metadata.Duration) || metadata.Duration <= 0 || metadata.Duration > maxSceneSeconds || metadata.Width <= 0 || metadata.Height <= 0 || metadata.Width > maxSceneVideoDimension || metadata.Height > maxSceneVideoDimension {
		return "", fmt.Errorf("video must last at most %d seconds with dimensions up to %d pixels", maxSceneSeconds, maxSceneVideoDimension)
	}
	if strings.Contains(metadata.FormatName, "mp4") && metadata.VideoCodec == "h264" {
		return "video/mp4", nil
	}
	if strings.Contains(metadata.FormatName, "webm") && (metadata.VideoCodec == "vp8" || metadata.VideoCodec == "vp9") {
		return "video/webm", nil
	}
	return "", fmt.Errorf("choose H.264 MP4 or VP8/VP9 WebM")
}

func videoSources(videos []SceneVideo) map[string]string {
	if len(videos) == 0 {
		return nil
	}
	sources := make(map[string]string, len(videos))
	for _, video := range videos {
		sources[video.ID] = video.DataURL
	}
	return sources
}

func validateVideoSources(videos map[string]string) error {
	if len(videos) > maxSceneVideos {
		return fmt.Errorf("scene contains too many videos")
	}
	for id, source := range videos {
		allowed := strings.HasPrefix(source, "data:video/mp4;base64,") || strings.HasPrefix(source, "data:video/webm;base64,")
		if !videoID.MatchString(id) || !allowed || len(source) > base64.StdEncoding.EncodedLen(maxSceneVideoBytes)+64 {
			return fmt.Errorf("scene contains an invalid embedded video")
		}
	}
	return nil
}
