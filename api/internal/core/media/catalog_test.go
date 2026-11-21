package media

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

type fakeCatalogStore struct {
	prefixes []string
	objects  []objectstore.Object
	fail     bool
}

func (s *fakeCatalogStore) Enabled() bool { return true }
func (s *fakeCatalogStore) List(_ context.Context, prefix string) ([]objectstore.Object, error) {
	s.prefixes = append(s.prefixes, prefix)
	if s.fail {
		return nil, errors.New("private storage failure")
	}
	return s.objects, nil
}

func TestCatalogSeparatesVolumeAndCloudWithoutDownloading(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "local.png"), []byte("image"), 0600); err != nil {
		t.Fatal(err)
	}
	store := &fakeCatalogStore{objects: []objectstore.Object{{Key: "p_test/cloud.png", Size: 7}, {Key: "p_other/private.png", Size: 10}, {Key: "p_test/.private", Size: 3}}}
	files, err := catalogFiles(context.Background(), root, "p_test", "volume", store)
	if err != nil || len(store.prefixes) != 0 || len(files) != 1 || files[0].Storage != "volume" {
		t.Fatal(files, err)
	}
	files, err = catalogFiles(context.Background(), root, "p_test", "s3", store)
	if err != nil || len(files) != 1 || files[0].Name != "cloud.png" || files[0].Storage != "s3" || files[0].Cached {
		t.Fatal(files, err)
	}
	if len(store.prefixes) != 1 || store.prefixes[0] != "p_test/" {
		t.Fatal(store.prefixes)
	}
	if _, err := os.Stat(filepath.Join(root, "cloud.png")); !os.IsNotExist(err) {
		t.Fatal("listing downloaded cloud bytes")
	}
	store.fail = true
	if _, err := catalogFiles(context.Background(), root, "p_test", "s3", store); err == nil {
		t.Fatal("cloud failure was disguised as an empty library")
	}
}

func TestCatalogPaginationAndValidation(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	store := &fakeCatalogStore{objects: []objectstore.Object{{Key: "p_catalog/c.png"}, {Key: "p_catalog/a.png"}, {Key: "p_catalog/b.png"}}}
	app := fiber.New()
	app.Get("/catalog", func(c *fiber.Ctx) error {
		c.Request().Header.Set("X-Session-Id", "p_catalog")
		return serveCatalog(c, store)
	})
	response, err := app.Test(httptest.NewRequest("GET", "/catalog?storage=s3&limit=1&offset=1", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var page struct {
		Files []catalogFile `json:"files"`
		Next  int           `json:"nextOffset"`
		Total int           `json:"total"`
	}
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || len(page.Files) != 1 || page.Files[0].Name != "b.png" || page.Next != 2 || page.Total != 3 {
		t.Fatal(response.StatusCode, page)
	}
	for _, query := range []string{"storage=other", "limit=101", "offset=-1", "limit=bad"} {
		before := len(store.prefixes)
		r, err := app.Test(httptest.NewRequest("GET", "/catalog?"+query, nil))
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != 400 || len(store.prefixes) != before {
			t.Fatal("invalid pagination reached storage", query)
		}
	}
}

type fakeDownloadStore struct {
	keys   []string
	signed string
}

func (s *fakeDownloadStore) Enabled() bool { return true }
func (s *fakeDownloadStore) Head(_ context.Context, key string) (objectstore.Object, error) {
	s.keys = append(s.keys, key)
	return objectstore.Object{Key: key, Size: 100, ETag: "etag"}, nil
}
func (s *fakeDownloadStore) PresignDownload(key string, ttl time.Duration) (string, error) {
	s.signed = key
	if ttl != downloadURLLifetime {
		return "", errors.New("wrong TTL")
	}
	return "https://public.example/video?X-Amz-Signature=temporary", nil
}

func TestSignedDownloadUsesOwnedPrefixAndNeverProxiesBytes(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	store := &fakeDownloadStore{}
	now := time.Date(2026, 10, 23, 10, 0, 0, 0, time.UTC)
	app := fiber.New()
	app.Get("/signed", func(c *fiber.Ctx) error {
		c.Request().Header.Set("X-Session-Id", "p_signed")
		return signedDownload(c, store, func() time.Time { return now })
	})
	r, err := app.Test(httptest.NewRequest("GET", "/signed?file=render_test.mp4", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(r.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if r.StatusCode != 200 || result["url"] != "https://public.example/video?X-Amz-Signature=temporary" || result["expiresAt"] != "2026-10-23T10:15:00Z" || store.signed != "p_signed/renders/render_test.mp4" {
		t.Fatal(result, store)
	}
	if r.Header.Get("Cache-Control") != "no-store" || strings.Contains(result["authentication"].(string), "Bearer") {
		t.Fatal("unsafe download credentials/cache policy", result)
	}
	before := len(store.keys)
	r, err = app.Test(httptest.NewRequest("GET", "/signed?file=..%2Fprivate.mp4", nil))
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 400 || len(store.keys) != before {
		t.Fatal("unsafe filename reached storage")
	}
}
