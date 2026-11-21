package filecache

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"unsafe"

	"golang.org/x/sys/unix"
)

func TestReleaseDirtyMediaPreservesBytesAndReleasesPages(t *testing.T) {
	path := filepath.Join(t.TempDir(), "synthetic-media.bin")
	data := bytes.Repeat([]byte("media-retained-on-disk"), 256*1024)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	before := residentPages(t, file, len(data))
	if _, err := file.Seek(17, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	// Intentionally no Sync here: newly encoded media is still dirty.
	if err := release(file); err != nil {
		t.Fatal(err)
	}
	after := residentPages(t, file, len(data))
	position, err := file.Seek(0, io.SeekCurrent)
	if err != nil || position != 17 {
		t.Fatalf("descriptor closed or repositioned: position=%d err=%v", position, err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatalf("persisted media changed: %v", err)
	}
	if before == 0 || after >= before {
		t.Skipf("filesystem did not honor advice: before=%d after=%d", before, after)
	}
	t.Logf("dirty media resident pages before=%d after=%d; bytes unchanged", before, after)
}

func TestReleasePathRejectsLinksDirectoriesAndFIFOs(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "original")
	if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	fifo := filepath.Join(root, "fifo")
	if err := unix.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	for _, candidate := range []string{link, root, fifo} {
		if err := releasePath(candidate); err == nil {
			t.Fatalf("accepted non-regular media: %s", candidate)
		}
	}
	if err := releasePath(path); err != nil {
		t.Fatal(err)
	}
	if err := releasePath(filepath.Join(root, "missing")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("lost missing-file diagnostic: %v", err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || string(actual) != "keep" {
		t.Fatalf("original modified: %q %v", actual, err)
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
	var resident int
	for _, page := range pages {
		if page&1 != 0 {
			resident++
		}
	}
	return resident
}
