package projects

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"ffmpeg-go-server/internal/platform/filecache"
)

const (
	maxTextAssetKeyBytes = 128
	maxTextAssets        = 1024
	maxTextCacheBytes    = 512 << 20
)

type textAssetReference struct {
	ID  string `json:"id"`
	Key string `json:"key"`
}

var textAssetsMu sync.Mutex

func (s *Store) textAssetPath(owner, project string, reference textAssetReference) (string, error) {
	if !ValidID(owner) || !ValidID(project) || len(reference.ID) != sha256.Size*2 || len(reference.Key) == 0 || len(reference.Key) > maxTextAssetKeyBytes {
		return "", ErrInvalid
	}
	digest, err := hex.DecodeString(reference.ID)
	if err != nil || reference.ID != hex.EncodeToString(digest) {
		return "", ErrInvalid
	}
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(reference.Key)))
	return filepath.Join(s.Root, owner, ".text-assets", project, key, reference.ID+".json"), nil
}

func (s *Store) saveTextAsset(owner, project string, reference textAssetReference, data []byte) error {
	path, err := s.textAssetPath(owner, project, reference)
	if err != nil {
		return err
	}
	var header struct {
		Key      string       `json:"key"`
		Overlays borrowedJSON `json:"overlays"`
	}
	if len(data) > MaxStateBytes || fmt.Sprintf("%x", sha256.Sum256(data)) != reference.ID || json.Unmarshal(data, &header) != nil || header.Key != reference.Key || len(header.Overlays) == 0 || header.Overlays[0] != '[' {
		return ErrInvalid
	}
	textAssetsMu.Lock()
	defer textAssetsMu.Unlock()
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || info.Size() != int64(len(data)) {
			return ErrInvalid
		}
		return verifyTextAsset(path, reference.ID)
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat caption image asset: %w", err)
	}
	if err := textAssetQuota(filepath.Dir(filepath.Dir(path)), int64(len(data))); err != nil {
		return err
	}
	return writeTextAsset(path, data)
}

func verifyTextAsset(path, expected string) error {
	file, err := openSnapshotFile(path)
	if err != nil {
		return fmt.Errorf("open existing caption image asset: %w", err)
	}
	defer file.Close()
	defer filecache.Release(file)
	digest := sha256.New()
	if _, err := io.Copy(digest, io.LimitReader(file, MaxStateBytes+1)); err != nil {
		return fmt.Errorf("verify existing caption image asset: %w", err)
	}
	if hex.EncodeToString(digest.Sum(nil)) != expected {
		return ErrInvalid
	}
	return nil
}

func textAssetQuota(root string, incoming int64) error {
	count, total := 0, incoming
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if errors.Is(err, os.ErrNotExist) && path == root {
			return nil
		}
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		count++
		total += info.Size()
		if count >= maxTextAssets || total > maxTextCacheBytes {
			return ErrInvalid
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("caption image storage limit: %w", err)
	}
	return nil
}

func writeTextAsset(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), privateDir); err != nil {
		return fmt.Errorf("create caption image directory: %w", err)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".text-*")
	if err != nil {
		return fmt.Errorf("create caption image asset: %w", err)
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err := file.Write(data); err != nil {
		return fmt.Errorf("write caption image asset: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync caption image asset: %w", err)
	}
	filecache.Release(file)
	if err := file.Close(); err != nil {
		return fmt.Errorf("close caption image asset: %w", err)
	}
	if err := publishJSONFile(file.Name(), path); err != nil {
		return fmt.Errorf("publish caption image asset: %w", err)
	}
	return nil
}

func (s *Store) validateTextReferences(owner, project string, state json.RawMessage) error {
	var input struct {
		Timeline struct {
			Session *struct {
				Reference   *textAssetReference `json:"preparedTextRef"`
				Composition struct {
					Reference *textAssetReference `json:"preparedTextRef"`
				} `json:"composition"`
			} `json:"documentSession"`
		} `json:"timeline"`
	}
	if json.Unmarshal(state, &input) != nil {
		return ErrInvalid
	}
	if input.Timeline.Session == nil {
		return nil
	}
	for _, reference := range []*textAssetReference{input.Timeline.Session.Reference, input.Timeline.Session.Composition.Reference} {
		if reference == nil {
			continue
		}
		path, err := s.textAssetPath(owner, project, *reference)
		if err != nil {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("caption image reference is unavailable: %w", ErrInvalid)
		}
	}
	return nil
}
