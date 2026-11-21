package media

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const (
	// Outlives bounded metadata/thumbnail jobs without granting a long-lived URL.
	previewURLLifetime = 5 * time.Minute
	// Remote inputs must never select playlist/concat demuxers that fetch other URLs.
	previewFormats = "mov,matroska,webm,avi,mpeg,mpegvideo,mpegts,m4v,ogg,aac,flac,mp3,wav,image2,bmp_pipe,png_pipe,jpeg_pipe,webp_pipe,gif,apng"
)

type previewStore interface {
	Enabled() bool
	Head(context.Context, string) (objectstore.Object, error)
	PresignGet(string, time.Duration) (string, error)
}

type objectLookup interface {
	Head(context.Context, string) (objectstore.Object, error)
}

func ResolveSessionSource(c *fiber.Ctx, root, session, name string) (mediacache.Source, error) {
	return resolvePreviewSource(c.UserContext(), root, name, sessions.S3Prefixes(session), objectstore.Shared())
}

func PreviewInput(source mediacache.Source) (string, []string) {
	return previewInput(source)
}

func SendPreviewSource(c *fiber.Ctx, source mediacache.Source, contentType string) error {
	if source.Remote == nil {
		return SendAsset(c, source.Path, contentType)
	}
	c.Set("Cross-Origin-Resource-Policy", "cross-origin")
	return streamRemoteDownload(c, source, objectstore.Shared())
}

func resolvePreviewSource(ctx context.Context, root, name string, prefixes []string, store previewStore) (mediacache.Source, error) {
	path, err := sourcePath(root, name)
	if err != nil {
		return mediacache.Source{}, err
	}
	source, err := mediacache.ReadSource(path)
	if err == nil || !errors.Is(err, os.ErrNotExist) || !store.Enabled() {
		return source, err
	}
	ctx, cancel := context.WithTimeout(ctx, mediacache.ProbeTimeout)
	defer cancel()
	object, err := findPreviewObject(ctx, name, prefixes, store)
	if err != nil {
		return mediacache.Source{}, err
	}
	inputURL, err := store.PresignGet(object.Key, previewURLLifetime)
	if err != nil {
		return mediacache.Source{}, fmt.Errorf("sign preview input: %w", err)
	}
	return mediacache.Source{
		Path: path,
		Size: object.Size,
		Remote: &mediacache.RemoteSource{
			Key: object.Key, ETag: object.ETag, URL: inputURL,
		},
	}, nil
}

func findPreviewObject(ctx context.Context, name string, prefixes []string, store objectLookup) (objectstore.Object, error) {
	for _, prefix := range prefixes {
		keys := objectstore.SessionKeys(prefix, name)
		if sessions.IsRenderOutput(name) {
			keys[0], keys[1] = keys[1], keys[0]
		}
		for _, key := range keys {
			object, err := store.Head(ctx, key)
			if err == nil {
				return object, nil
			}
			if !errors.Is(err, os.ErrNotExist) {
				return objectstore.Object{}, fmt.Errorf("resolve preview source: %w", err)
			}
		}
	}
	return objectstore.Object{}, os.ErrNotExist
}

func previewInput(source mediacache.Source) (string, []string) {
	if source.Remote == nil {
		return source.Path, []string{"-protocol_whitelist", "file,pipe"}
	}
	protocols := "https,tls,tcp"
	if strings.HasPrefix(source.Remote.URL, "http://") {
		protocols = "http,tcp"
	}
	return source.Remote.URL, []string{
		"-protocol_whitelist", protocols,
		"-format_whitelist", previewFormats,
		"-headers", "If-Match: \"" + source.Remote.ETag + "\"\r\n",
	}
}

func streamRemoteDownload(c *fiber.Ctx, source mediacache.Source, store *objectstore.Client) error {
	if AssetNotModified(c, source, "download-v1") {
		return c.Send(nil)
	}
	start, end, ranged, err := negotiateAssetRange(c, int(source.Size))
	if err != nil {
		return AssetError(c, err)
	}
	byteRange := ""
	length := source.Size
	if ranged {
		byteRange = fmt.Sprintf("bytes=%d-%d", start, end)
		length = int64(end - start + 1)
	}
	if c.Method() == fiber.MethodHead {
		setRemoteDownloadHeaders(c, source, start, end, ranged, int(length))
		return nil
	}
	body, size, _, err := store.GetRange(c.UserContext(), source.Remote.Key, byteRange, source.Remote.ETag)
	if err != nil {
		return AssetError(c, err)
	}
	if size != length {
		body.Close()
		return AssetError(c, mediacache.ErrSourceChanged)
	}
	setRemoteDownloadHeaders(c, source, start, end, ranged, int(length))
	return c.SendStream(body, int(length))
}

func setRemoteDownloadHeaders(c *fiber.Ctx, source mediacache.Source, start, end int, ranged bool, length int) {
	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(source.Path)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Set(fiber.HeaderContentType, contentType)
	c.Set(fiber.HeaderAcceptRanges, "bytes")
	if ranged {
		c.Status(fiber.StatusPartialContent)
		c.Set(fiber.HeaderContentRange, fmt.Sprintf("bytes %d-%d/%d", start, end, source.Size))
	}
	if c.Method() == fiber.MethodHead {
		c.Response().Header.SetContentLength(length)
	}
}
