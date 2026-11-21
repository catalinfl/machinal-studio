package routes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

func privateMediaApp(t *testing.T) (*fiber.App, string) {
	t.Helper()
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	cloud := objectstore.Shared()
	previousConfig := cloud.Config
	cloud.Config = objectstore.Config{}
	t.Cleanup(func() {
		sessions.Evict("u_alice")
		sessions.Evict("u_bob")
		storage.DataDir = previous
		cloud.Config = previousConfig
	})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer alice-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		io.WriteString(w, `{"record":{"id":"alice"}}`)
	}))
	t.Cleanup(server.Close)
	t.Setenv("POCKETBASE_URL", server.URL)
	root, err := sessions.TouchOwned("u_alice", "alice")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), []byte("private-media"), 0600); err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	registerMediaRoutes(app)
	registerEditorRoutes(app)
	registerSessionRoutes(app)
	return app, root
}

func TestMediaReadsDoNotTrustPredictableWorkspaceIDs(t *testing.T) {
	app, _ := privateMediaApp(t)
	for _, path := range []string{"/download", "/thumbnail", "/media-metadata", "/audio-preview", "/waveform", "/scrub-proxy"} {
		response, err := app.Test(httptest.NewRequest("GET", path+"?session=u_alice&file=clip.mp4", nil))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s accepted a predictable session without read authorization: %d", path, response.StatusCode)
		}
	}
}

func TestAnonymousMediaReadsNeverProvisionUnknownWorkspaces(t *testing.T) {
	app, _ := privateMediaApp(t)
	id := sessions.NewID()
	response, err := app.Test(httptest.NewRequest("GET", "/download?session="+id+"&file=clip.mp4", nil))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Errorf("unknown media workspace returned %d", response.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(storage.DataDir, id)); !os.IsNotExist(err) {
		t.Fatal("anonymous media read provisioned a workspace", err)
	}
}

func TestHeartbeatCannotAuthorizeAHeaderAndTouchAnotherPath(t *testing.T) {
	app, _ := privateMediaApp(t)
	request := httptest.NewRequest("POST", "/sessions/u_bob/heartbeat", nil)
	request.Header.Set("Authorization", "Bearer alice-token")
	request.Header.Set("X-Session-Id", "u_alice")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Errorf("foreign heartbeat returned %d", response.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(storage.DataDir, "u_bob")); !os.IsNotExist(err) {
		t.Fatal("foreign heartbeat provisioned the victim workspace", err)
	}
}

func TestMediaReadCapabilityIsWorkspaceBoundAndReadOnly(t *testing.T) {
	app, _ := privateMediaApp(t)
	token, err := sessions.MediaToken("u_alice")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		name, session, token, authorization, method, path string
		status                                            int
	}{
		{"media tag", "u_alice", token, "", "GET", "/download", 200},
		{"foreign workspace", "u_bob", token, "", "GET", "/download", 401},
		{"invalid capability", "u_alice", strings.Repeat("0", 64), "", "GET", "/download", 401},
		{"owner fetch", "u_alice", "", "alice-token", "GET", "/download", 200},
		{"foreign owner fetch", "u_bob", "", "alice-token", "GET", "/download", 403},
		{"invalid auth cannot fall back", "u_alice", token, "bad-token", "GET", "/download", 401},
		{"capability grants no upload", "u_alice", token, "", "POST", "/upload", 401},
	} {
		t.Run(item.name, func(t *testing.T) {
			request := httptest.NewRequest(item.method, item.path+"?file=clip.mp4&session="+item.session+"&mediaToken="+item.token, nil)
			if item.authorization != "" {
				request.Header.Set("Authorization", "Bearer "+item.authorization)
			}
			response, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			data, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != item.status {
				t.Fatalf("status=%d, want=%d: %s", response.StatusCode, item.status, data)
			}
			if item.status == 200 && string(data) != "private-media" {
				t.Fatal("authorized media bytes changed")
			}
		})
	}
}

func TestAuthenticatedHeartbeatReturnsStablePrivateMediaCapability(t *testing.T) {
	app, _ := privateMediaApp(t)
	var previousToken string
	for range 2 {
		request := httptest.NewRequest("POST", "/sessions/u_alice/heartbeat", nil)
		request.Header.Set("Authorization", "Bearer alice-token")
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			MediaToken string `json:"mediaToken"`
		}
		err = json.NewDecoder(response.Body).Decode(&result)
		response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" || !sessions.ValidMediaToken("u_alice", result.MediaToken) {
			t.Fatal("owner could not obtain uncached media access", response.StatusCode)
		}
		if previousToken != "" && previousToken != result.MediaToken {
			t.Fatal("heartbeat invalidated another tab's media capability")
		}
		previousToken = result.MediaToken
	}
}

func TestOpaqueRegisteredMediaSessionsRemainReadable(t *testing.T) {
	app, _ := privateMediaApp(t)
	id := sessions.NewID()
	root, err := sessions.TouchOwned(id, "alice")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sessions.Evict(id) })
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), []byte("opaque-media"), 0600); err != nil {
		t.Fatal(err)
	}
	response, err := app.Test(httptest.NewRequest("GET", "/download?session="+id+"&file=clip.mp4", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 200 || string(data) != "opaque-media" {
		t.Fatal("opaque session read contract regressed", response.StatusCode, err)
	}
}

func TestDownloadImmediatelyReflectsReplacementAndSupportsRanges(t *testing.T) {
	app, root := privateMediaApp(t)
	request := func(byteRange string) *http.Response {
		t.Helper()
		req := httptest.NewRequest("GET", "/download?session=u_alice&file=clip.mp4", nil)
		req.Header.Set("Authorization", "Bearer alice-token")
		req.Header.Set("Range", byteRange)
		response, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	response := request("")
	firstETag := response.Header.Get("ETag")
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	path := filepath.Join(root, "clip.mp4")
	if err := os.Remove(path); err != nil {
		t.Fatal("download retained an open filesystem-cache handle", err)
	}
	if err := os.WriteFile(path, []byte("new-video-bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	response = request("bytes=0-2")
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 206 || string(data) != "new" || response.Header.Get("ETag") == firstETag {
		t.Fatal("download served stale bytes or lost range/version support", response.StatusCode, string(data))
	}
}
