package sceneworker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unsafe"

	"golang.org/x/sys/unix"
)

func TestReclaimManifestRejectsInvalidPathsAndDeduplicates(t *testing.T) {
	for _, paths := range [][]string{nil, {"relative"}, {"/tmp/../private"}, {"/tmp/\x00bad"}, make([]string, maxReclaimFiles+1)} {
		data, _ := json.Marshal(reclaimManifest{Version: 1, Files: paths})
		if _, err := decodeReclaimManifest(bytes.NewReader(data)); err == nil {
			t.Fatalf("accepted invalid reclaim paths: %d", len(paths))
		}
	}
	files, err := decodeReclaimManifest(strings.NewReader(`{"version":1,"reclaimFiles":["/opt/node","/opt/node"]}`))
	if err != nil || len(files) != 1 {
		t.Fatalf("manifest deduplication failed: %v %v", files, err)
	}
}

func TestReclaimManifestRejectsWritableFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifest.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"reclaimFiles":["/opt/node"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if _, err := loadReclaimManifest(path); err == nil {
		t.Fatal("trusted a writable reclaim inventory")
	}
}

func TestReclaimContinuesAfterAdviceFailureAndStopsOnCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	stats := reclaimFiles(ctx, []string{"one", "missing", "denied", "last", "never"}, func(path string) error {
		calls++
		switch path {
		case "missing":
			return os.ErrNotExist
		case "denied":
			return os.ErrPermission
		case "last":
			cancel()
		}
		return nil
	})
	if calls != 4 || stats.Advised != 2 || stats.Failed != 1 {
		t.Fatalf("unexpected bounded best-effort reclaim: %+v, calls=%d", stats, calls)
	}
}

func TestSceneCacheReclaimSelectsOnlyRegularVideosInsideCache(t *testing.T) {
	root := t.TempDir()
	entry := filepath.Join(root, strings.Repeat("a", 64))
	if err := os.Mkdir(entry, 0700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Join(entry, "scene.mp4"), filepath.Join(entry, "manifest.json"), filepath.Join(root, "credits.db")} {
		if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(filepath.Join(root, "credits.db"), filepath.Join(entry, "scene.webm")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(entry, filepath.Join(root, strings.Repeat("b", 64))); err != nil {
		t.Fatal(err)
	}
	var selected []string
	stats := reclaimSceneCache(context.Background(), root, func(file *os.File) error {
		selected = append(selected, file.Name())
		return nil
	})
	if stats.Advised != 1 || stats.Failed != 0 || len(selected) != 1 || !strings.HasSuffix(selected[0], "scene.mp4") {
		t.Fatalf("selected unrelated/symlink files: %+v, %v", stats, selected)
	}
	if data, err := os.ReadFile(filepath.Join(root, "credits.db")); err != nil || string(data) != "keep" {
		t.Fatalf("unrelated file changed: %q %v", data, err)
	}
}

func TestDiscardFilePagesPreservesContentsAndRejectsSymlinks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "synthetic.bin")
	data := bytes.Repeat([]byte("unchanged"), 8192)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := discardFilePages(path); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("cache advice changed file contents: %v", err)
	}
	link := path + ".link"
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if err := discardFilePages(link); err == nil {
		t.Fatal("page cache advice followed a symlink")
	}
	if err := discardFilePages(filepath.Dir(path)); err == nil {
		t.Fatal("page cache advice accepted a directory")
	}
	if err := discardFilePages(path + ".missing"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("lost missing-file diagnostic: %v", err)
	}
}

func residentPages(t *testing.T, file *os.File, size int) int {
	t.Helper()
	mapping, err := unix.Mmap(int(file.Fd()), 0, size, unix.PROT_READ, unix.MAP_SHARED)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Munmap(mapping)
	pages := make([]byte, (size+os.Getpagesize()-1)/os.Getpagesize())
	_, _, errno := unix.Syscall(unix.SYS_MINCORE, uintptr(unsafe.Pointer(&mapping[0])), uintptr(size), uintptr(unsafe.Pointer(&pages[0])))
	runtime.KeepAlive(mapping)
	runtime.KeepAlive(pages)
	if errno != 0 {
		t.Fatal(errno)
	}
	resident := 0
	for _, page := range pages {
		if page&1 != 0 {
			resident++
		}
	}
	return resident
}

func TestDiscardCleanPagesReleasesSyntheticResidency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "clean-cache.bin")
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	data := bytes.Repeat([]byte("only-synthetic-data"), 256*1024)
	if _, err := file.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := file.Sync(); err != nil {
		t.Fatal(err)
	}
	before := residentPages(t, file, len(data))
	if err := discardFilePages(path); err != nil {
		t.Fatal(err)
	}
	after := residentPages(t, file, len(data))
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("eviction changed the persisted bytes: %v", err)
	}
	if before == 0 || after >= before {
		t.Skipf("filesystem did not honor advisory eviction: before=%d after=%d", before, after)
	}
	t.Logf("synthetic resident pages before=%d after=%d", before, after)
}
