package filecache

import (
	"errors"
	"log"
	"os"
)

// Release keeps the file and descriptor intact; cache reclamation is best-effort.
// Call it after the last read/write, not between passes over the same media.
func Release(file *os.File) {
	if err := release(file); err != nil {
		log.Printf("media_page_cache_release failed: %v", err)
	}
}

func ReleasePath(path string) {
	if err := releasePath(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("media_page_cache_release failed: %v", err)
	}
}
