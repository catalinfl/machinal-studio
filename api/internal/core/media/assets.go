package media

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"
)

// ResolveSource validates the requested name against traversal and type
// rules, then opens the local source file for downstream handlers.
func ResolveSource(root, name string) (mediacache.Source, error) {
	path, err := sourcePath(root, name)
	if err != nil {
		return mediacache.Source{}, err
	}
	return mediacache.ReadSource(path)
}

func sourcePath(root, name string) (string, error) {
	joined, err := storage.SafeJoinIn(root, name)
	if err != nil || strings.Contains(name, ":") {
		return "", fiber.NewError(fiber.StatusBadRequest, "invalid parameter 'file'")
	}
	if !storage.IsSceneSource(name) && !allowedMediaExtensions[strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")] {
		return "", fiber.NewError(fiber.StatusUnsupportedMediaType, "unsupported file type")
	}
	// Reject leading "-" defense in depth (absolute join already prefixes "/",
	// but keep the invariant explicit).
	if strings.HasPrefix(filepath.Base(name), "-") {
		return "", fiber.NewError(fiber.StatusBadRequest, "invalid parameter 'file'")
	}
	return joined, nil
}

// SessionRoot resolves the per-request volume: "/data/{user}" when the
// request carries a session token, otherwise the legacy shared DataDir.
func SessionRoot(c *fiber.Ctx) (root, session string) {
	return sessions.ResolveRoot(c)
}

// WarmSession pulls name from S3 into the session volume on a cache miss
// (tmp + rename), so scrub/waveform/render keep working on local
// files. It tries the owner prefix first ("<u_uid>/<name>", stable per-user)
// then the raw session prefix, plus "<...>/renders/<name>" via
// EnsureSessionFile, so evicted finals still rehydrate. It is best-effort.
func WarmSession(ctx context.Context, session, root, name string) {
	if session == "" || name == "" {
		return
	}
	if _, err := storage.SafeJoinIn(root, name); err != nil {
		return
	}
	for _, s3user := range sessions.S3Prefixes(session) {
		if _, err := objectstore.EnsureSessionFile(ctx, s3user, root, name); err == nil {
			return
		}
	}
}

// AssetError sends every media failure through one mapping so raw stdlib or
// SDK error text never reaches clients with an ad-hoc status code.
func AssetError(c *fiber.Ctx, err error) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	var httpError *fiber.Error
	var exitError *exec.ExitError
	switch {
	case errors.As(err, &httpError):
		return c.Status(httpError.Code).SendString(httpError.Message)
	case errors.Is(err, os.ErrNotExist):
		return c.Status(fiber.StatusNotFound).SendString("source file doesn't exist")
	case errors.Is(err, mediacache.ErrInvalidSource):
		return c.Status(fiber.StatusBadRequest).SendString(err.Error())
	case errors.Is(err, mediacache.ErrSourceChanged), errors.Is(err, objectstore.ErrObjectChanged):
		return c.Status(fiber.StatusConflict).SendString(mediacache.ErrSourceChanged.Error())
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return c.Status(fiber.StatusGatewayTimeout).SendString("media processing timed out or was canceled; retry the request")
	case errors.As(err, &exitError):
		return c.Status(fiber.StatusUnprocessableEntity).SendString("cannot decode media")
	default:
		return c.Status(fiber.StatusInternalServerError).SendString("media processing failed")
	}
}

// AssetNotModified negotiates the strong source ETag for a mutable URL.
// URLs contain mutable source names, so clients must revalidate on every reuse.
// This is called only after checking the source and completing the cache entry.
func AssetNotModified(c *fiber.Ctx, source mediacache.Source, profile string) bool {
	etag := `"` + source.Key(profile) + `"`
	c.Set(fiber.HeaderCacheControl, "private, no-cache")
	c.Set(fiber.HeaderETag, etag)
	for _, candidate := range strings.Split(c.Get(fiber.HeaderIfNoneMatch), ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			c.Status(fiber.StatusNotModified)
			return true
		}
	}
	return false
}

// SendAsset streams a cached file with range and HEAD support.
func SendAsset(c *fiber.Ctx, path, contentType string) error {
	// Defense in depth: asset bytes are embedded cross-origin via
	// <img>/<video>/<audio> tags. The global security middleware already sends
	// CORP cross-origin for these paths, but re-assert here so a middleware
	// reorder can never reintroduce the "blocked due to CORP" thumbnail outage.
	c.Set("Cross-Origin-Resource-Policy", "cross-origin")
	file, length, err := openAssetFile(path)
	if err != nil {
		return AssetError(c, err)
	}
	start, end, ranged, err := negotiateAssetRange(c, length)
	if err != nil {
		file.Close()
		return AssetError(c, err)
	}
	return serveAssetStream(c, file, contentType, length, start, end, ranged)
}

func openAssetFile(path string) (*os.File, int, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, 0, fmt.Errorf("open asset: %w", err)
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, 0, fmt.Errorf("stat asset: %w", err)
	}
	return file, int(info.Size()), nil
}

func negotiateAssetRange(c *fiber.Ctx, length int) (int, int, bool, error) {
	byteRange := c.Get(fiber.HeaderRange)
	// Only our strong source ETag can safely resume a mutable source URL.
	if ifRange := c.Get(fiber.HeaderIfRange); ifRange != "" && ifRange != c.GetRespHeader(fiber.HeaderETag) {
		byteRange = ""
	}
	if byteRange == "" {
		return 0, 0, false, nil
	}
	start, end, err := fasthttp.ParseByteRange([]byte(byteRange), length)
	if err != nil {
		c.Set(fiber.HeaderContentRange, fmt.Sprintf("bytes */%d", length))
		return 0, 0, false, fiber.NewError(fiber.StatusRequestedRangeNotSatisfiable, "invalid byte range")
	}
	return start, end, true, nil
}

func serveAssetStream(c *fiber.Ctx, file *os.File, contentType string, length, start, end int, ranged bool) error {
	if ranged {
		if _, err := file.Seek(int64(start), io.SeekStart); err != nil {
			file.Close()
			return AssetError(c, fmt.Errorf("seek asset: %w", err))
		}
		c.Status(fiber.StatusPartialContent)
		c.Set(fiber.HeaderContentRange, fmt.Sprintf("bytes %d-%d/%d", start, end, length))
		length = end - start + 1
	}
	c.Set(fiber.HeaderAcceptRanges, "bytes")
	c.Set(fiber.HeaderContentType, contentType)
	if c.Method() == fiber.MethodHead {
		c.Response().Header.SetContentLength(length)
		return file.Close()
	}
	// The response owns and closes this file, without Fiber's persistent FS cache.
	return c.SendStream(&assetStream{Reader: io.LimitReader(file, int64(length)), Closer: file}, length)
}

type assetStream struct {
	io.Reader
	io.Closer
}
