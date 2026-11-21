package mediacache

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testSource(t *testing.T) Source {
	t.Helper()
	path := filepath.Join(t.TempDir(), "clip.mp4")
	if err := os.WriteFile(path, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	source, err := ReadSource(path)
	if err != nil {
		t.Fatal(err)
	}
	return source
}

func validateTestOutput(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if string(data) != "complete" {
		return errors.New("incomplete output")
	}
	return nil
}

func TestCacheDiskHitAndSourceReplacement(t *testing.T) {
	source := testSource(t)
	var cache Cache
	calls := 0
	generate := func(path string) error {
		calls++
		return os.WriteFile(path, []byte("complete"), 0600)
	}
	first, err := cache.Get(context.Background(), source, "test-v1", "proxy.mp4", generate, validateTestOutput)
	if err != nil {
		t.Fatal(err)
	}
	// A new instance exercises the persisted cache rather than process memory.
	cache = Cache{}
	hit, err := cache.Get(context.Background(), source, "test-v1", "proxy.mp4", generate, validateTestOutput)
	if err != nil || hit != first || calls != 1 {
		t.Fatalf("disk hit = %q, calls = %d, err = %v", hit, calls, err)
	}
	for _, change := range []string{"mtime", "size"} {
		t.Run(change, func(t *testing.T) {
			if change == "mtime" {
				modified := time.Unix(0, source.ModTime).Add(time.Second)
				if err := os.Chtimes(source.Path, modified, modified); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(source.Path, []byte("replacement with different size"), 0600); err != nil {
				t.Fatal(err)
			}
			replacement, err := ReadSource(source.Path)
			if err != nil {
				t.Fatal(err)
			}
			previousCalls := calls
			path, err := cache.Get(context.Background(), replacement, "test-v1", "proxy.mp4", generate, validateTestOutput)
			if err != nil || path == first || calls != previousCalls+1 {
				t.Fatalf("replacement = %q, calls = %d, err = %v", path, calls, err)
			}
		})
	}
	if err := os.Remove(source.Path); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.Get(context.Background(), source, "test-v1", "proxy.mp4", generate, validateTestOutput); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing source served stale cache: %v", err)
	}
}

func TestCacheCoalescesConcurrentWorkAndPublishesAtomically(t *testing.T) {
	source := testSource(t)
	var cache Cache
	var calls atomic.Int32
	started := make(chan string, 1)
	release := make(chan struct{})
	generate := func(path string) error {
		calls.Add(1)
		if err := os.WriteFile(path, []byte("partial"), 0600); err != nil {
			return err
		}
		started <- path
		<-release
		return os.WriteFile(path, []byte("complete"), 0600)
	}
	var workers sync.WaitGroup
	errors := make(chan error, 16)
	for range 16 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			_, err := cache.Get(context.Background(), source, "test", "proxy.mp4", generate, validateTestOutput)
			errors <- err
		}()
	}
	tempPath := <-started
	if _, err := os.Stat(filepath.Join(filepath.Dir(tempPath), "proxy.mp4")); !os.IsNotExist(err) {
		t.Errorf("partial output is visible at completed path: %v", err)
	}
	close(release)
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Error(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("generated %d times", calls.Load())
	}
	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Fatalf("temporary output remains: %v", err)
	}
}

func TestCacheFailureCleanupAndRetry(t *testing.T) {
	for _, failure := range []string{"process", "validation", "source replacement", "timeout"} {
		t.Run(failure, func(t *testing.T) {
			source := testSource(t)
			var cache Cache
			var tempPath string
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			generate := func(path string) error {
				tempPath = path
				if err := os.WriteFile(path, []byte("partial"), 0600); err != nil {
					return err
				}
				switch failure {
				case "process":
					return errors.New("encoder failed")
				case "source replacement":
					if err := os.WriteFile(source.Path, []byte("replaced"), 0600); err != nil {
						return err
					}
					return os.WriteFile(path, []byte("complete"), 0600)
				case "timeout":
					cancel()
				}
				return nil
			}
			if _, err := cache.Get(ctx, source, "test", "proxy.mp4", generate, validateTestOutput); err == nil {
				t.Fatal("failed generation succeeded")
			}
			entries, err := os.ReadDir(filepath.Dir(tempPath))
			if err != nil || len(entries) != 0 {
				t.Fatalf("failure left files: %v, %v", entries, err)
			}
			source, err = ReadSource(source.Path)
			if err != nil {
				t.Fatal(err)
			}
			_, err = cache.Get(context.Background(), source, "test", "proxy.mp4", func(path string) error {
				return os.WriteFile(path, []byte("complete"), 0600)
			}, validateTestOutput)
			if err != nil {
				t.Fatalf("retry failed: %v", err)
			}
		})
	}
}

func TestCacheRepairsInvalidEntry(t *testing.T) {
	source := testSource(t)
	var cache Cache
	generate := func(path string) error { return os.WriteFile(path, []byte("complete"), 0600) }
	path, err := cache.Get(context.Background(), source, "test", "proxy.mp4", generate, validateTestOutput)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("truncated"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.Get(context.Background(), source, "test", "proxy.mp4", generate, validateTestOutput); err != nil {
		t.Fatal(err)
	}
	if err := validateTestOutput(path); err != nil {
		t.Fatal(err)
	}
}

func TestRemoteCacheUsesObjectVersionInsteadOfSignedURL(t *testing.T) {
	source := Source{
		Path: filepath.Join(t.TempDir(), "clip.mp4"), Size: 100,
		Remote: &RemoteSource{Key: "user/clip.mp4", ETag: "version-1", URL: "https://s3.test/clip.mp4?signature=first"},
	}
	var cache Cache
	calls := 0
	generate := func(path string) error {
		calls++
		return os.WriteFile(path, []byte("complete"), 0600)
	}
	first, err := cache.Get(context.Background(), source, "thumbnail", "thumbnail.jpg", generate, validateTestOutput)
	if err != nil {
		t.Fatal(err)
	}
	source.Remote.URL = "https://s3.test/clip.mp4?signature=second"
	hit, err := cache.Get(context.Background(), source, "thumbnail", "thumbnail.jpg", generate, validateTestOutput)
	if err != nil || hit != first || calls != 1 {
		t.Fatalf("new signed URL missed cache: path=%s calls=%d err=%v", hit, calls, err)
	}
	source.Remote.ETag = "version-2"
	replacement, err := cache.Get(context.Background(), source, "thumbnail", "thumbnail.jpg", generate, validateTestOutput)
	if err != nil || replacement == first || calls != 2 {
		t.Fatalf("new object version reused stale cache: path=%s calls=%d err=%v", replacement, calls, err)
	}
}

func TestReadSourceRejectsDirectoriesAndSymlinks(t *testing.T) {
	source := testSource(t)
	if _, err := ReadSource(filepath.Dir(source.Path)); !errors.Is(err, ErrInvalidSource) {
		t.Fatalf("directory accepted: %v", err)
	}
	link := filepath.Join(filepath.Dir(source.Path), "link.mp4")
	if err := os.Symlink(source.Path, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := ReadSource(link); !errors.Is(err, ErrInvalidSource) {
		t.Fatalf("symlink accepted: %v", err)
	}
}
