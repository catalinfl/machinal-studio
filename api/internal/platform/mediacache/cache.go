package mediacache

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"ffmpeg-go-server/internal/platform/filecache"
)

const Directory = ".media-cache"

var (
	ErrInvalidSource = errors.New("source must be a regular file, not a symlink")
	ErrSourceChanged = errors.New("source changed during processing; retry the request")
)

// Source identifies the file a cache entry was derived from.
type Source struct {
	Path    string
	Size    int64
	ModTime int64
	Remote  *RemoteSource
}

type RemoteSource struct {
	Key  string
	ETag string
	URL  string
}

// ReadSource snapshots path for cache keying.
func ReadSource(path string) (Source, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return Source{}, fmt.Errorf("resolve cache source: %w", err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return Source{}, fmt.Errorf("stat cache source: %w", err)
	}
	if !info.Mode().IsRegular() {
		return Source{}, ErrInvalidSource
	}
	return Source{Path: path, Size: info.Size(), ModTime: info.ModTime().UnixNano()}, nil
}

// Check verifies the source has not changed since ReadSource.
func (s Source) Check() error {
	if s.Remote != nil {
		// The resolver checks remote existence with HEAD; generation pins all
		// range reads to that version with If-Match rather than a local stat.
		if s.Remote.Key == "" || s.Remote.ETag == "" || s.Remote.URL == "" || s.Size <= 0 {
			return ErrInvalidSource
		}
		return nil
	}
	current, err := ReadSource(s.Path)
	if err != nil {
		return err
	}
	if current != s {
		return ErrSourceChanged
	}
	return nil
}

// Key derives the cache directory for profile from the source snapshot.
func (s Source) Key(profile string) string {
	if s.Remote != nil {
		// Presigned URLs expire and must not invalidate an unchanged asset.
		return fmt.Sprintf("%x", sha256.Sum256(fmt.Appendf(nil, "%s\x00%s\x00%s\x00%d\x00%s", s.Path, s.Remote.Key, s.Remote.ETag, s.Size, profile)))
	}
	return fmt.Sprintf("%x", sha256.Sum256(fmt.Appendf([]byte("%s\x00%d\x00%d\x00%s"), s.Path, s.Size, s.ModTime, profile)))
}

type flight struct {
	done chan struct{}
	err  error
}

// Cache publishes immutable, source-keyed files only after successful generation
// and validation. The zero value is ready to use; failures are never retained.
type Cache struct {
	mu      sync.Mutex
	flights map[string]*flight
}

var Default Cache

// Get returns the cached file for profile, generating it once per key.
func (cache *Cache) Get(ctx context.Context, source Source, profile, name string, generate func(string) error, validate func(string) error) (string, error) {
	if err := source.Check(); err != nil {
		return "", err
	}
	path := filepath.Join(filepath.Dir(source.Path), Directory, source.Key(profile), name)
	cache.mu.Lock()
	if pending := cache.flights[path]; pending != nil {
		cache.mu.Unlock()
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-pending.done:
			if pending.err != nil {
				return "", pending.err
			}
			return path, source.Check()
		}
	}
	if cache.flights == nil {
		cache.flights = make(map[string]*flight)
	}
	pending := &flight{done: make(chan struct{})}
	cache.flights[path] = pending
	cache.mu.Unlock()

	err := cache.generate(ctx, source, path, generate, validate)
	cache.mu.Lock()
	pending.err = err
	delete(cache.flights, path)
	close(pending.done)
	cache.mu.Unlock()
	return path, err
}

func (cache *Cache) generate(ctx context.Context, source Source, path string, generate func(string) error, validate func(string) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validate(path); err == nil {
		return source.Check()
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("create cache dir: %w", err)
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".pending-*")
	if err != nil {
		return fmt.Errorf("create cache temp file: %w", err)
	}
	tempPath := temp.Name()
	// Best-effort: temp files are renamed on success; leftovers are swept on restart.
	defer os.Remove(tempPath)
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close cache temp file: %w", err)
	}
	if source.Remote == nil {
		defer filecache.ReleasePath(source.Path)
	}
	if err := generate(tempPath); err != nil {
		return fmt.Errorf("generate cache entry: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := validate(tempPath); err != nil {
		return fmt.Errorf("invalid generated cache: %w", err)
	}
	if err := source.Check(); err != nil {
		return fmt.Errorf("verify cache source: %w", err)
	}
	// An invalid old entry is not a completed output and must not block rename
	// on Windows. Valid entries are immutable and never replaced in place.
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove stale cache entry: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("publish cache entry: %w", err)
	}
	filecache.ReleasePath(path)
	return nil
}
