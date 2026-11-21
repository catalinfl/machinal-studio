package media

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strconv"

	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const (
	defaultCatalogLimit = 25
	maxCatalogLimit     = 100
	maxCatalogOffset    = 10000
)

type catalogStore interface {
	Enabled() bool
	List(context.Context, string) ([]objectstore.Object, error)
}

type catalogFile struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Storage string `json:"storage"`
	Cached  bool   `json:"cached"`
	Render  bool   `json:"render"`
}

type catalogQuery struct {
	storage string
	limit   int
	offset  int
}

func Catalog(c *fiber.Ctx) error {
	return serveCatalog(c, objectstore.Shared())
}

func serveCatalog(c *fiber.Ctx, store catalogStore) error {
	query, err := parseCatalogQuery(c)
	if err != nil {
		return err
	}
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	files, err := catalogFiles(c.UserContext(), root, session, query.storage, store)
	if err != nil {
		log.Printf("media catalog: %v", err)
		return fiber.NewError(fiber.StatusServiceUnavailable, "Cloud media listing is unavailable. No cloud files were downloaded.")
	}
	start := min(query.offset, len(files))
	end := min(start+query.limit, len(files))
	response := fiber.Map{"files": files[start:end], "total": len(files), "storage": query.storage}
	if end < len(files) {
		response["nextOffset"] = end
	}
	return c.JSON(response)
}

func parseCatalogQuery(c *fiber.Ctx) (catalogQuery, error) {
	query := catalogQuery{storage: c.Query("storage", "all")}
	if query.storage != "all" && query.storage != "s3" && query.storage != "volume" {
		return query, fiber.NewError(fiber.StatusBadRequest, "storage must be volume, s3 or all")
	}
	var err error
	query.limit, err = strconv.Atoi(c.Query("limit", strconv.Itoa(defaultCatalogLimit)))
	if err != nil || query.limit < 1 || query.limit > maxCatalogLimit {
		return query, fiber.NewError(fiber.StatusBadRequest, "limit must be between 1 and 100")
	}
	query.offset, err = strconv.Atoi(c.Query("offset", "0"))
	if err != nil || query.offset < 0 || query.offset > maxCatalogOffset {
		return query, fiber.NewError(fiber.StatusBadRequest, "offset must be between 0 and 10000")
	}
	return query, nil
}

func catalogFiles(ctx context.Context, root, session, source string, store catalogStore) ([]catalogFile, error) {
	local := collectLocalSessionFiles(root)
	files := make([]catalogFile, 0, len(local))
	seen := map[string]bool{}
	if source != "volume" {
		remote, err := catalogRemoteFiles(ctx, session, local, store, source == "s3")
		if err != nil {
			return nil, err
		}
		for _, file := range remote {
			files = append(files, catalogFile{file.Name, file.Size, "s3", file.Cached, file.Render})
			seen[file.Name] = true
		}
	}
	if source != "s3" {
		for name, size := range local {
			if !seen[name] {
				files = append(files, catalogFile{name, size, "volume", true, sessions.IsRenderOutput(name)})
			}
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return files, nil
}

func catalogRemoteFiles(ctx context.Context, session string, local map[string]int64, store catalogStore, required bool) ([]sessionFileEntry, error) {
	if !store.Enabled() {
		if required {
			return nil, fmt.Errorf("cloud storage is not configured")
		}
		return nil, nil
	}
	var objects []objectstore.Object
	for _, prefix := range sessions.S3Prefixes(session) {
		page, err := store.List(ctx, prefix+"/")
		if err != nil {
			return nil, fmt.Errorf("list project cloud files: %w", err)
		}
		// Do not trust a provider response to widen the project prefix.
		for _, object := range page {
			if len(object.Key) > len(prefix)+1 && object.Key[:len(prefix)+1] == prefix+"/" {
				objects = append(objects, object)
			}
		}
	}
	entries, _ := remoteSessionEntries(objects, local)
	return entries, nil
}

func DescribeFile(c *fiber.Ctx) error {
	name := c.Query("file")
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	if _, err := validateDeleteName(root, name); err != nil {
		return sendFileError(c, err)
	}
	source, err := ResolveSessionSource(c, root, session, name)
	if err != nil {
		return AssetError(c, err)
	}
	location := "volume"
	if source.Remote != nil {
		location = "s3"
	}
	return c.JSON(catalogFile{Name: name, Size: source.Size, Storage: location, Cached: source.Remote == nil, Render: sessions.IsRenderOutput(name)})
}
