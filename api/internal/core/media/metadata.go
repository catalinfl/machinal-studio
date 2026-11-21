package media

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const metadataProfile = "metadata-v2"

const (
	// maxMetadataBytes caps the cached probe JSON so a corrupt cache entry
	// cannot force the server to read an unbounded file.
	maxMetadataBytes = 4096
)

var imageExtensions = map[string]bool{
	".bmp": true, ".gif": true, ".jpeg": true, ".jpg": true, ".png": true, ".webp": true,
}

type Metadata struct {
	Duration   float64 `json:"duration"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	VideoCodec string  `json:"videoCodec,omitempty"`
	PixFmt     string  `json:"pixFmt,omitempty"`
	AudioCodec string  `json:"audioCodec,omitempty"`
	FormatName string  `json:"formatName,omitempty"`
}

type probeResult struct {
	Streams []struct {
		CodecType   string `json:"codec_type"`
		CodecName   string `json:"codec_name"`
		Width       int    `json:"width"`
		Height      int    `json:"height"`
		PixFmt      string `json:"pix_fmt"`
		Duration    string `json:"duration"`
		Disposition struct {
			AttachedPic int `json:"attached_pic"`
		} `json:"disposition"`
		Tags struct {
			Rotate string `json:"rotate"`
		} `json:"tags"`
		SideData []struct {
			Rotation float64 `json:"rotation"`
		} `json:"side_data_list"`
	} `json:"streams"`
	Format struct {
		Duration   string `json:"duration"`
		FormatName string `json:"format_name"`
	} `json:"format"`
}

// MediaMetadata serves cached ffprobe metadata for the requested file.
func MediaMetadata(c *fiber.Ctx) error {
	root, session := SessionRoot(c)
	if session == "" {
		return c.Status(fiber.StatusUnauthorized).SendString("login required")
	}
	source, err := resolvePreviewSource(c.UserContext(), root, c.Query("file"), sessions.S3Prefixes(session), objectstore.Shared())
	if err != nil {
		return AssetError(c, err)
	}
	return serveSourceMetadata(c, source, &mediacache.Default, mediacache.Run)
}

func serveMetadata(c *fiber.Ctx, root string, cache *mediacache.Cache, run mediacache.Runner) error {
	source, err := ResolveSource(root, c.Query("file"))
	if err != nil {
		return AssetError(c, err)
	}
	return serveSourceMetadata(c, source, cache, run)
}

func serveSourceMetadata(c *fiber.Ctx, source mediacache.Source, cache *mediacache.Cache, run mediacache.Runner) error {
	metadata, err := loadMetadata(c.UserContext(), cache, source, run)
	if err != nil {
		return AssetError(c, err)
	}
	if AssetNotModified(c, source, metadataProfile) {
		return c.Send(nil)
	}
	return c.JSON(metadata)
}

// LoadMetadata returns validated metadata from the source-keyed cache.
func LoadMetadata(ctx context.Context, cache *mediacache.Cache, source mediacache.Source, run mediacache.Runner) (Metadata, error) {
	return loadMetadata(ctx, cache, source, run)
}

func loadMetadata(ctx context.Context, cache *mediacache.Cache, source mediacache.Source, run mediacache.Runner) (Metadata, error) {
	ctx, cancel := context.WithTimeout(ctx, mediacache.ProbeTimeout)
	defer cancel()
	image := isImage(source.Path)
	validate := func(path string) error {
		_, err := readMetadata(path, image)
		return err
	}
	path, err := cache.Get(ctx, source, metadataProfile, "metadata.json", func(output string) error {
		return generateMetadata(ctx, source, run, output, image)
	}, validate)
	if err != nil {
		return Metadata{}, err
	}
	return readMetadata(path, image)
}

func generateMetadata(ctx context.Context, source mediacache.Source, run mediacache.Runner, output string, image bool) error {
	input, inputOptions := previewInput(source)
	args := append([]string{"-v", "error", "-threads", "1"}, inputOptions...)
	args = append(args, "-show_entries",
		"format=duration,format_name:stream=codec_type,codec_name,width,height,pix_fmt,duration:stream_disposition=attached_pic:stream_tags=rotate:stream_side_data=rotation",
		"-of", "json", input)
	data, err := run(ctx, "ffprobe", args...)
	if err != nil {
		return fmt.Errorf("probe media metadata: %w", err)
	}
	metadata, err := parseMetadata(data, image)
	if err != nil {
		return err
	}
	data, err = json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal media metadata: %w", err)
	}
	if err := os.WriteFile(output, data, 0600); err != nil {
		return fmt.Errorf("write media metadata: %w", err)
	}
	return nil
}

func parseMetadata(data []byte, image bool) (Metadata, error) {
	var probe probeResult
	if err := json.Unmarshal(data, &probe); err != nil {
		return Metadata{}, fiber.NewError(fiber.StatusUnprocessableEntity, "invalid media metadata")
	}
	collected, err := collectStreamMetadata(&probe)
	if err != nil {
		return Metadata{}, err
	}
	if image {
		if err := enforceImageFormat(&probe, &collected); err != nil {
			return Metadata{}, err
		}
	}
	if !collected.hasMedia || !collected.value.valid(image) {
		return Metadata{}, fiber.NewError(fiber.StatusUnprocessableEntity, "media has no valid duration or dimensions")
	}
	return collected.value, nil
}

type collectedMetadata struct {
	value    Metadata
	hasMedia bool
}

func collectStreamMetadata(probe *probeResult) (collectedMetadata, error) {
	var metadata Metadata
	metadata.Duration = validDuration(probe.Format.Duration)
	metadata.FormatName = probe.Format.FormatName
	collected := collectedMetadata{value: metadata}
	sawVideo, sawAudio := false, false
	for _, stream := range probe.Streams {
		if stream.Disposition.AttachedPic != 0 || (stream.CodecType != "video" && stream.CodecType != "audio") {
			continue
		}
		collected.hasMedia = true
		collected.value.Duration = math.Max(collected.value.Duration, validDuration(stream.Duration))
		if stream.CodecType == "audio" {
			if !sawAudio {
				collected.value.AudioCodec = strings.ToLower(stream.CodecName)
				sawAudio = true
			}
			continue
		}
		if sawVideo {
			continue
		}
		sawVideo = true
		if stream.Width <= 0 || stream.Height <= 0 {
			return collectedMetadata{}, fiber.NewError(fiber.StatusUnprocessableEntity, "invalid video dimensions")
		}
		collected.value.VideoCodec = strings.ToLower(stream.CodecName)
		collected.value.PixFmt = strings.ToLower(stream.PixFmt)
		collected.value.Width, collected.value.Height = applyRotation(stream.Tags.Rotate, stream.SideData, stream.Width, stream.Height)
	}
	return collected, nil
}

func applyRotation(rotate string, sideData []struct {
	Rotation float64 `json:"rotation"`
}, width, height int) (int, int) {
	// Missing or malformed rotate tags mean "no rotation": ParseFloat's error
	// is intentionally ignored and side-data overrides when present.
	rotation, _ := strconv.ParseFloat(rotate, 64)
	for _, data := range sideData {
		rotation = data.Rotation
	}
	if math.Abs(math.Mod(rotation, 180)) == 90 {
		return height, width
	}
	return width, height
}

func enforceImageFormat(probe *probeResult, collected *collectedMetadata) error {
	// Do not let a renamed movie bypass the video duration guard.
	switch probe.Format.FormatName {
	case "image2", "bmp_pipe", "png_pipe", "jpeg_pipe", "webp_pipe", "gif", "apng":
	default:
		return fiber.NewError(fiber.StatusUnprocessableEntity, "file is not a supported image")
	}
	collected.value.Duration = 0
	return nil
}

func validDuration(value string) float64 {
	duration, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(duration) || math.IsInf(duration, 0) || duration < 0 {
		return 0
	}
	return duration
}

func (m Metadata) valid(image bool) bool {
	if math.IsNaN(m.Duration) || math.IsInf(m.Duration, 0) || m.Duration < 0 || m.Width < 0 || m.Height < 0 {
		return false
	}
	if (m.Width == 0) != (m.Height == 0) {
		return false
	}
	if image {
		return m.Duration == 0 && m.Width > 0 && m.Height > 0
	}
	return m.Duration > 0
}

func readMetadata(path string, image bool) (Metadata, error) {
	var metadata Metadata
	info, err := os.Lstat(path)
	if err != nil {
		return metadata, fmt.Errorf("stat metadata cache: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > maxMetadataBytes {
		return metadata, fiber.NewError(fiber.StatusUnprocessableEntity, "invalid metadata cache")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return metadata, fmt.Errorf("read metadata cache: %w", err)
	}
	if err := json.Unmarshal(data, &metadata); err != nil || !metadata.valid(image) {
		return Metadata{}, fiber.NewError(fiber.StatusUnprocessableEntity, "invalid metadata cache")
	}
	return metadata, nil
}

func isImage(path string) bool {
	return imageExtensions[strings.ToLower(filepath.Ext(path))]
}
