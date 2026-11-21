package scrub

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/mediacache"

	"github.com/gofiber/fiber/v2"
)

const (
	previewLongEdge = 480
	// Beyond 2 minutes the timeline preview drops to 15fps so long videos
	// stay scrubbable without exploding proxy size.
	longVideoThreshold = 2 * 60
	longVideoFrameRate = 15
	longVideoGOP       = 30
	// Kept separate from longVideoGOP on purpose: GOP caps keyframe spacing
	// while keyframeMin floors it; they only coincide in this profile.
	longVideoKeyframeMin = 30
	standardVideoGOP     = 6
	standardKeyframeMin  = 1

	// passthroughProfile tags ETags for originals served directly without
	// transcoding. It must differ from the transcode profile below so cached
	// clients never confuse a passthrough with an encoded proxy.
	passthroughProfile = "scrub-passthrough-v1"

	// Preview encode profile: fixed quality/speed tradeoff for previews.
	proxyCRF       = "27"
	proxyPreset    = "ultrafast"
	proxyAudioRate = "96k"

	// Bounds MP4 top-level box walk against malformed/adversarial input.
	maxProxyBoxes = 1024
)

// scrubAspect is the closed set of timeline orientations accepted via ?aspect=.
type scrubAspect string

const (
	aspectLandscape scrubAspect = "landscape"
	aspectPortrait  scrubAspect = "portrait"
	aspectClassic   scrubAspect = "classic"
)

func parseScrubAspect(raw string) (scrubAspect, error) {
	switch scrubAspect(raw) {
	case aspectLandscape, aspectPortrait, aspectClassic:
		return scrubAspect(raw), nil
	case "":
		return aspectLandscape, nil
	default:
		return "", fmt.Errorf("parameter 'aspect' must be 'landscape', 'portrait', or 'classic'")
	}
}

func proxyOutputName(inputFile string, aspect scrubAspect) string {
	ext := filepath.Ext(inputFile)
	base := inputFile[:len(inputFile)-len(ext)]
	return fmt.Sprintf("%s_scrub_%s_%d%s", base, aspect, previewLongEdge, ext)
}

func proxyVideoFilter(aspect scrubAspect) string {
	if aspect == aspectPortrait {
		return fmt.Sprintf("scale=-2:%d,setsar=1,format=yuv420p", previewLongEdge)
	}
	return fmt.Sprintf("scale=%d:-2,setsar=1,format=yuv420p", previewLongEdge)
}

// canPassthroughScrub reports whether the original file is already a
// browser-playable MP4 that needs no proxy transcode: h264 video in yuv420p
// (the only H.264 pixel format all browsers decode), a compatible container,
// and audio that is either absent or itself browser-playable in MP4.
// Anything else falls back to the transcoded proxy below.
func canPassthroughScrub(sourcePath string, metadata media.Metadata) bool {
	switch strings.ToLower(filepath.Ext(sourcePath)) {
	case ".mp4", ".mov", ".m4v":
	default:
		return false
	}
	if metadata.Width <= 0 || metadata.Height <= 0 {
		return false
	}
	if !strings.EqualFold(metadata.VideoCodec, "h264") || !strings.EqualFold(metadata.PixFmt, "yuv420p") {
		return false
	}
	format := strings.ToLower(metadata.FormatName)
	if !strings.Contains(format, "mp4") && !strings.Contains(format, "mov") {
		// Rejects e.g. Matroska/WebM files merely renamed to .mp4.
		return false
	}
	switch strings.ToLower(metadata.AudioCodec) {
	case "", "aac", "mp3":
	default:
		return false
	}
	return true
}

// Proxy creates and serves the bounded preview used while scrubbing the editor
// timeline. The resolution in its name invalidates proxies from older profiles.
func Proxy(c *fiber.Ctx) error {
	root, session := media.SessionRoot(c)
	if session == "" {
		return c.Status(fiber.StatusUnauthorized).SendString("login required")
	}
	source, err := media.ResolveSessionSource(c, root, session, c.Query("file"))
	if err != nil {
		return media.AssetError(c, err)
	}
	return serveSourceProxy(c, source, &mediacache.Default, mediacache.Run)
}

func serveProxy(c *fiber.Ctx, root string, cache *mediacache.Cache, run mediacache.Runner) error {
	source, err := media.ResolveSource(root, c.Query("file"))
	if err != nil {
		return media.AssetError(c, err)
	}
	return serveSourceProxy(c, source, cache, run)
}

func serveSourceProxy(c *fiber.Ctx, source mediacache.Source, cache *mediacache.Cache, run mediacache.Runner) error {
	aspect, err := parseScrubAspect(strings.TrimSpace(c.Query("aspect", string(aspectLandscape))))
	if err != nil {
		return media.AssetError(c, fiber.NewError(fiber.StatusBadRequest, err.Error()))
	}
	metadata, err := media.LoadMetadata(c.UserContext(), cache, source, run)
	if err != nil {
		return media.AssetError(c, err)
	}

	// Fast path: browser-native MP4 originals skip the full transcode and are
	// served directly. The final render still uses the original file, so this
	// changes only how fast the timeline preview becomes available.
	if canPassthroughScrub(source.Path, metadata) {
		if media.AssetNotModified(c, source, passthroughProfile) {
			return c.Send(nil)
		}
		setInlineFilename(c, filepath.Base(source.Path))
		return media.SendPreviewSource(c, source, "video/mp4")
	}

	return serveTranscodedProxy(c, source, metadata, aspect, cache, run)
}

func serveTranscodedProxy(c *fiber.Ctx, source mediacache.Source, metadata media.Metadata, aspect scrubAspect, cache *mediacache.Cache, run mediacache.Runner) error {
	videoFilter := proxyVideoFilter(aspect)
	gop, keyframeMin := standardVideoGOP, standardKeyframeMin
	if metadata.Duration > longVideoThreshold {
		videoFilter = fmt.Sprintf("fps=%d,%s", longVideoFrameRate, videoFilter)
		gop, keyframeMin = longVideoGOP, longVideoKeyframeMin
	}

	outputName := proxyOutputName(filepath.Base(source.Path), aspect)
	profile := fmt.Sprintf("scrub-v2-%s-%d", aspect, previewLongEdge)
	ctx, cancel := context.WithTimeout(c.UserContext(), mediacache.ProxyTimeout)
	defer cancel()
	outputPath, err := cache.Get(ctx, source, profile, outputName, func(output string) error {
		threads := strconv.Itoa(mediacache.Threads)
		input, inputArgs := media.PreviewInput(source)
		args := []string{"-nostdin", "-v", "error", "-y", "-threads", threads, "-filter_threads", "1"}
		args = append(args, inputArgs...)
		args = append(args, "-i", input,
			"-map", "0:V:0?", "-map", "0:a:0?", "-sn", "-dn", "-vf", videoFilter,
			"-c:v", "libx264", "-crf", proxyCRF, "-preset", proxyPreset,
			"-tune", "fastdecode", "-g", strconv.Itoa(gop), "-keyint_min", strconv.Itoa(keyframeMin),
			"-sc_threshold", "0", "-c:a", "aac", "-b:a", proxyAudioRate,
			"-threads", threads, "-movflags", "+faststart", "-f", "mp4", output)
		_, err := run(ctx, "ffmpeg", args...)
		return err
	}, validateProxy)
	if err != nil {
		return media.AssetError(c, err)
	}
	if media.AssetNotModified(c, source, profile) {
		return c.Send(nil)
	}
	// The shipped filename keeps its source extension, but the container and MIME
	// type must be MP4 even for WebM, MKV, and audio inputs.
	setInlineFilename(c, outputName)
	return media.SendAsset(c, outputPath, "video/mp4")
}

func setInlineFilename(c *fiber.Ctx, name string) {
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf("inline; filename=%q", name))
}

func validateProxy(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("stat scrub proxy: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() < 12 {
		return fmt.Errorf("invalid proxy size")
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open scrub proxy: %w", err)
	}
	defer file.Close()
	// Walk top-level boxes without reading encoded media. A truncated MP4 can
	// retain its ftyp header while losing its index or media data. 1024 is a
	// generous ceiling on top-level boxes to bound the loop against malformed
	// or adversarial input.
	var offset int64
	var hasType, hasMovie, hasMedia bool
	for boxes := 0; offset < info.Size() && boxes < maxProxyBoxes; boxes++ {
		var header [16]byte
		if _, err := file.ReadAt(header[:8], offset); err != nil {
			return fmt.Errorf("read MP4 box header: %w", err)
		}
		size := int64(binary.BigEndian.Uint32(header[:4]))
		headerSize := int64(8)
		switch size {
		case 1:
			if _, err := file.ReadAt(header[8:], offset+8); err != nil {
				return fmt.Errorf("read MP4 large box header: %w", err)
			}
			size = int64(binary.BigEndian.Uint64(header[8:]))
			headerSize = 16
		case 0:
			size = info.Size() - offset
		}

		if size < headerSize || size > info.Size()-offset {
			return fmt.Errorf("truncated MP4 box")
		}

		switch string(header[4:8]) {
		case "ftyp":
			hasType = size > headerSize
		case "moov":
			hasMovie = size > headerSize
		case "mdat":
			hasMedia = size > headerSize
		}
		offset += size
	}
	if offset != info.Size() || !hasType || !hasMovie || !hasMedia {
		return fmt.Errorf("incomplete MP4 proxy")
	}
	return nil
}
