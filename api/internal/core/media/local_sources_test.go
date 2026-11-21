package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func localPNG(t *testing.T) []byte {
	t.Helper()
	image := image.NewNRGBA(image.Rect(0, 0, 960, 640))
	image.SetNRGBA(200, 200, color.NRGBA{R: 255, A: 128})
	var data bytes.Buffer
	if err := png.Encode(&data, image); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestLocalPathsAreConfinedAndRequireExactRegularFiles(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "photo.png"), localPNG(t), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, name := range []string{"", "../photo.png", "/photo.png", `C:\photo.png`, `..\photo.png`, "file:///photo.png", "photo.png:stream", ".secret.png", "sub/../photo.png", "-photo.png", "photo\x00.png"} {
		if _, _, err := openLocalPath(root, name, false); err == nil {
			t.Errorf("accepted unsafe path %q", name)
		}
	}
	file, _, err := openLocalPath(root, "photo.png", false)
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
	if _, _, err := openLocalPath(root, ".", false); err == nil {
		t.Fatal("directory accepted as a file")
	}
}

func TestLocalSourcesFailClosedAndHideOtherOwners(t *testing.T) {
	config, err := json.Marshal([]localRoot{{ID: "fans", Owner: "alice", Path: t.TempDir()}})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		config, owner, query string
		status               int
	}{
		{"", "alice", "", 503},
		{"[{", "alice", "", 503},
		{`[{"id":"fans","owner":"alice","path":"."}]`, "alice", "", 503},
		{`[{"id":"fans","path":"/local-media"}]`, "alice", "", 503},
		{string(config), "", "", 401},
		{string(config), "bob", "?rootId=fans", 404},
		{string(config), "bob", "", 200},
		{string(config), "alice", "?rootId=fans&offset=-1", 400},
		{string(config), "alice", "?rootId=fans&limit=101", 400},
	} {
		app := fiber.New()
		sources := NewLocalSources(item.config)
		app.Get("/local", func(c *fiber.Ctx) error { c.Locals("pbUserId", item.owner); return sources.List(c) })
		response, err := app.Test(httptest.NewRequest("GET", "/local"+item.query, nil))
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != item.status {
			t.Fatalf("config=%s owner=%s: %d %s", item.config, item.owner, response.StatusCode, body)
		}
		if item.owner == "bob" && strings.Contains(string(body), "fans") {
			t.Fatal("foreign root ID leaked", string(body))
		}
	}
}

func TestLocalInspectionAndImportPreserveSourcesAndReuseWorkingCopies(t *testing.T) {
	directory, destination := t.TempDir(), t.TempDir()
	payload := localPNG(t)
	sourcePath := filepath.Join(directory, "photo.png")
	if err := os.WriteFile(sourcePath, payload, 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	evidence, err := inspectLocalImage(context.Background(), root, LocalSelection{File: "photo.png"})
	if err != nil || evidence.SourceVersion != fmt.Sprintf("sha256:%x", sha256.Sum256(payload)) || evidence.Width != 960 || evidence.Height != 640 {
		t.Fatal("inspection not pinned to actual source bytes", evidence, err)
	}
	thumbnail, err := jpeg.DecodeConfig(bytes.NewReader(evidence.Data))
	if err != nil || thumbnail.Width != 480 || thumbnail.Height != 320 {
		t.Fatal("thumbnail bounds", thumbnail, err)
	}
	selected := LocalSelection{File: "photo.png", SourceVersion: evidence.SourceVersion}
	first, err := importLocalFile(context.Background(), root, destination, "", selected, maxUploadBytes)
	if err != nil || first.Reused {
		t.Fatal(first, err)
	}
	second, err := importLocalFile(context.Background(), root, destination, "", selected, maxUploadBytes)
	if err != nil || !second.Reused || first.File != second.File {
		t.Fatal("retry did not reuse original import", first, second, err)
	}
	copyPath := filepath.Join(destination, first.File)
	copy, err := os.ReadFile(copyPath)
	if err != nil || !bytes.Equal(copy, payload) {
		t.Fatal("PNG alpha/source bytes not preserved", err)
	}
	if err := os.WriteFile(copyPath, []byte("independent edit"), 0600); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(sourcePath)
	if err != nil || !bytes.Equal(original, payload) {
		t.Fatal("working copy modified original", err)
	}
	if _, err := importLocalFile(context.Background(), root, destination, "", selected, maxUploadBytes); err == nil {
		t.Fatal("different existing bytes overwritten")
	}
	selected.SourceVersion = "sha256:" + strings.Repeat("0", 64)
	if _, err := importLocalFile(context.Background(), root, destination, "", selected, maxUploadBytes); err == nil {
		t.Fatal("stale source version accepted")
	}
	entries, err := os.ReadDir(destination)
	if err != nil || len(entries) != 1 {
		t.Fatal("temporary/partial imports leaked", entries, err)
	}
}

func TestLocalImportsRejectSymlinksQuotasPlaylistsAndCancellation(t *testing.T) {
	directory, destination := t.TempDir(), t.TempDir()
	payload := localPNG(t)
	for name, data := range map[string][]byte{"photo.png": payload, "playlist.mp4": []byte("#EXTM3U\nhttps://example.com/private")} {
		if err := os.WriteFile(filepath.Join(directory, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, item := range []struct {
		file      string
		remaining int64
	}{
		{"playlist.mp4", maxUploadBytes},
		{"photo.png", 1},
	} {
		if _, err := importLocalFile(context.Background(), root, destination, "", LocalSelection{File: item.file}, item.remaining); err == nil {
			t.Fatal("unsupported content or quota accepted", item)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := importLocalFile(ctx, root, destination, "", LocalSelection{File: "photo.png"}, maxUploadBytes); err == nil {
		t.Fatal("cancelled import succeeded")
	}
	if err := os.Symlink(filepath.Join(directory, "photo.png"), filepath.Join(directory, "link.png")); err == nil {
		if _, _, err := openLocalPath(root, "link.png", false); err == nil {
			t.Fatal("symbolic link accepted")
		}
	} else {
		t.Log("symlink creation unavailable on this filesystem:", err)
	}
	entries, err := os.ReadDir(destination)
	if err != nil || len(entries) != 0 {
		t.Fatal("failed import published bytes", entries, err)
	}
}

func TestLocalDirectoryListingIsSortedBoundedAndSkipsInternalFiles(t *testing.T) {
	directory := t.TempDir()
	for _, name := range []string{"z.png", "a.png", ".secret.png", "config.json", "file.png:stream"} {
		if strings.Contains(name, ":") {
			continue
		}
		if err := os.WriteFile(filepath.Join(directory, name), []byte("not inspected"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(directory, "sub"), 0700); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	files, err := listLocalDirectory(root, ".")
	if err != nil || len(files) != 3 || files[0].File != "a.png" || files[1].File != "sub" || !files[1].Directory || files[2].File != "z.png" {
		t.Fatal(files, err)
	}
}

func TestLocalInspectionRejectsPixelBombsAndInvalidSelections(t *testing.T) {
	payload := localPNG(t)
	binary.BigEndian.PutUint32(payload[16:20], maxLocalImagePixels+1)
	binary.BigEndian.PutUint32(payload[20:24], 1)
	binary.BigEndian.PutUint32(payload[29:33], crc32.ChecksumIEEE(payload[12:29]))
	if _, _, _, err := localThumbnail(payload); err == nil {
		t.Fatal("oversized decoded image accepted")
	}
	if _, _, _, err := localThumbnail([]byte("not an image")); err == nil {
		t.Fatal("invalid image accepted")
	}
	for _, files := range [][]LocalSelection{
		nil,
		{{File: "../photo.png"}},
		{{File: "photo.png"}, {File: "photo.png"}},
		{{File: "photo.png", SourceVersion: "sha256:invalid"}},
	} {
		if err := validateLocalSelections(files, MaxLocalInspectionFiles); err == nil {
			t.Fatal("invalid selection accepted", files)
		}
	}
}
