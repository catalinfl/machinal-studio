package objectstore

import (
	"context"
	"crypto/md5"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"
)

func cacheS3(t *testing.T) (*Client, func([]byte)) {
	t.Helper()
	var mu sync.Mutex
	var data []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodPut {
			data, _ = io.ReadAll(r.Body)
		}
		if data == nil {
			w.WriteHeader(404)
			return
		}
		w.Header().Set("ETag", fmt.Sprintf(`"%x"`, md5.Sum(data)))
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		if r.Method == http.MethodGet {
			w.Write(data)
		}
	}))
	t.Cleanup(server.Close)
	return New(Config{Endpoint: server.URL, Bucket: "test", AccessKey: "key", SecretKey: "secret", Region: "auto"}), func(value []byte) { mu.Lock(); data = value; mu.Unlock() }
}

func oldCacheFile(t *testing.T, root, name, contents string) string {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCloudCleanupRequiresMatchingVersionAndLocalContents(t *testing.T) {
	for _, changed := range []string{"none", "local", "remote"} {
		t.Run(changed, func(t *testing.T) {
			client, remote := cacheS3(t)
			root := t.TempDir()
			path := oldCacheFile(t, root, "clip.mp4", "original")
			original := oldCacheFile(t, root, "local-only.mp4", "sole original")
			if err := client.PublishFile(context.Background(), path, "owner/clip.mp4"); err != nil {
				t.Fatal(err)
			}
			if changed == "remote" {
				remote([]byte("replaced"))
			}
			if changed == "local" {
				info, err := os.Stat(path)
				if err != nil {
					t.Fatal(err)
				}
				oldCacheFile(t, root, "clip.mp4", "replaced")
				if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
					t.Fatal(err)
				}
			}
			freed, err := client.PruneCloudCopies(context.Background(), root, time.Now().Add(-time.Minute))
			if err != nil {
				t.Fatal(err)
			}
			_, statErr := os.Stat(path)
			if changed == "none" && (!os.IsNotExist(statErr) || freed != 8) {
				t.Fatal("recoverable cache not pruned", freed, statErr)
			}
			if changed != "none" && statErr != nil {
				t.Fatal("changed local/cloud version was deleted", statErr)
			}
			if _, err := os.Stat(original); err != nil {
				t.Fatal("sole original was deleted", err)
			}
		})
	}
}

func TestLegacyCloudDiscoveryProvesContentBeforeCleanup(t *testing.T) {
	client, remote := cacheS3(t)
	root := t.TempDir()
	path := oldCacheFile(t, root, "clip.mp4", "original")
	remote([]byte("original"))
	before := time.Now().Add(-time.Minute)
	if err := client.DiscoverCloudCopies(context.Background(), root, []string{"owner"}, before); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PruneCloudCopies(context.Background(), root, before); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("legacy matching cache was not reclaimed", err)
	}
}

func TestLegacyCloudDiscoveryKeepsLocalOnlyFilesWithoutReportingMissingCloudCopies(t *testing.T) {
	client, _ := cacheS3(t)
	root := t.TempDir()
	path := oldCacheFile(t, root, "local-only.scene.json", "sole original")
	before := time.Now().Add(-time.Minute)
	if err := client.DiscoverCloudCopies(context.Background(), root, []string{"project", "owner"}, before); err != nil {
		t.Fatalf("missing cloud copy is expected for local-only media: %v", err)
	}
	if freed, err := client.PruneCloudCopies(context.Background(), root, before); err != nil || freed != 0 {
		t.Fatalf("local-only media must not be pruned: freed=%d err=%v", freed, err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("sole local original was removed: %v", err)
	}
}

func TestCloudCleanupKeepsLocalCopyWhenRemoteWasRemoved(t *testing.T) {
	client, remote := cacheS3(t)
	root := t.TempDir()
	path := oldCacheFile(t, root, "clip.mp4", "original")
	if err := client.PublishFile(context.Background(), path, "owner/clip.mp4"); err != nil {
		t.Fatal(err)
	}
	remote(nil)
	if freed, err := client.PruneCloudCopies(context.Background(), root, time.Now().Add(-time.Minute)); err != nil || freed != 0 {
		t.Fatalf("missing remote must preserve local cache without failing cleanup: freed=%d err=%v", freed, err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("sole remaining copy was removed: %v", err)
	}
}
