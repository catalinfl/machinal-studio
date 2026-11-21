package media

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"

	"ffmpeg-go-server/internal/platform/mediacache"

	"github.com/gofiber/fiber/v2"
)

const audioPreviewProfile = "audio-preview-v1-aac-128k"

const (
	audioPreviewBitrate = "128k"
	// audioPreviewMinSize is the smallest plausible MP4: one ftyp, moov and
	// mdat box header. Anything smaller cannot decode, so reject it early.
	audioPreviewMinSize = 12
	// audioPreviewMaxBoxes bounds the box walk against malformed or
	// adversarial input that claims huge box counts.
	audioPreviewMaxBoxes = 1024
	audioBoxHeaderSize   = 8
	audioBoxLargeSize    = 16
)

var errNoPreviewAudio = errors.New("media has no audio stream")

// AudioPreview serves a cached AAC preview of the first audio stream.
func AudioPreview(c *fiber.Ctx) error {
	root, session := SessionRoot(c)
	if session == "" {
		return c.Status(fiber.StatusUnauthorized).SendString("login required")
	}
	WarmSession(c.UserContext(), session, root, c.Query("file"))
	return serveAudioPreview(c, root, &mediacache.Default, mediacache.Run)
}

func serveAudioPreview(c *fiber.Ctx, root string, cache *mediacache.Cache, run mediacache.Runner) error {
	source, err := ResolveSource(root, c.Query("file"))
	if err != nil {
		return AssetError(c, err)
	}
	if _, err := loadMetadata(c.UserContext(), cache, source, run); err != nil {
		return AssetError(c, err)
	}
	path, err := getAudioPreview(c.UserContext(), cache, source, run)
	if err != nil {
		return handleAudioPreviewError(c, source, err)
	}
	if AssetNotModified(c, source, audioPreviewProfile) {
		return c.Send(nil)
	}
	return SendAsset(c, path, "audio/mp4")
}

func getAudioPreview(ctx context.Context, cache *mediacache.Cache, source mediacache.Source, run mediacache.Runner) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, mediacache.ProxyTimeout)
	defer cancel()
	return cache.Get(ctx, source, audioPreviewProfile, "audio.mp4", func(output string) error {
		return generateAudioPreview(ctx, source, run, output)
	}, validateAudioPreview)
}

func generateAudioPreview(ctx context.Context, source mediacache.Source, run mediacache.Runner, output string) error {
	if err := probePreviewAudio(ctx, source, run); err != nil {
		return err
	}
	threads := strconv.Itoa(mediacache.Threads)
	_, err := run(ctx, "ffmpeg", "-nostdin", "-v", "error", "-y",
		"-threads", threads, "-filter_threads", "1", "-protocol_whitelist", "file,pipe",
		"-i", source.Path, "-map", "0:a:0", "-vn", "-sn", "-dn",
		"-c:a", "aac", "-b:a", audioPreviewBitrate, "-threads", threads,
		"-movflags", "+faststart", "-f", "mp4", output)
	if err != nil {
		return fmt.Errorf("encode audio preview: %w", err)
	}
	return nil
}

func handleAudioPreviewError(c *fiber.Ctx, source mediacache.Source, err error) error {
	if !errors.Is(err, errNoPreviewAudio) {
		return AssetError(c, err)
	}
	// Generation errors bypass Cache's final source/context checks.
	if err := c.UserContext().Err(); err != nil {
		return AssetError(c, err)
	}
	if err := source.Check(); err != nil {
		return AssetError(c, err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.SendStatus(fiber.StatusNoContent)
}

func probePreviewAudio(ctx context.Context, source mediacache.Source, run mediacache.Runner) error {
	ctx, cancel := context.WithTimeout(ctx, mediacache.ProbeTimeout)
	defer cancel()
	data, err := run(ctx, "ffprobe", "-v", "error", "-threads", "1",
		"-protocol_whitelist", "file,pipe", "-select_streams", "a:0",
		"-show_entries", "stream=index", "-of", "json", source.Path)
	if err != nil {
		return fmt.Errorf("probe preview audio: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("preview audio probe context: %w", err)
	}
	var probe struct {
		Streams []struct {
			Index *int `json:"index"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(data, &probe); err != nil || probe.Streams == nil {
		return fiber.NewError(fiber.StatusUnprocessableEntity, "invalid audio stream probe")
	}
	if len(probe.Streams) == 0 {
		return errNoPreviewAudio
	}
	if len(probe.Streams) != 1 || probe.Streams[0].Index == nil || *probe.Streams[0].Index < 0 {
		return fiber.NewError(fiber.StatusUnprocessableEntity, "invalid audio stream probe")
	}
	return nil
}

func validateAudioPreview(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("stat audio preview: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() < audioPreviewMinSize {
		return fmt.Errorf("invalid audio preview size")
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open audio preview: %w", err)
	}
	defer file.Close()
	// Inspect bounded box headers, not the potentially large encoded payload.
	var offset int64
	var hasType, hasMovie, hasMedia bool
	for boxes := 0; offset < info.Size() && boxes < audioPreviewMaxBoxes; boxes++ {
		size, headerSize, boxType, err := readAudioBoxHeader(file, offset, info.Size())
		if err != nil {
			return err
		}
		if size < headerSize || size > info.Size()-offset {
			return fmt.Errorf("truncated audio MP4 box")
		}
		switch boxType {
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
		return fmt.Errorf("incomplete audio MP4")
	}
	return nil
}

func readAudioBoxHeader(file *os.File, offset, total int64) (size, headerSize int64, boxType string, err error) {
	var header [audioBoxLargeSize]byte
	if _, err := file.ReadAt(header[:audioBoxHeaderSize], offset); err != nil {
		return 0, 0, "", fmt.Errorf("read audio MP4 box: %w", err)
	}
	size = int64(binary.BigEndian.Uint32(header[:4]))
	headerSize = audioBoxHeaderSize
	boxType = string(header[4:8])
	if size == 1 {
		if _, err := file.ReadAt(header[audioBoxHeaderSize:], offset+audioBoxHeaderSize); err != nil {
			return 0, 0, "", fmt.Errorf("read audio MP4 large box: %w", err)
		}
		size = int64(binary.BigEndian.Uint64(header[audioBoxHeaderSize:]))
		headerSize = audioBoxLargeSize
	} else if size == 0 {
		size = total - offset
	}
	return size, headerSize, boxType, nil
}
