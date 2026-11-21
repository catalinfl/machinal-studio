package media

import (
	"context"
	"fmt"
	"image/jpeg"
	"os"
	"strconv"

	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const (
	thumbnailProfile = "thumbnail-v1-320"
	// thumbnailLongEdge is the bounding box for the preview scale filter and
	// the decoded JPEG dimensions below; one const so they cannot drift.
	thumbnailLongEdge = 320
	// maxThumbnailBytes caps decoded JPEGs against corrupt cache entries.
	maxThumbnailBytes = 1 << 20
	// thumbnailQuality balances preview sharpness against cache size for
	// single-frame mjpeg encodes.
	thumbnailQuality = "4"
	// thumbnailFilterThreads caps ffmpeg filter-graph parallelism per request.
	thumbnailFilterThreads = "1"
	// thumbnailEncodeThreads caps the single-frame mjpeg encode. Kept separate
	// from thumbnailFilterThreads: equal today, different encoder concepts.
	thumbnailEncodeThreads = "1"
)

var thumbnailFilter = fmt.Sprintf("scale=w='min(%d,iw)':h='min(%d,ih)':force_original_aspect_ratio=decrease,setsar=1", thumbnailLongEdge, thumbnailLongEdge)

// Thumbnail serves a cached 320px JPEG preview of the first video frame.
func Thumbnail(c *fiber.Ctx) error {
	root, session := SessionRoot(c)
	if session == "" {
		return c.Status(fiber.StatusUnauthorized).SendString("login required")
	}
	source, err := resolvePreviewSource(c.UserContext(), root, c.Query("file"), sessions.S3Prefixes(session), objectstore.Shared())
	if err != nil {
		return AssetError(c, err)
	}
	return serveSourceThumbnail(c, source, &mediacache.Default, mediacache.Run)
}

func serveThumbnail(c *fiber.Ctx, root string, cache *mediacache.Cache, run mediacache.Runner) error {
	source, err := ResolveSource(root, c.Query("file"))
	if err != nil {
		return AssetError(c, err)
	}
	return serveSourceThumbnail(c, source, cache, run)
}

func serveSourceThumbnail(c *fiber.Ctx, source mediacache.Source, cache *mediacache.Cache, run mediacache.Runner) error {
	metadata, err := loadMetadata(c.UserContext(), cache, source, run)
	if err != nil {
		return AssetError(c, err)
	}
	if err := checkThumbnailSupport(metadata); err != nil {
		return AssetError(c, err)
	}
	path, err := getThumbnail(c.UserContext(), cache, source, run)
	if err != nil {
		return AssetError(c, err)
	}
	if AssetNotModified(c, source, thumbnailProfile) {
		return c.Send(nil)
	}
	return SendAsset(c, path, "image/jpeg")
}

func checkThumbnailSupport(metadata Metadata) error {
	if metadata.Width == 0 || metadata.Height == 0 {
		return fiber.NewError(fiber.StatusUnsupportedMediaType, "audio thumbnails are not supported")
	}
	return nil
}

func getThumbnail(ctx context.Context, cache *mediacache.Cache, source mediacache.Source, run mediacache.Runner) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, mediacache.ThumbnailTimeout)
	defer cancel()
	return cache.Get(ctx, source, thumbnailProfile, "thumbnail.jpg", func(output string) error {
		return generateThumbnail(ctx, source, run, output)
	}, validateThumbnail)
}

func generateThumbnail(ctx context.Context, source mediacache.Source, run mediacache.Runner, output string) error {
	input, inputOptions := previewInput(source)
	args := []string{"-nostdin", "-v", "error", "-y",
		"-threads", strconv.Itoa(mediacache.Threads), "-filter_threads", thumbnailFilterThreads}
	args = append(args, inputOptions...)
	args = append(args, "-i", input,
		"-map", "0:V:0", "-an", "-sn", "-dn", "-frames:v", "1",
		"-vf", thumbnailFilter, "-c:v", "mjpeg", "-q:v", thumbnailQuality,
		"-threads", thumbnailEncodeThreads, "-f", "image2", "-update", "1", output)
	_, err := run(ctx, "ffmpeg", args...)
	if err != nil {
		return fmt.Errorf("encode thumbnail: %w", err)
	}
	return nil
}

func validateThumbnail(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("stat thumbnail: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxThumbnailBytes {
		return fmt.Errorf("invalid thumbnail size")
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open thumbnail: %w", err)
	}
	defer file.Close()
	config, err := jpeg.DecodeConfig(file)
	if err != nil {
		return fmt.Errorf("decode thumbnail config: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > thumbnailLongEdge || config.Height > thumbnailLongEdge {
		return fmt.Errorf("invalid thumbnail dimensions")
	}
	if _, err := file.Seek(0, 0); err != nil {
		return fmt.Errorf("rewind thumbnail: %w", err)
	}
	if _, err := jpeg.Decode(file); err != nil {
		return fmt.Errorf("decode thumbnail: %w", err)
	}
	return nil
}
