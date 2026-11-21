package media

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"unicode"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

const (
	maxLocalRoots   = 16
	maxLocalFiles   = 100
	maxLocalEntries = 10000
	maxLocalPath    = 1024
)

type localRoot struct {
	ID    string `json:"id"`
	Owner string `json:"owner"`
	Path  string `json:"path"`
}

type LocalSources struct {
	roots   []localRoot
	invalid bool
	slots   chan struct{}
}

// Roots are administrator configuration, never caller-supplied absolute paths.
func NewLocalSources(config string) *LocalSources {
	sources := &LocalSources{slots: make(chan struct{}, 2)}
	if strings.TrimSpace(config) == "" {
		return sources
	}
	if document.DecodeJSON([]byte(config), &sources.roots) != nil || len(sources.roots) > maxLocalRoots {
		sources.invalid = true
	}
	seen := map[string]bool{}
	for _, root := range sources.roots {
		key := root.Owner + "/" + root.ID
		if !storage.ValidUserID(root.ID) || !storage.ValidUserID(root.Owner) || !filepath.IsAbs(root.Path) ||
			filepath.Dir(filepath.Clean(root.Path)) == filepath.Clean(root.Path) || seen[key] {
			sources.invalid = true
		}
		seen[key] = true
	}
	return sources
}

func (s *LocalSources) available(c *fiber.Ctx) error {
	if auth.UserID(c) == "" {
		return fiber.ErrUnauthorized
	}
	if s.invalid {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Local media configuration is invalid. No filesystem access was performed.")
	}
	if len(s.roots) == 0 {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Local media is disabled. Configure an owner-scoped LOCAL_MEDIA_ROOTS_JSON and a read-only folder mount; do not upload or change Docker mounts without permission.")
	}
	return nil
}

func (s *LocalSources) open(c *fiber.Ctx, id string) (*os.Root, error) {
	if err := s.available(c); err != nil {
		return nil, err
	}
	for _, source := range s.roots {
		if source.ID == id && source.Owner == auth.UserID(c) {
			root, err := os.OpenRoot(source.Path)
			if err != nil {
				return nil, fiber.NewError(fiber.StatusServiceUnavailable, "The configured local folder is unavailable. Check its read-only mount.")
			}
			return root, nil
		}
	}
	return nil, fiber.NewError(fiber.StatusNotFound, "Local media root not found.")
}

func validLocalPath(name string) bool {
	if name == "" || len(name) > maxLocalPath || !fs.ValidPath(name) || strings.ContainsAny(name, "\\:") || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") || strings.HasPrefix(part, "-") || len(part) > 255 {
			return false
		}
	}
	return true
}

func openLocalPath(root *os.Root, name string, directory bool) (*os.File, os.FileInfo, error) {
	if !(directory && name == ".") && !validLocalPath(name) {
		return nil, nil, fiber.NewError(fiber.StatusBadRequest, "Use a relative path from the approved local listing, not an absolute path, URL or traversal.")
	}
	for prefix := name; prefix != "."; prefix = path.Dir(prefix) {
		info, err := root.Lstat(prefix)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return nil, nil, fiber.NewError(fiber.StatusNotFound, "Local media path not found or is a symbolic link.")
		}
	}
	before, err := root.Lstat(name)
	if err != nil || directory && !before.IsDir() || !directory && !before.Mode().IsRegular() {
		return nil, nil, fiber.NewError(fiber.StatusNotFound, "Local media path is not a supported regular file or directory.")
	}
	file, err := root.OpenFile(name, localReadFlags, 0)
	if err != nil {
		return nil, nil, fiber.NewError(fiber.StatusNotFound, "Local media path could not be opened.")
	}
	info, err := file.Stat()
	if err != nil || !os.SameFile(before, info) || directory && !info.IsDir() || !directory && !info.Mode().IsRegular() {
		file.Close()
		return nil, nil, fiber.NewError(fiber.StatusConflict, "Local media path changed. List the approved folder again.")
	}
	return file, info, nil
}

func supportedLocalFile(name string) bool {
	return validLocalPath(name) && allowedMediaExtensions[strings.TrimPrefix(strings.ToLower(path.Ext(name)), ".")]
}

type localEntry struct {
	File      string `json:"file"`
	Directory bool   `json:"directory"`
	Bytes     int64  `json:"bytes"`
}

func (s *LocalSources) List(c *fiber.Ctx) error {
	if err := s.available(c); err != nil {
		return err
	}
	if c.Query("rootId") == "" {
		roots := []string{}
		for _, root := range s.roots {
			if root.Owner == auth.UserID(c) {
				roots = append(roots, root.ID)
			}
		}
		slices.Sort(roots)
		return c.JSON(fiber.Map{"roots": roots, "uploadsToS3": false, "originalsReadOnly": true})
	}
	query, err := parseCatalogQuery(c)
	if err != nil {
		return err
	}
	root, err := s.open(c, c.Query("rootId"))
	if err != nil {
		return err
	}
	defer root.Close()
	files, err := listLocalDirectory(root, c.Query("directory", "."))
	if err != nil {
		return err
	}
	start := min(query.offset, len(files))
	end := min(start+query.limit, len(files))
	response := fiber.Map{"files": files[start:end], "total": len(files), "rootId": c.Query("rootId"), "originalsReadOnly": true}
	if end < len(files) {
		response["nextOffset"] = end
	}
	return c.JSON(response)
}

func listLocalDirectory(root *os.Root, directory string) ([]localEntry, error) {
	file, _, err := openLocalPath(root, directory, true)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	entries, err := file.ReadDir(maxLocalEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, fiber.NewError(fiber.StatusServiceUnavailable, "Local media listing failed.")
	}
	if len(entries) > maxLocalEntries {
		return nil, fiber.NewError(fiber.StatusRequestEntityTooLarge, fmt.Sprintf("Local directories are limited to %d entries. Select a smaller subfolder.", maxLocalEntries))
	}
	files := []localEntry{}
	for _, entry := range entries {
		name := path.Join(directory, entry.Name())
		if !validLocalPath(name) || entry.Type()&os.ModeSymlink != 0 || !entry.IsDir() && !supportedLocalFile(name) {
			continue
		}
		info, err := root.Lstat(name)
		if err != nil || !info.IsDir() && !info.Mode().IsRegular() {
			continue
		}
		files = append(files, localEntry{File: name, Directory: info.IsDir(), Bytes: info.Size()})
	}
	slices.SortFunc(files, func(a, b localEntry) int { return strings.Compare(a.File, b.File) })
	return files, nil
}
