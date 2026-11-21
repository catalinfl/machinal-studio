package media

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/objectstore"

	"github.com/gofiber/fiber/v2"
)

func deleteApp(t *testing.T, files ...string) (*fiber.App, string) {
	t.Helper()
	root := t.TempDir()
	for _, name := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte("media"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	app := fiber.New()
	app.Delete("/media", func(c *fiber.Ctx) error {
		if names, ok := parseBulkDeleteNames(c); ok {
			return serveBulkDelete(c, root, names)
		}
		return serveDelete(c, root)
	})
	return app, root
}

func deleteRequest(t *testing.T, app *fiber.App, name string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(http.MethodDelete, "/media?file="+url.QueryEscape(name), nil)
	response, err := app.Test(request, 5000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func TestDeleteRemovesOriginalAndScrubDerivatives(t *testing.T) {
	app, root := deleteApp(t,
		"clip.mp4",
		"clip_scrub_landscape_480.mp4",
		"clip_scrub_480.mp4",
		"clip_scrub.mp4",
		"other.mp4",
	)
	response := deleteRequest(t, app, "clip.mp4")
	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	var result struct {
		Deleted      string   `json:"deleted"`
		ScrubDeleted []string `json:"scrubDeleted"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Deleted != "clip.mp4" || len(result.ScrubDeleted) != 3 {
		t.Fatalf("result = %+v, want clip.mp4 with 3 scrubs", result)
	}
	for _, name := range []string{"clip.mp4", "clip_scrub_landscape_480.mp4", "clip_scrub_480.mp4", "clip_scrub.mp4"} {
		if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
			t.Fatalf("%s was not removed", name)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "other.mp4")); err != nil {
		t.Fatalf("unrelated file removed: %v", err)
	}
}

func TestDeleteRejectsInvalidNames(t *testing.T) {
	app, _ := deleteApp(t, "clip.mp4")
	for _, test := range []struct {
		name   string
		status int
	}{
		{name: "", status: 400},
		{name: "../clip.mp4", status: 400},
		{name: ".hidden.mp4", status: 400},
		{name: "clip.txt", status: 415},
		{name: "missing.mp4", status: 404},
	} {
		response := deleteRequest(t, app, test.name)
		if response.StatusCode != test.status {
			t.Fatalf("file %q: status = %d, want %d", test.name, response.StatusCode, test.status)
		}
	}
}

func TestBulkDeleteRemovesMultipleFiles(t *testing.T) {
	app, root := deleteApp(t, "a.mp4", "b.mp4", "c.mp4")
	body, _ := json.Marshal(map[string][]string{"files": {"a.mp4", "b.mp4"}})
	request := httptest.NewRequest(http.MethodDelete, "/media", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request, 5000)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	var result struct {
		Deleted []string            `json:"deleted"`
		Failed  []map[string]string `json:"failed"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if len(result.Deleted) != 2 || len(result.Failed) != 0 {
		t.Fatalf("result = %+v, want 2 deleted, 0 failed", result)
	}
	for _, name := range []string{"a.mp4", "b.mp4"} {
		if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
			t.Fatalf("%s was not removed", name)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "c.mp4")); err != nil {
		t.Fatalf("unrelated file removed: %v", err)
	}
}

func TestBulkDeleteReportsPartialFailures(t *testing.T) {
	app, _ := deleteApp(t, "a.mp4")
	body, _ := json.Marshal(map[string][]string{"files": {"a.mp4", "missing.mp4", "../evil.mp4"}})
	request := httptest.NewRequest(http.MethodDelete, "/media", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request, 5000)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	var result struct {
		Deleted []string `json:"deleted"`
		Failed  []struct {
			File string `json:"file"`
		} `json:"failed"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if len(result.Deleted) != 1 || result.Deleted[0] != "a.mp4" {
		t.Fatalf("deleted = %+v, want [a.mp4]", result.Deleted)
	}
	if len(result.Failed) != 2 {
		t.Fatalf("failed = %+v, want 2 entries", result.Failed)
	}
}

func TestBulkDeleteRejectsEmptyOrOversized(t *testing.T) {
	app, _ := deleteApp(t, "a.mp4")
	for _, files := range []map[string][]string{{"files": {}}, {"files": make([]string, maxBulkDelete+1)}} {
		body, _ := json.Marshal(files)
		request := httptest.NewRequest(http.MethodDelete, "/media", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response, err := app.Test(request, 5000)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 400 {
			t.Fatalf("files=%d: status = %d, want 400", len(files["files"]), response.StatusCode)
		}
	}
}

func TestMalformedBulkDeleteNeverFallsBackToQueryDeletion(t *testing.T) {
	app, root := deleteApp(t, "keep.mp4")
	for _, body := range []string{`{`, `{}`, `{"files":null}`, `{"files":"keep.mp4"}`, strings.Repeat(" ", maxBulkDeleteBytes+1)} {
		request := httptest.NewRequest(http.MethodDelete, "/media?file=keep.mp4", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest {
			t.Errorf("invalid bulk deletion returned %d", response.StatusCode)
		}
		if _, err := os.Stat(filepath.Join(root, "keep.mp4")); err != nil {
			t.Fatal("invalid bulk body deleted the query-selected file", err)
		}
	}
}

func TestSceneLibraryListsSourcesWithoutInternalMetadata(t *testing.T) {
	name := "ai_scene_" + strings.Repeat("a", 32) + "_01.scene.json"
	_, root := deleteApp(t, name, name+".meta.json", "scene_job_123.json", "composition_job_123.json")
	local := collectLocalSessionFiles(root)
	if len(local) != 1 || local[name] == 0 {
		t.Fatalf("local scene inventory: %+v", local)
	}
	objects := []objectstore.Object{
		{Key: objectstore.Key("user", name), Size: 5},
		{Key: objectstore.SceneKey("user", name), Size: 10},
		{Key: objectstore.SceneKey("user", name+".meta.json"), Size: 15},
		{Key: objectstore.Key("user", "scene_job_123.json"), Size: 20},
	}
	entries, _ := remoteSessionEntries(objects, local)
	if len(entries) != 1 || entries[0].S3Key != objectstore.SceneKey("user", name) || !entries[0].Cached || entries[0].Render {
		t.Fatalf("stored scene inventory: %+v", entries)
	}
}

func TestDeleteSceneRemovesSourceAndMetadata(t *testing.T) {
	name := "ai_scene_" + strings.Repeat("a", 32) + "_01.scene.json"
	app, root := deleteApp(t, name, name+".meta.json", "other.mp4")
	response := deleteRequest(t, app, name)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("scene deletion status: %d", response.StatusCode)
	}
	for _, file := range []string{name, name + ".meta.json"} {
		if _, err := os.Stat(filepath.Join(root, file)); !os.IsNotExist(err) {
			t.Fatalf("scene file remains: %s", file)
		}
	}
}

func TestDeleteStoredSceneSweepsOwnerAndLegacyCopies(t *testing.T) {
	name := "ai_scene_" + strings.Repeat("a", 32) + "_01.scene.json"
	deleted := map[string]bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, "/bucket/")
		if r.Method == http.MethodDelete {
			deleted[key] = true
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodHead && key == objectstore.SceneKey("owner", name) {
			w.Header().Set("ETag", `"scene-version"`)
			w.Header().Set("Content-Length", "10")
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	store := objectstore.New(objectstore.Config{Endpoint: server.URL, Region: "auto", Bucket: "bucket", AccessKey: "key", SecretKey: "secret"})
	if err := removeSessionDeleteTarget(context.Background(), t.TempDir(), name, []string{"owner", "legacy"}, store); err != nil {
		t.Fatal(err)
	}
	for _, prefix := range []string{"owner", "legacy"} {
		for _, file := range []string{name, name + ".meta.json"} {
			if !deleted[objectstore.SceneKey(prefix, file)] || !deleted[objectstore.Key(prefix, file)] {
				t.Fatalf("orphaned scene: %s/%s; deleted=%v", prefix, file, deleted)
			}
		}
	}
}

func TestFailedSceneStorageDeletionPreservesLocalSource(t *testing.T) {
	name := "ai_scene_" + strings.Repeat("a", 32) + "_01.scene.json"
	_, root := deleteApp(t, name, name+".meta.json")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	store := objectstore.New(objectstore.Config{Endpoint: server.URL, Region: "auto", Bucket: "bucket", AccessKey: "key", SecretKey: "secret"})
	if err := removeSessionDeleteTarget(context.Background(), root, name, []string{"owner"}, store); err == nil {
		t.Fatal("storage failure was reported as a successful deletion")
	}
	for _, file := range []string{name, name + ".meta.json"} {
		if _, err := os.Stat(filepath.Join(root, file)); err != nil {
			t.Fatalf("failed deletion removed the retryable local source: %v", err)
		}
	}
}
