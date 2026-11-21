package sessions

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"ffmpeg-go-server/internal/platform/storage"
)

const mediaTokenBytes = 32

var mediaTokenMu sync.Mutex

func mediaTokenPath(id string) (string, error) {
	if !Valid(id) {
		return "", fmt.Errorf("invalid media session")
	}
	return filepath.Join(storage.DataDir, ".media-tokens", id), nil
}

func readMediaToken(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, int64(hex.EncodedLen(mediaTokenBytes)+1)))
	if err != nil {
		return "", fmt.Errorf("read media token: %w", err)
	}
	decoded, err := hex.DecodeString(string(data))
	if err != nil || len(decoded) != mediaTokenBytes {
		return "", fmt.Errorf("invalid stored media token")
	}
	return string(data), nil
}

// MediaToken is issued only after owner authentication. Its separate, persistent
// secret lets media tags read legacy u_<account> workspaces without exposing a JWT.
func MediaToken(id string) (string, error) {
	path, err := mediaTokenPath(id)
	if err != nil {
		return "", err
	}
	mediaTokenMu.Lock()
	defer mediaTokenMu.Unlock()
	if token, err := readMediaToken(path); err == nil || !os.IsNotExist(err) {
		return token, err
	}
	var secret [mediaTokenBytes]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return "", fmt.Errorf("generate media token: %w", err)
	}
	token := hex.EncodeToString(secret[:])
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", fmt.Errorf("create media token directory: %w", err)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".token-*")
	if err != nil {
		return "", fmt.Errorf("create media token: %w", err)
	}
	defer os.Remove(file.Name())
	if _, err := file.WriteString(token); err != nil {
		file.Close()
		return "", fmt.Errorf("write media token: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close media token: %w", err)
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return "", fmt.Errorf("publish media token: %w", err)
	}
	return token, nil
}

func ValidMediaToken(id, token string) bool {
	if len(token) != hex.EncodedLen(mediaTokenBytes) {
		return false
	}
	path, err := mediaTokenPath(id)
	if err != nil {
		return false
	}
	expected, err := readMediaToken(path)
	return err == nil && subtle.ConstantTimeCompare([]byte(expected), []byte(token)) == 1
}
