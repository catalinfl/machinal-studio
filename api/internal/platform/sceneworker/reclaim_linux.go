package sceneworker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const (
	maxReclaimManifestBytes = 1 << 20
	maxReclaimFiles         = 8192
	maxSceneCacheEntries    = 64
)

var sceneCacheEntry = regexp.MustCompile(`^[a-f0-9]{64}$`)

type reclaimManifest struct {
	Version int      `json:"version"`
	Files   []string `json:"reclaimFiles"`
}

type reclaimStats struct {
	Advised int
	Failed  int
}

func workerReclaimer(manifestPath, cacheRoot string) func(context.Context) {
	if manifestPath == "" {
		return nil
	}
	files, err := loadReclaimManifest(manifestPath)
	if err != nil {
		log.Printf("scene_worker page_cache_config_failed: %v", err)
		return nil
	}
	return func(ctx context.Context) {
		started := time.Now()
		before := cacheMemorySnapshot()
		stats := reclaimFiles(ctx, files, discardFilePages)
		if cacheRoot != "" && ctx.Err() == nil {
			cache := reclaimSceneCache(ctx, cacheRoot, adviseFilePages)
			stats.Advised += cache.Advised
			stats.Failed += cache.Failed
		}
		log.Printf("scene_worker page_cache_release advised=%d failed=%d timeout=%t elapsed_ms=%d before=%s after=%s",
			stats.Advised, stats.Failed, ctx.Err() != nil, time.Since(started).Milliseconds(), before, cacheMemorySnapshot())
	}
}

func loadReclaimManifest(path string) ([]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open renderer cache manifest: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat renderer cache manifest: %w", err)
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || info.Size() > maxReclaimManifestBytes || !ok || owner.Uid != 0 || info.Mode().Perm()&0022 != 0 {
		return nil, errors.New("renderer cache manifest must be a bounded root-owned non-writable regular file")
	}
	return decodeReclaimManifest(io.LimitReader(file, maxReclaimManifestBytes+1))
}

func decodeReclaimManifest(reader io.Reader) ([]string, error) {
	var manifest reclaimManifest
	if err := json.NewDecoder(reader).Decode(&manifest); err != nil {
		return nil, fmt.Errorf("decode renderer cache manifest: %w", err)
	}
	if manifest.Version != 1 || len(manifest.Files) == 0 || len(manifest.Files) > maxReclaimFiles {
		return nil, errors.New("invalid renderer cache manifest version or file count")
	}
	files := make([]string, 0, len(manifest.Files))
	seen := make(map[string]bool, len(manifest.Files))
	for _, path := range manifest.Files {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path || strings.ContainsRune(path, '\x00') {
			return nil, errors.New("renderer cache manifest requires clean absolute paths")
		}
		if !seen[path] {
			files = append(files, path)
			seen[path] = true
		}
	}
	return files, nil
}

func reclaimFiles(ctx context.Context, paths []string, discard func(string) error) reclaimStats {
	var stats reclaimStats
	for _, path := range paths {
		if ctx.Err() != nil {
			break
		}
		if err := discard(path); err == nil {
			stats.Advised++
		} else if !errors.Is(err, os.ErrNotExist) {
			stats.Failed++
		}
	}
	return stats
}

func reclaimSceneCache(ctx context.Context, root string, discard func(*os.File) error) reclaimStats {
	if ctx.Err() != nil {
		return reclaimStats{}
	}
	directory, err := os.OpenRoot(root)
	if errors.Is(err, os.ErrNotExist) {
		return reclaimStats{}
	}
	if err != nil {
		return reclaimStats{Failed: 1}
	}
	defer directory.Close()
	list, err := directory.Open(".")
	if err != nil {
		return reclaimStats{Failed: 1}
	}
	defer list.Close()
	entries, err := list.ReadDir(maxSceneCacheEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return reclaimStats{Failed: 1}
	}
	var stats reclaimStats
	for _, entry := range entries {
		if ctx.Err() != nil {
			break
		}
		if !entry.IsDir() || !sceneCacheEntry.MatchString(entry.Name()) {
			continue
		}
		for _, name := range []string{"scene.mp4", "scene.webm"} {
			if ctx.Err() != nil {
				return stats
			}
			result := reclaimCacheFile(directory, filepath.Join(entry.Name(), name), discard)
			stats.Advised += result.Advised
			stats.Failed += result.Failed
		}
	}
	return stats
}

func reclaimCacheFile(directory *os.Root, path string, discard func(*os.File) error) reclaimStats {
	info, err := directory.Lstat(path)
	if errors.Is(err, os.ErrNotExist) || err == nil && !info.Mode().IsRegular() {
		return reclaimStats{}
	}
	if err != nil {
		return reclaimStats{Failed: 1}
	}
	file, err := directory.OpenFile(path, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return reclaimStats{Failed: 1}
	}
	defer file.Close()
	if err := discard(file); err != nil {
		return reclaimStats{Failed: 1}
	}
	return reclaimStats{Advised: 1}
}

func discardFilePages(path string) error {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	return adviseDescriptorPages(fd)
}

func adviseFilePages(file *os.File) error {
	return adviseDescriptorPages(int(file.Fd()))
}

func adviseDescriptorPages(fd int) error {
	var info unix.Stat_t
	if err := unix.Fstat(fd, &info); err != nil {
		return err
	}
	if info.Mode&unix.S_IFMT != unix.S_IFREG {
		return errors.New("page cache advice requires a regular file")
	}
	// Do not fsync or delete: only clean, unmapped pages are eligible for this advice.
	return unix.Fadvise(fd, 0, 0, unix.FADV_DONTNEED)
}

func cacheMemorySnapshot() string {
	data, err := os.ReadFile("/sys/fs/cgroup/memory.stat")
	if err != nil {
		return "unavailable"
	}
	values := make(map[string]uint64)
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && (fields[0] == "anon" || fields[0] == "file" || fields[0] == "kernel") {
			value, err := strconv.ParseUint(fields[1], 10, 64)
			if err != nil {
				return "unavailable"
			}
			values[fields[0]] = value
		}
	}
	total, err := os.ReadFile("/sys/fs/cgroup/memory.current")
	if err != nil {
		return "unavailable"
	}
	current, err := strconv.ParseUint(strings.TrimSpace(string(total)), 10, 64)
	if err != nil {
		return "unavailable"
	}
	return fmt.Sprintf("total:%d,anon:%d,file:%d,kernel:%d", current, values["anon"], values["file"], values["kernel"])
}
