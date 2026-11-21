package filecache

import (
	"errors"
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

func release(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat completed media: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("media cache release requires a regular file")
	}
	// DONTNEED alone can leave newly written media resident as dirty pages.
	// Flush only this descriptor, never the filesystem or host-wide cache.
	if err := file.Sync(); err != nil {
		return fmt.Errorf("flush completed media: %w", err)
	}
	if err := unix.Fadvise(int(file.Fd()), 0, 0, unix.FADV_DONTNEED); err != nil {
		return fmt.Errorf("release completed media pages: %w", err)
	}
	return nil
}

func releasePath(path string) error {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return fmt.Errorf("open completed media: %w", err)
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	return release(file)
}
