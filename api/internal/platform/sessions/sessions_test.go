package sessions

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

func TestNewIDLooksLikeUUID(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 10; i++ {
		id := NewID()
		if !Valid(id) {
			t.Fatalf("NewID() = %q, not a valid session id", id)
		}
		if len(id) != 36 || id[8] != '-' || id[13] != '-' || id[18] != '-' || id[23] != '-' {
			t.Fatalf("NewID() = %q, want uuid shape", id)
		}
		seen[id] = true
	}
	if len(seen) != 10 {
		t.Fatal("NewID() produced duplicates")
	}
}

func TestFromRequestRejectsTraversal(t *testing.T) {
	var got string
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		got = FromRequest(c)
		return c.SendStatus(fiber.StatusNoContent)
	})
	for _, target := range []string{"/?session=..%2Fevil", "/?session=a%2Fb", "/?session=", "/"} {
		got = "unset"
		request := httptest.NewRequest(http.MethodGet, target, nil)
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if got != "" {
			t.Fatalf("FromRequest(%q) = %q, want empty", target, got)
		}
	}
}

func TestFromRequestHeaderAndQuery(t *testing.T) {
	var got string
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		got = FromRequest(c)
		return c.SendStatus(fiber.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodGet, "/?session=user-1", nil)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if got != "user-1" {
		t.Fatalf("query session = %q, want user-1", got)
	}
	got = ""
	request = httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("X-Session-Id", "user-2")
	response, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if got != "user-2" {
		t.Fatalf("header session = %q, want user-2", got)
	}
}

func TestTouchAndRemoveRoundTrip(t *testing.T) {
	id := strings.ReplaceAll(NewID(), "-", "")
	root, err := Touch(id)
	if err != nil {
		t.Fatal(err)
	}
	if want, _ := storage.UserDir(id); root != want {
		t.Fatalf("Touch root = %q, want %q", root, want)
	}
	sentinel := filepath.Join(root, "clip.mp4")
	if err := os.WriteFile(sentinel, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if found := Snapshot(); !containsID(found, id) {
		t.Fatal("Touch did not register the session")
	}
	if err := Remove(id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(sentinel); !os.IsNotExist(err) {
		t.Fatal("Remove did not delete the session volume")
	}
	if found := Snapshot(); containsID(found, id) {
		t.Fatal("Remove did not forget the session")
	}
}

func TestPruneRendersKeepsNewest(t *testing.T) {
	root := t.TempDir()
	for i, name := range []string{"render_a.mp4", "render_b.mp4", "render_c.mp4", "render_d.mp4", "clip.mp4"} {
		path := filepath.Join(root, name)
		if err := os.WriteFile(path, []byte("x"), 0600); err != nil {
			t.Fatal(err)
		}
		past := time.Now().Add(-time.Duration(i) * time.Hour)
		if err := os.Chtimes(path, past, past); err != nil {
			t.Fatal(err)
		}
	}
	PruneRenders(root, 2)
	for _, name := range []string{"render_a.mp4", "render_b.mp4", "clip.mp4"} {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatalf("%s should survive, err=%v", name, err)
		}
	}
	for _, name := range []string{"render_c.mp4", "render_d.mp4"} {
		if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
			t.Fatalf("%s should be pruned", name)
		}
	}
}

func TestIsRenderOutputMatchesExports(t *testing.T) {
	for _, name := range []string{"render_a1b2c3d4e5f6.mp4", "render_abc.avi", "render_xyz.mp3", "render_output.mp4", "RENDER_ABC.MP4"} {
		if !IsRenderOutput(name) {
			t.Fatalf("%q should be a render", name)
		}
	}
	for _, name := range []string{"clip.mp4", "my_render_clip.mp4", "render_notes.txt", "clip_scrub_480.mp4"} {
		if IsRenderOutput(name) {
			t.Fatalf("%q should not be a render", name)
		}
	}
}

func TestMaxSessionBytesFromEnv(t *testing.T) {
	if MaxSessionBytes() != DefaultMaxSessionBytes && os.Getenv("SESSION_MAX_BYTES") == "" {
		t.Fatal("default quota changed without env")
	}
	t.Setenv("SESSION_MAX_BYTES", "1234")
	if MaxSessionBytes() != 1234 {
		t.Fatalf("quota = %d, want 1234", MaxSessionBytes())
	}
	t.Setenv("SESSION_MAX_BYTES", "0")
	if MaxSessionBytes() != 0 {
		t.Fatal("quota 0 should disable the limit")
	}
	t.Setenv("SESSION_MAX_BYTES", "bogus")
	if MaxSessionBytes() != DefaultMaxSessionBytes {
		t.Fatal("bogus quota should fall back to default")
	}
}

func TestDirSizeSumsRegularFiles(t *testing.T) {
	root := t.TempDir()
	if DirSize(root) != 0 {
		t.Fatal("empty dir should size 0")
	}
	if err := os.WriteFile(filepath.Join(root, "a.mp4"), []byte("12345"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sub", "b.mp4"), []byte("1234567"), 0600); err != nil {
		t.Fatal(err)
	}
	if size := DirSize(root); size != 5+7 {
		t.Fatalf("DirSize = %d, want 12", size)
	}
	if size := DirSize(filepath.Join(root, "missing")); size != 0 {
		t.Fatalf("missing dir size = %d, want 0", size)
	}
}

func containsID(infos []Info, id string) bool {

	for _, info := range infos {
		if info.ID == id {
			return true
		}
	}
	return false
}
