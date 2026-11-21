package jobqueue

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"ffmpeg-go-server/internal/platform/storage"
)

const maxPayloadDiskBytes int64 = 2 << 30
const orphanPayloadAge = time.Hour

var payloadMu sync.Mutex

func payloadDirectory() string { return filepath.Join(storage.DataDir, ".job-inputs") }

func savePayload(id string, body []byte) error {
	payloadMu.Lock()
	defer payloadMu.Unlock()
	root := payloadDirectory()
	if err := os.MkdirAll(root, 0700); err != nil {
		return fmt.Errorf("create job payload directory: %w", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return fmt.Errorf("check job payload quota: %w", err)
	}
	var used int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("check job payload size: %w", err)
		}
		used += info.Size()
	}
	if used+int64(len(body)) > maxPayloadDiskBytes {
		return &StoreError{Status: 429}
	}
	path := filepath.Join(root, id)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create job payload: %w", err)
	}
	saved := false
	defer func() {
		if !saved {
			// Windows requires closing a failed write before removing its file.
			file.Close()
			removePayload(id)
		}
	}()
	if _, err := file.Write(body); err != nil {
		return fmt.Errorf("write job payload: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync job payload: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close job payload: %w", err)
	}
	saved = true
	return nil
}

func loadPayload(input Input) ([]byte, error) {
	if !idPattern.MatchString(input.Payload) {
		return nil, fmt.Errorf("invalid job payload reference")
	}
	path := filepath.Join(payloadDirectory(), input.Payload)
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > MaxInputBytes {
		return nil, fmt.Errorf("job payload is missing or invalid")
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read job payload: %w", err)
	}
	digest := sha256.Sum256(body)
	if hex.EncodeToString(digest[:]) != input.Digest {
		return nil, fmt.Errorf("job payload checksum does not match")
	}
	return body, nil
}

func removePayload(id string) {
	if !idPattern.MatchString(id) {
		return
	}
	if err := os.Remove(filepath.Join(payloadDirectory(), id)); err != nil && !os.IsNotExist(err) {
		log.Printf("remove job payload %s: %v", id, err)
	}
}

func cleanPayloads(active []Job) {
	payloadMu.Lock()
	defer payloadMu.Unlock()
	protected := make(map[string]bool, len(active))
	for _, job := range active {
		protected[job.ID] = true
	}
	entries, err := os.ReadDir(payloadDirectory())
	if err != nil {
		return
	}
	for _, entry := range entries {
		if protected[entry.Name()] || !idPattern.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err == nil && time.Since(info.ModTime()) > orphanPayloadAge {
			removePayload(entry.Name())
		}
	}
}
