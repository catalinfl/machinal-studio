package media

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const localOperationTimeout = 2 * time.Minute

type LocalSelection struct {
	File          string `json:"file" jsonschema:"Exact relative file path from the approved local listing"`
	SourceVersion string `json:"sourceVersion,omitempty" jsonschema:"If inspected, pin the sha256 sourceVersion returned by inspect_local_media"`
}

type LocalImportRequest struct {
	RootID string           `json:"rootId"`
	Files  []LocalSelection `json:"files"`
}

type localImportResult struct {
	Source        string `json:"source"`
	File          string `json:"file"`
	SourceVersion string `json:"sourceVersion"`
	Bytes         int64  `json:"bytes"`
	Reused        bool   `json:"reused"`
}

func (s *LocalSources) Import(c *fiber.Ctx) error {
	var request LocalImportRequest
	if err := document.DecodeJSON(c.Body(), &request); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid local import request.")
	}
	if err := validateLocalSelections(request.Files, maxLocalFiles); err != nil {
		return err
	}
	root, err := s.open(c, request.RootID)
	if err != nil {
		return err
	}
	defer root.Close()
	destination, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	lock, _ := uploadLocks.LoadOrStore(session, &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()
	release := sessions.UseWorkspace(session)
	defer release()
	ctx, cancel := context.WithTimeout(c.UserContext(), localOperationTimeout)
	defer cancel()
	results := []localImportResult{}
	var total int64
	for _, selected := range request.Files {
		result, err := importLocalFile(ctx, root, destination, session, selected, maxUploadBytes-total)
		if err != nil {
			var failure *fiber.Error
			if !errors.As(err, &failure) {
				failure = fiber.ErrInternalServerError
			}
			return c.Status(failure.Code).JSON(fiber.Map{"error": failure.Message, "files": results, "failed": selected.File, "partial": len(results) > 0})
		}
		total += result.Bytes
		results = append(results, result)
	}
	return c.JSON(fiber.Map{"files": results, "storage": "volume", "transfer": "local-copy", "uploadsToS3": false, "originalsReadOnly": true})
}

func validateLocalSelections(files []LocalSelection, maximum int) error {
	if len(files) == 0 || len(files) > maximum {
		return fiber.NewError(fiber.StatusBadRequest, fmt.Sprintf("Select 1–%d local files.", maximum))
	}
	seen := map[string]bool{}
	for _, selected := range files {
		if !supportedLocalFile(selected.File) || seen[selected.File] {
			return fiber.NewError(fiber.StatusBadRequest, "Select distinct supported media files using exact relative paths.")
		}
		if selected.SourceVersion != "" && (len(selected.SourceVersion) != len("sha256:")+sha256.Size*2 || !strings.HasPrefix(selected.SourceVersion, "sha256:") || strings.Trim(strings.TrimPrefix(selected.SourceVersion, "sha256:"), "0123456789abcdef") != "") {
			return fiber.NewError(fiber.StatusBadRequest, "Use the exact sha256 sourceVersion returned by inspection.")
		}
		seen[selected.File] = true
	}
	return nil
}

type localContextReader struct {
	ctx context.Context
	io.Reader
}

func (r localContextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.Reader.Read(buffer)
}

func localDigest(ctx context.Context, file *os.File, size int64) (string, error) {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", fiber.NewError(fiber.StatusConflict, "Local file could not be read.")
	}
	digest := sha256.New()
	written, err := io.Copy(digest, localContextReader{ctx, io.LimitReader(file, size+1)})
	if err != nil || written != size {
		return "", fiber.NewError(fiber.StatusConflict, "Local file changed or reading was cancelled. Originals were not modified.")
	}
	return fmt.Sprintf("sha256:%x", digest.Sum(nil)), nil
}

func importLocalFile(ctx context.Context, root *os.Root, destination, session string, selected LocalSelection, remaining int64) (localImportResult, error) {
	source, info, err := openLocalPath(root, selected.File, false)
	if err != nil {
		return localImportResult{}, err
	}
	defer source.Close()
	if info.Size() <= 0 || info.Size() > remaining {
		return localImportResult{}, fiber.NewError(fiber.StatusRequestEntityTooLarge, fmt.Sprintf("Local imports must contain nonempty files totaling at most %s per request.", maxUploadLabel))
	}
	version, err := localDigest(ctx, source, info.Size())
	if err != nil {
		return localImportResult{}, err
	}
	if selected.SourceVersion != "" && selected.SourceVersion != version {
		return localImportResult{}, fiber.NewError(fiber.StatusConflict, "Local source changed since inspection. Inspect it again before use.")
	}
	name := "local_" + strings.TrimPrefix(version, "sha256:") + strings.ToLower(path.Ext(selected.File))
	result := localImportResult{Source: selected.File, File: name, SourceVersion: version, Bytes: info.Size()}
	if reused, err := reuseLocalCopy(ctx, destination, name, version, info.Size()); err != nil || reused {
		result.Reused = reused
		return result, err
	}
	if err := checkUploadQuota(destination, session, info.Size()); err != nil {
		return localImportResult{}, err
	}
	if err := storeLocalCopy(ctx, source, info, destination, name, version); err != nil {
		return localImportResult{}, err
	}
	return result, nil
}

func reuseLocalCopy(ctx context.Context, destination, name, version string, size int64) (bool, error) {
	root, err := os.OpenRoot(destination)
	if err != nil {
		return false, fiber.NewError(fiber.StatusServiceUnavailable, "Project workspace is unavailable.")
	}
	defer root.Close()
	if _, err := root.Lstat(name); errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	file, info, err := openLocalPath(root, name, false)
	if err != nil {
		return false, fiber.NewError(fiber.StatusConflict, "The import destination already exists and cannot be reused. No file was overwritten.")
	}
	defer file.Close()
	if info.Size() == size {
		actual, err := localDigest(ctx, file, size)
		if err == nil && actual == version {
			return true, nil
		}
	}
	return false, fiber.NewError(fiber.StatusConflict, "The import destination contains different bytes. No file was overwritten.")
}

func storeLocalCopy(ctx context.Context, source *os.File, before os.FileInfo, destination, name, version string) error {
	tmp, err := os.CreateTemp(destination, ".local-import-*")
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Cannot create local working copy.")
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if _, err := source.Seek(0, io.SeekStart); err != nil {
		return fiber.NewError(fiber.StatusConflict, "Cannot reread local source.")
	}
	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(tmp, digest), localContextReader{ctx, io.LimitReader(source, before.Size()+1)})
	after, statErr := source.Stat()
	if err != nil || statErr != nil || written != before.Size() || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) || fmt.Sprintf("sha256:%x", digest.Sum(nil)) != version {
		return fiber.NewError(fiber.StatusConflict, "Local source changed or copying was cancelled. No final working copy was published.")
	}
	if err := tmp.Close(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Cannot finish local working copy.")
	}
	if err := validateUploadContent(tmp.Name(), name); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return fiber.NewError(fiber.StatusRequestTimeout, "Local import cancelled or timed out.")
	}
	// Link publishes complete bytes atomically without replacing an existing asset.
	if err := os.Link(tmp.Name(), filepath.Join(destination, name)); err != nil {
		return fiber.NewError(fiber.StatusConflict, "Cannot publish local working copy without overwriting. Existing files were preserved.")
	}
	return nil
}
