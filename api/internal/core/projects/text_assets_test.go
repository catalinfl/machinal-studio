package projects

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func textAssetFixture() ([]byte, textAssetReference) {
	data := []byte(`{"key":"render-key","overlays":[{"start":1.1,"duration":1.3,"x":12,"y":1400,"image":"exact-PNG-bytes"}]}`)
	return data, textAssetReference{ID: fmt.Sprintf("%x", sha256.Sum256(data)), Key: "render-key"}
}

func TestProjectTextAssetsAreExactImmutableAndProjectScoped(t *testing.T) {
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	data, reference := textAssetFixture()
	var wait sync.WaitGroup
	for range 8 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if err := store.saveTextAsset("alice", project.ID, reference, data); err != nil {
				t.Error(err)
			}
		}()
	}
	wait.Wait()
	path, err := store.textAssetPath("alice", project.ID, reference)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatal("cache changed the prepared raster payload", err)
	}
	if err := store.saveTextAsset("alice", project.ID, reference, append(append([]byte{}, data...), ' ')); !errors.Is(err, ErrInvalid) {
		t.Fatal("incorrect content digest accepted", err)
	}
	refJSON, err := json.Marshal(reference)
	if err != nil {
		t.Fatal(err)
	}
	state := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"timeline":{"textItems":[{"text":"  Știință\nși țară! ","words":[{"text":" Știință","start":0,"end":0.5}]}],"documentSession":{"preparedTextRef":%s,"composition":{"preparedTextRef":%s}}},"media":[]}`, refJSON, refJSON))
	saved, err := store.Update("alice", project.ID, project.Name, project.Version, state)
	if err != nil || !bytes.Equal(saved.State, state) {
		t.Fatal("compact state or captions changed", err)
	}
	other, err := store.Create("alice", "Other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update("alice", other.ID, other.Name, other.Version, state); !errors.Is(err, ErrInvalid) {
		t.Fatal("another project's cache reference accepted", err)
	}
	wrongKey := reference
	wrongKey.Key = "another-key"
	if store.validateTextReferences("alice", project.ID, bytes.ReplaceAll(state, []byte(reference.Key), []byte(wrongKey.Key))) == nil {
		t.Fatal("wrong source key accepted")
	}
}

func TestProjectTextAssetHTTPRequiresOwnershipAndStreamsExactBytes(t *testing.T) {
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	data, reference := textAssetFixture()
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("pbUserId", c.Get("X-Test-Owner")); return c.Next() })
	app.Post("/projects/:projectID/text-assets/:assetID", store.SaveTextAssetHandler)
	app.Get("/projects/:projectID/text-assets/:assetID", store.GetTextAssetHandler)
	url := "/projects/" + project.ID + "/text-assets/" + reference.ID + "?key=" + reference.Key
	for _, item := range []struct {
		owner, method string
		status        int
	}{{"bob", "POST", 404}, {"alice", "POST", 204}, {"bob", "GET", 404}, {"alice", "GET", 200}} {
		request := httptest.NewRequest(item.method, url, bytes.NewReader(data))
		request.Header.Set("X-Test-Owner", item.owner)
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != item.status {
			t.Fatalf("%s %s: status %d, error %v", item.owner, item.method, response.StatusCode, err)
		}
		if item.status == 200 && !bytes.Equal(body, data) {
			t.Fatal("HTTP stream changed cached raster bytes")
		}
	}
	for _, id := range []string{"../escape", strings.Repeat("a", 63), strings.Repeat("A", 64)} {
		if _, err := store.textAssetPath("alice", project.ID, textAssetReference{ID: id, Key: "key"}); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid cache identifier accepted", id)
		}
	}
}

func TestMissingOrCorruptTextAssetDoesNotReplaceSavedState(t *testing.T) {
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	data, reference := textAssetFixture()
	state := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"timeline":{"documentSession":{"preparedTextRef":{"id":%q,"key":%q}}},"media":[]}`, reference.ID, reference.Key))
	if _, err := store.Update("alice", project.ID, project.Name, project.Version, state); !errors.Is(err, ErrInvalid) {
		t.Fatal("a missing cache reference replaced the project", err)
	}
	unchanged, err := store.Get("alice", project.ID)
	if err != nil || unchanged.Version != project.Version || !bytes.Equal(unchanged.State, project.State) {
		t.Fatal("failed save changed the previous state", err)
	}
	if err := store.saveTextAsset("alice", project.ID, reference, data); err != nil {
		t.Fatal(err)
	}
	path, err := store.textAssetPath("alice", project.ID, reference)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := bytes.Replace(data, []byte("exact"), []byte("wrong"), 1)
	if err := os.WriteFile(path, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if err := store.saveTextAsset("alice", project.ID, reference, data); !errors.Is(err, ErrInvalid) {
		t.Fatal("same-size corruption was treated as a complete cache asset", err)
	}
}
