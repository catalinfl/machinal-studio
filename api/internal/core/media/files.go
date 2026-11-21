package media

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"ffmpeg-go-server/editengine/scenecontract"
	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

var allowedMediaExtensions = map[string]bool{
	"avi": true, "m4v": true, "mkv": true, "mov": true, "mp4": true,
	"mpeg": true, "mpg": true, "ogv": true, "webm": true,
	"aac": true, "flac": true, "m4a": true, "mp3": true, "oga": true, "ogg": true, "wav": true,
	"bmp": true, "gif": true, "jpeg": true, "jpg": true, "png": true, "webp": true,
}

var uploadLocks sync.Map

const (
	// maxUploadBytes caps multipart uploads so one request cannot exhaust the
	// session volume or the host disk. 2GiB fits full-length source files
	// while keeping quota checks cheap.
	maxUploadBytes int64 = 2 << 30
	maxUploadLabel       = "2GB"
)

type scrubAspect string

const (
	scrubLandscape scrubAspect = "landscape"
	scrubPortrait  scrubAspect = "portrait"
	scrubClassic   scrubAspect = "classic"
)

func fileFail(c *fiber.Ctx, status int, message string) error {
	return c.Status(status).SendString(message)
}

func sendFileError(c *fiber.Ctx, err error) error {
	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) {
		return fileFail(c, fiberErr.Code, fiberErr.Message)
	}
	return fileFail(c, fiber.StatusInternalServerError, "media processing failed")
}

// Upload stores a multipart media file via tmp+rename.
func Upload(c *fiber.Ctx) error {
	file, fileName, err := parseUpload(c)
	if err != nil {
		return sendFileError(c, err)
	}
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Upload workspace is unavailable.")
	}
	lock, _ := uploadLocks.LoadOrStore(session, &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()
	release := sessions.UseWorkspace(session)
	defer release()
	if err := checkUploadQuota(root, session, file.Size); err != nil {
		return sendFileError(c, err)
	}
	dst, err := storeUpload(c, root, session, file, fileName)
	if err != nil {
		return sendFileError(c, err)
	}
	if strings.HasPrefix(c.Path(), "/v1/") {
		return c.JSON(fiber.Map{"file": fileName, "bytes": file.Size, "storage": "volume"})
	}
	return c.SendString(fmt.Sprintf("Upload successful: %s (%d bytes)\n", dst, file.Size))
}

func parseUpload(c *fiber.Ctx) (*multipart.FileHeader, string, error) {
	file, err := c.FormFile("file")
	if err != nil {
		return nil, "", fiber.NewError(fiber.StatusBadRequest, "field 'file' is missing")
	}
	if file.Size > maxUploadBytes {
		return nil, "", fiber.NewError(fiber.StatusRequestEntityTooLarge, fmt.Sprintf("file too large (max %s)", maxUploadLabel))
	}
	fileName := filepath.Base(file.Filename)
	extension := strings.ToLower(filepath.Ext(fileName))
	if fileName == "" || extension == "" || (!allowedMediaExtensions[strings.TrimPrefix(extension, ".")] && !(extension == ".glb" && strings.HasPrefix(c.Path(), "/v1/"))) {
		return nil, "", fiber.NewError(fiber.StatusUnsupportedMediaType, "unsupported file type")
	}
	// Defense in depth: a leading "-" could become a flag if the name ever
	// reaches an argv position without an absolute-path prefix.
	if strings.HasPrefix(filepath.Base(fileName), "-") {
		return nil, "", fiber.NewError(fiber.StatusBadRequest, "invalid file name")
	}
	if extension == ".glb" && file.Size > scenecontract.MaxModelBytes {
		return nil, "", fiber.NewError(fiber.StatusRequestEntityTooLarge, "GLB model exceeds 4 MiB.")
	}
	return file, fileName, nil
}

func checkUploadQuota(root, session string, size int64) error {
	if session == "" {
		return nil
	}
	if quota := sessions.MaxSessionBytes(); quota > 0 && sessions.DirSize(root)+size > quota {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge, "session storage quota exceeded")
	}
	return nil
}

func storeUpload(c *fiber.Ctx, root, session string, file *multipart.FileHeader, fileName string) (string, error) {
	dst, err := storage.SafeJoinIn(root, fileName)
	if err != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	tmp, err := os.CreateTemp(root, ".upload-*")
	if err != nil {
		return "", fiber.NewError(fiber.StatusInternalServerError, "cannot store upload")
	}
	tmpName := tmp.Name()
	// Intentionally best-effort: Close only releases the reservation probe;
	// SaveFile reopens tmpName and Rename finalizes the upload.
	_ = tmp.Close()
	// Remove the empty probe so SaveFile recreates it with uploaded content.
	_ = os.Remove(tmpName)
	if err := c.SaveFile(file, tmpName); err != nil {
		// Best-effort cleanup: a leftover tmp file is hidden and reaped on restart.
		_ = os.Remove(tmpName)
		return "", fiber.NewError(fiber.StatusInternalServerError, "cannot store upload")
	}
	// Sniff content before publish: extension alone lets M3U8/HTML bytes named
	// x.mp4 reach ffmpeg (SSRF) or browsers (stored XSS). Reject playlists,
	// HTML/text, and empty files here; per-type ffprobe validation happens on
	// first metadata/thumbnail use.
	if err := validateUploadContent(tmpName, fileName); err != nil {
		_ = os.Remove(tmpName)
		return "", err
	}
	if err := os.Rename(tmpName, dst); err != nil {
		// Best-effort cleanup: Rename failed, so tmpName may still exist.
		_ = os.Remove(tmpName)
		return "", fiber.NewError(fiber.StatusInternalServerError, "cannot store upload")
	}
	// API sources belong to the persistent project volume, not the cloud library.
	if session != "" && c.Locals("machinalAPIKey") == nil {
		prefix := sessions.S3Prefix(session)
		objectstore.BackgroundPut(prefix, dst, objectstore.Key(prefix, fileName))
	}
	return dst, nil
}

// validateUploadContent sniffs the staged temp file before rename. It rejects
// empty files, HTML/text, and playlist manifests (m3u/m3u8/pls) that could
// otherwise pass the extension gate and trigger SSRF in ffmpeg or stored XSS
// when served inline. Full codec validation stays in ffprobe on first use.
func validateUploadContent(tmpPath, fileName string) error {
	f, err := os.Open(tmpPath)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "cannot store upload")
	}
	defer f.Close()
	if strings.EqualFold(filepath.Ext(fileName), ".glb") {
		data, err := io.ReadAll(io.LimitReader(f, scenecontract.MaxModelBytes+1))
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "cannot read model upload")
		}
		if err := scenecontract.ValidateModelContainer(data); err != nil {
			return fiber.NewError(fiber.StatusUnsupportedMediaType, "Invalid or unsupported self-contained GLB model.")
		}
		return nil
	}
	head := make([]byte, 512)
	n, err := io.ReadFull(f, head)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return fiber.NewError(fiber.StatusInternalServerError, "cannot store upload")
	}
	if n == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "empty file")
	}
	head = head[:n]
	ctype := http.DetectContentType(head)
	lower := strings.ToLower(string(head))
	trimmed := strings.TrimSpace(lower)
	// Playlist manifests: #EXTM3U, #EXT-X-..., [playlist], pls.
	if strings.HasPrefix(trimmed, "#extm3u") || strings.HasPrefix(trimmed, "#ext-x-") ||
		strings.HasPrefix(trimmed, "[playlist") || strings.Contains(trimmed, "file://") && strings.Contains(trimmed, "#ext") {
		return fiber.NewError(fiber.StatusUnsupportedMediaType, "playlist files are not supported")
	}
	// HTML / text / scripts must never become x.mp4 polyglots.
	if strings.HasPrefix(ctype, "text/html") || strings.HasPrefix(ctype, "text/plain") && (strings.Contains(trimmed, "<html") || strings.Contains(trimmed, "<script")) {
		return fiber.NewError(fiber.StatusUnsupportedMediaType, "unsupported file content")
	}
	if strings.HasPrefix(ctype, "text/") && strings.HasSuffix(strings.ToLower(fileName), ".mp4") {
		// mp4 must be ISO-BMFF (ftyp), not text.
		return fiber.NewError(fiber.StatusUnsupportedMediaType, "unsupported file content")
	}
	return nil
}

// List serves the per-session file listing. Requires a valid session;
// legacy shared-root listing is removed (was BOLA: any missing ?session=
// exposed the global /data dir).
func List(c *fiber.Ctx) error {
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fileFail(c, fiber.StatusUnauthorized, "login required")
	}
	return serveSessionList(c, root, session)
}

type sessionFileEntry struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	ETag   string `json:"etag,omitempty"`
	S3Key  string `json:"s3_key,omitempty"`
	Cached bool   `json:"cached"`
	// Render marks final exports (render_*.mp4/avi/mp3). They live in S3
	// under "<user>/renders/<name>" but hydrate to the flat volume path, so
	// the client can show them in a dedicated Renders tab instead of mixing
	// them into Video/Audio.
	Render bool `json:"render,omitempty"`
}

func serveSessionList(c *fiber.Ctx, root, session string) error {
	local := collectLocalSessionFiles(root)
	entries, seen := collectRemoteSessionFiles(c, session, local)
	for name, size := range local {
		if seen[name] {
			continue
		}
		entries = append(entries, sessionFileEntry{Name: name, Size: size, Cached: true, Render: sessions.IsRenderOutput(name)})
	}
	return c.JSON(entries)
}

func collectLocalSessionFiles(root string) map[string]int64 {
	local := map[string]int64{}
	dir, err := os.ReadDir(root)
	if err != nil {
		return local
	}
	for _, e := range dir {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		// Never list job manifests or internal tmp files (was disclosure via
		// unauth /list -> /download).
		lower := strings.ToLower(e.Name())
		if strings.HasSuffix(lower, ".json") && !storage.IsSceneSource(e.Name()) || strings.HasPrefix(lower, "composition_job_") || strings.HasPrefix(lower, "manifest_") {
			continue
		}
		info, err := e.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		local[e.Name()] = info.Size()
	}
	return local
}

func collectRemoteSessionFiles(c *fiber.Ctx, session string, local map[string]int64) ([]sessionFileEntry, map[string]bool) {
	entries := make([]sessionFileEntry, 0, len(local))
	seen := map[string]bool{}
	if !objectstore.Enabled() {
		return entries, seen
	}
	// List owner prefix first (stable per-user data), then raw session prefix
	// when different (stragglers uploaded under a fresh UUID).
	var objects []objectstore.Object
	for _, prefix := range sessions.S3Prefixes(session) {
		page, err := objectstore.Shared().List(c.UserContext(), prefix+"/")
		if err != nil {
			log.Printf("media list: s3 unavailable, serving local cache: %v", err)
			return entries, seen
		}
		objects = append(objects, page...)
	}
	return remoteSessionEntries(objects, local)
}

func remoteSessionEntries(objects []objectstore.Object, local map[string]int64) ([]sessionFileEntry, map[string]bool) {
	entries := make([]sessionFileEntry, 0, len(objects))
	seen := map[string]bool{}
	// Index by name so a final export (renders/<name>) wins over a
	// same-named top-level object; both hydrate to the same flat volume path.
	byName := map[string]sessionFileEntry{}
	order := []string{}
	for _, object := range objects {
		name := ""
		isRender := false
		if idx := strings.Index(object.Key, "/renders/"); idx >= 0 {
			name = object.Key[idx+len("/renders/"):]
			isRender = true
		} else if idx := strings.Index(object.Key, "/scenes/"); idx >= 0 {
			name = object.Key[idx+len("/scenes/"):]
			if !storage.IsSceneSource(name) {
				continue
			}
		} else if idx := strings.Index(object.Key, "/"); idx >= 0 {
			name = object.Key[idx+1:]
			// Legacy/top-level render_*.mp4 objects (or local-only renders
			// not yet uploaded) still count as renders so the Video tab
			// stays clean.
			isRender = sessions.IsRenderOutput(name)
		} else {
			continue
		}
		if name == "" || strings.Contains(name, "/") || strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".json") && !storage.IsSceneSource(name) {
			continue
		}
		_, cached := local[name]
		entry := sessionFileEntry{
			Name: name, Size: object.Size, ETag: object.ETag,
			S3Key: object.Key, Cached: cached, Render: isRender,
		}
		// Renders overwrite sources with the same name; sources never
		// overwrite an already-seen render.
		if prev, ok := byName[name]; ok && prev.Render && !isRender {
			continue
		}
		if prev, ok := byName[name]; ok && storage.IsSceneSource(name) && strings.Contains(prev.S3Key, "/scenes/") {
			continue
		}
		if _, ok := byName[name]; !ok {
			order = append(order, name)
		}
		byName[name] = entry
	}
	for _, name := range order {
		entries = append(entries, byName[name])
		seen[name] = true
	}
	return entries, seen
}

func serveList(c *fiber.Ctx, root string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return fileFail(c, fiber.StatusInternalServerError, "cannot read media library")
	}

	var result strings.Builder
	for _, e := range entries {
		if e.Name() == mediacache.Directory {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}

		// Infallible: writing to a strings.Builder never fails.
		_, _ = fmt.Fprintf(&result, "%s\t%d bytes\n", e.Name(), info.Size())
	}

	return c.SendString(result.String())
}

// Download streams the requested file as an attachment.
func Download(c *fiber.Ctx) error {
	name := c.Query("file")
	if name == "" {
		return fileFail(c, fiber.StatusBadRequest, "parameter 'file' cannot be found")
	}
	// Job manifests and internal files must never download directly (was
	// exfiltration via /list + /download without auth).
	lowerName := strings.ToLower(name)
	if strings.HasSuffix(lowerName, ".json") && !storage.IsSceneSource(name) || strings.HasPrefix(lowerName, "composition_job_") || strings.HasPrefix(lowerName, "manifest_") || strings.HasPrefix(lowerName, ".") {
		return fileFail(c, fiber.StatusNotFound, "file doesn't exist")
	}

	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fileFail(c, fiber.StatusUnauthorized, "login required")
	}
	source, err := resolvePreviewSource(c.UserContext(), root, name, sessions.S3Prefixes(session), objectstore.Shared())
	if err != nil {
		return AssetError(c, err)
	}

	// Same CORP rationale as SendAsset: /download bytes back the preview <video>
	// and timeline streaming, which are cross-origin subresources.
	c.Set("Cross-Origin-Resource-Policy", "cross-origin")
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	if source.Remote != nil {
		return streamRemoteDownload(c, source, objectstore.Shared())
	}
	if AssetNotModified(c, source, "download-v1") {
		return c.Send(nil)
	}
	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return SendAsset(c, source.Path, contentType)
}

func Delete(c *fiber.Ctx) error {
	root, _ := sessions.ResolveRoot(c)
	if names, ok := parseBulkDeleteNames(c); ok {
		return serveBulkDelete(c, root, names)
	}
	return serveDelete(c, root)
}

func serveDelete(c *fiber.Ctx, root string) error {
	name, err := parseDeleteName(c, root)
	if err != nil {
		return sendFileError(c, err)
	}
	if err := removeSessionDeleteTarget(c.UserContext(), root, name, sessions.S3Prefixes(sessions.FromRequest(c)), objectstore.Shared()); err != nil {
		return sendFileError(c, err)
	}

	scrubDeleted := removeScrubDerivatives(root, name)
	return c.JSON(fiber.Map{
		"deleted":      name,
		"scrubDeleted": scrubDeleted,
	})
}

func parseDeleteName(c *fiber.Ctx, root string) (string, error) {
	name := c.Query("file")
	if name == "" {
		return "", fiber.NewError(fiber.StatusBadRequest, "parameter 'file' cannot be found")
	}
	return validateDeleteName(root, name)
}

const (
	maxBulkDelete      = 100
	maxBulkDeleteBytes = 64 << 10
)

func parseBulkDeleteNames(c *fiber.Ctx) (names []string, ok bool) {
	if len(c.Body()) == 0 {
		return nil, false
	}
	if len(c.Body()) > maxBulkDeleteBytes {
		return nil, true
	}
	var body struct {
		Files []string `json:"files"`
	}
	if err := c.BodyParser(&body); err != nil || body.Files == nil {
		return nil, true
	}
	if len(body.Files) == 0 || len(body.Files) > maxBulkDelete {
		return nil, true
	}
	return body.Files, true
}

func serveBulkDelete(c *fiber.Ctx, root string, names []string) error {
	if len(names) == 0 || len(names) > maxBulkDelete {
		return sendFileError(c, fiber.NewError(fiber.StatusBadRequest, "parameter 'files' must contain 1-100 names"))
	}
	session := sessions.FromRequest(c)
	deleted := []string{}
	scrubDeleted := []string{}
	failed := []fiber.Map{}
	for _, name := range names {
		if _, err := validateDeleteName(root, name); err != nil {
			failed = append(failed, fiber.Map{"file": name, "error": deleteErrorMessage(err)})
			continue
		}
		if err := removeSessionDeleteTarget(c.UserContext(), root, name, sessions.S3Prefixes(session), objectstore.Shared()); err != nil {
			failed = append(failed, fiber.Map{"file": name, "error": deleteErrorMessage(err)})
			continue
		}
		scrubs := removeScrubDerivatives(root, name)
		deleted = append(deleted, name)
		scrubDeleted = append(scrubDeleted, scrubs...)
	}
	return c.JSON(fiber.Map{
		"deleted":      deleted,
		"scrubDeleted": scrubDeleted,
		"failed":       failed,
	})
}

func deleteErrorMessage(err error) string {
	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) {
		return fiberErr.Message
	}
	return "cannot delete file"
}

func validateDeleteName(root, name string) (string, error) {
	if _, err := storage.SafeJoinIn(root, name); err != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	extension := strings.ToLower(filepath.Ext(name))
	if !storage.IsSceneSource(name) && (extension == "" || !allowedMediaExtensions[strings.TrimPrefix(extension, ".")]) {
		return "", fiber.NewError(fiber.StatusUnsupportedMediaType, "unsupported file type")
	}
	return name, nil
}

type deleteStore interface {
	previewStore
	Delete(context.Context, string) error
}

func removeSessionDeleteTarget(ctx context.Context, root, name string, prefixes []string, store deleteStore) error {
	source, err := resolvePreviewSource(ctx, root, name, prefixes, store)
	if errors.Is(err, os.ErrNotExist) {
		return fiber.NewError(fiber.StatusNotFound, "file doesn't exist")
	}
	if err != nil {
		return err
	}
	if store.Enabled() {
		for _, prefix := range prefixes {
			if prefix == "" {
				continue
			}
			keys := objectstore.SessionKeys(prefix, name)
			if storage.IsSceneSource(name) {
				keys = append([]string{objectstore.SceneKey(prefix, name+".meta.json"), objectstore.Key(prefix, name+".meta.json")}, keys...)
			}
			for _, key := range keys {
				if err := store.Delete(ctx, key); err != nil {
					return fmt.Errorf("delete stored media: %w", err)
				}
			}
		}
	}
	if storage.IsSceneSource(name) {
		if err := os.Remove(filepath.Join(root, name+".meta.json")); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("delete scene metadata: %w", err)
		}
	}
	if source.Remote != nil {
		return nil
	}
	return removeDeleteTarget(root, name)
}

func removeDeleteTarget(root, name string) error {
	// SafeJoinIn above already confined name to root, so Join here cannot
	// escape: this layer only enforces regular-file semantics.
	path := filepath.Join(root, name)
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return fiber.NewError(fiber.StatusNotFound, "file doesn't exist")
	}
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return fiber.NewError(fiber.StatusNotFound, "file doesn't exist")
		}
		return fiber.NewError(fiber.StatusInternalServerError, "cannot delete file")
	}
	return nil
}

func removeScrubDerivatives(root, name string) []string {
	entries, err := os.ReadDir(root)
	if err != nil {
		return []string{}
	}
	deleted := []string{}
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == name {
			continue
		}
		if !isScrubOf(entry.Name(), name) {
			continue
		}
		if err := os.Remove(filepath.Join(root, entry.Name())); err == nil {
			deleted = append(deleted, entry.Name())
		}
	}
	return deleted
}

// isScrubOf reports whether candidate is a "<stem>_scrub[_<aspect>][_<edge>]<ext>"
// derivative of original, covering both the current "_scrub_<aspect>_<edge>"
// names and older "_scrub[_<edge>]" variants.
func isScrubOf(candidate, original string) bool {
	originalExt := filepath.Ext(original)
	candidateExt := filepath.Ext(candidate)
	if originalExt == "" || !strings.EqualFold(candidateExt, originalExt) {
		return false
	}
	originalStem := strings.TrimSuffix(original, originalExt)
	candidateStem := strings.TrimSuffix(candidate, candidateExt)
	rest, found := strings.CutPrefix(candidateStem, originalStem+"_scrub")
	if !found {
		return false
	}
	if rest == "" {
		return true
	}
	if !strings.HasPrefix(rest, "_") {
		return false
	}
	rest = strings.TrimPrefix(rest, "_")
	for _, aspect := range []scrubAspect{scrubLandscape, scrubPortrait, scrubClassic} {
		if rest == string(aspect) {
			return true
		}
		if after, found := strings.CutPrefix(rest, string(aspect)+"_"); found {
			return isAllDigits(after)
		}
	}
	return isAllDigits(rest)
}

func isAllDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}
