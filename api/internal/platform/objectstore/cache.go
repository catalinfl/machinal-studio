package objectstore

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const cloudReceiptDirectory = ".cloud-copies"
const legacyDiscoveryLimit = 100

type cloudCopy struct {
	Name    string `json:"name"`
	Key     string `json:"key"`
	ETag    string `json:"etag"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
	SHA256  string `json:"sha256"`
}

func rememberCloudCopy(local, key, etag, checksum string) error {
	// Without a version token, eviction cannot prove recoverability.
	if etag == "" {
		return nil
	}
	info, err := os.Lstat(local)
	if err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("cache receipt requires a regular file")
	}
	receipt := cloudCopy{Name: filepath.Base(local), Key: key, ETag: etag, Size: info.Size(), ModTime: info.ModTime().UnixNano(), SHA256: checksum}
	directory := filepath.Join(filepath.Dir(local), cloudReceiptDirectory)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return fmt.Errorf("create cloud receipt directory: %w", err)
	}
	data, err := json.Marshal(receipt)
	if err != nil {
		return fmt.Errorf("encode cloud receipt: %w", err)
	}
	file, err := os.CreateTemp(directory, ".receipt-*")
	if err != nil {
		return fmt.Errorf("create cloud receipt: %w", err)
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return fmt.Errorf("write cloud receipt: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close cloud receipt: %w", err)
	}
	name := fmt.Sprintf("%x.json", sha256.Sum256([]byte(receipt.Name)))
	if err := os.Rename(file.Name(), filepath.Join(directory, name)); err != nil {
		return fmt.Errorf("publish cloud receipt: %w", err)
	}
	return nil
}

// PruneCloudCopies never deletes a sole local original, an unverified legacy file,
// or a cloud version that has changed. The caller must exclude active workspaces.
func (c *Client) PruneCloudCopies(ctx context.Context, root string, before time.Time) (int64, error) {
	if !c.Enabled() {
		return 0, nil
	}
	directory := filepath.Join(root, cloudReceiptDirectory)
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("list cloud receipts: %w", err)
	}
	defer os.Remove(directory) // Only removes the directory once all receipts are gone.
	var freed int64
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return freed, err
		}
		if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		data, err := os.ReadFile(path)
		var receipt cloudCopy
		if err != nil || len(data) > 8192 || json.Unmarshal(data, &receipt) != nil || !validLocalName(receipt.Name) {
			continue
		}
		if _, err := os.Lstat(filepath.Join(root, receipt.Name)); os.IsNotExist(err) {
			_ = os.Remove(path)
			continue
		}
		removed, err := c.pruneCloudCopy(ctx, root, receipt, before)
		if err != nil {
			return freed, err
		}
		if removed {
			freed += receipt.Size
			_ = os.Remove(path)
		}
	}
	return freed, nil
}

func (c *Client) pruneCloudCopy(ctx context.Context, root string, receipt cloudCopy, before time.Time) (bool, error) {
	local := filepath.Join(root, receipt.Name)
	info, err := os.Lstat(local)
	if os.IsNotExist(err) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("stat cloud cache: %w", err)
	}
	if !info.Mode().IsRegular() || !info.ModTime().Before(before) || info.Size() != receipt.Size || info.ModTime().UnixNano() != receipt.ModTime {
		return false, nil
	}
	object, err := c.Head(ctx, receipt.Key)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if object.Size != receipt.Size || object.ETag != receipt.ETag {
		return false, nil
	}
	file, err := os.Open(local)
	if err != nil {
		return false, fmt.Errorf("open cloud cache: %w", err)
	}
	hash := sha256.New()
	_, copyErr := io.Copy(hash, file)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		return false, fmt.Errorf("verify cloud cache contents")
	}
	if hex.EncodeToString(hash.Sum(nil)) != receipt.SHA256 {
		return false, nil
	}
	current, err := os.Lstat(local)
	if err != nil || !os.SameFile(info, current) || current.ModTime() != info.ModTime() || current.Size() != info.Size() {
		return false, nil
	}
	if err := os.Remove(local); err != nil {
		return false, fmt.Errorf("remove cloud cache: %w", err)
	}
	return true, nil
}

// DiscoverCloudCopies upgrades old caches only when a single-part S3 ETag
// matches the local MD5. Opaque/multipart ETags are not integrity evidence.
func (c *Client) DiscoverCloudCopies(ctx context.Context, root string, prefixes []string, before time.Time) error {
	if !c.Enabled() {
		return nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return fmt.Errorf("list legacy cloud cache: %w", err)
	}
	checked := 0
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if checked >= legacyDiscoveryLimit {
			break
		}
		if !entry.Type().IsRegular() || !validLocalName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.ModTime().Before(before) {
			continue
		}
		receiptPath := filepath.Join(root, cloudReceiptDirectory, fmt.Sprintf("%x.json", sha256.Sum256([]byte(entry.Name()))))
		if _, err := os.Lstat(receiptPath); err == nil {
			continue
		}
		checked++
		for _, prefix := range prefixes {
			for _, key := range SessionKeys(prefix, entry.Name()) {
				object, err := c.Head(ctx, key)
				if errors.Is(err, os.ErrNotExist) {
					continue
				}
				if err != nil {
					return err
				}
				if object.Size != info.Size() || len(object.ETag) != md5.Size*2 {
					continue
				}
				if err := adoptLegacyCopy(filepath.Join(root, entry.Name()), object, info); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func adoptLegacyCopy(local string, object Object, original os.FileInfo) error {
	file, err := os.Open(local)
	if err != nil {
		return fmt.Errorf("open legacy cloud cache: %w", err)
	}
	md5Hash, checksum := md5.New(), sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(md5Hash, checksum), file)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		return fmt.Errorf("hash legacy cloud cache")
	}
	current, err := os.Lstat(local)
	if err != nil || !os.SameFile(original, current) || current.ModTime() != original.ModTime() || current.Size() != original.Size() {
		return nil
	}
	if !strings.EqualFold(hex.EncodeToString(md5Hash.Sum(nil)), object.ETag) {
		return nil
	}
	return rememberCloudCopy(local, object.Key, object.ETag, hex.EncodeToString(checksum.Sum(nil)))
}
