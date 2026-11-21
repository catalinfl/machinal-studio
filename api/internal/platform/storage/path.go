package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

var DataDir = configuredDataDir()

func configuredDataDir() string {
	if root := strings.TrimSpace(os.Getenv("DATA_DIR")); root != "" {
		return root
	}
	return "/data"
}

const (
	// maxUserIDLength caps opaque session/user tokens. 64 fits UUIDv4 text
	// with headroom for future token formats while keeping directory names
	// safely bounded.
	maxUserIDLength = 64

	// dirPerm creates data directories private to the server user. Session
	// volumes hold one user's media; world-readable (0755) would expose them
	// to other local users/containers.
	dirPerm = 0700
)

func EnsureDataDir() error {
	if err := os.MkdirAll(DataDir, dirPerm); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	return nil
}

// SafeJoin resolves name inside DataDir only. It rejects empty names, path
// separators, control characters, hidden files, and any joined result that
// escapes the data directory.
func SafeJoin(name string) (string, error) {
	return SafeJoinIn(DataDir, name)
}

// ValidUserID reports whether id is usable as a "/data/{user}" directory
// name. It accepts UUIDs and similar opaque tokens: 1-64 chars of letters,
// digits, "-" and "_". Dots and separators are rejected so the id can never
// escape the data directory. An empty id means "legacy shared root".
func ValidUserID(id string) bool {
	if id == "" {
		return false
	}
	if len(id) > maxUserIDLength {
		return false
	}
	for _, char := range id {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_' {
			continue
		}
		return false
	}
	return true
}

// UserDir resolves the per-user volume directory "/data/{user}".
func UserDir(user string) (string, error) {
	if !ValidUserID(user) {
		return "", fmt.Errorf("invalid user")
	}
	return filepath.Join(DataDir, user), nil
}

// EnsureUserDir creates the per-user volume directory.
func EnsureUserDir(user string) (string, error) {
	dir, err := UserDir(user)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, dirPerm); err != nil {
		return "", fmt.Errorf("create user dir: %w", err)
	}
	return dir, nil
}

// SafeJoinUser resolves name inside "/data/{user}" only, applying the same
// traversal checks as SafeJoin.
func SafeJoinUser(user, name string) (string, error) {
	root, err := UserDir(user)
	if err != nil {
		return "", err
	}
	return SafeJoinIn(root, name)
}

// SafeJoinIn resolves name inside an explicit server-chosen root directory
// (DataDir or a "/data/{user}" dir). Only the name is untrusted, so only the
// name gets traversal checks; the root itself is never derived from input.
func SafeJoinIn(root, name string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("invalid name")
	}
	if strings.ContainsAny(name, "/\\") {
		return "", fmt.Errorf("invalid name")
	}
	for _, char := range name {
		if unicode.IsControl(char) {
			return "", fmt.Errorf("invalid name")
		}
	}
	if strings.HasPrefix(name, ".") {
		return "", fmt.Errorf("invalid name")
	}
	clean := filepath.Clean(name)
	if clean == "." || clean == ".." {
		return "", fmt.Errorf("invalid name")
	}
	cleanRoot := filepath.Clean(root)
	joined := filepath.Join(cleanRoot, clean)
	rel, err := filepath.Rel(cleanRoot, joined)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("invalid name")
	}
	return joined, nil
}
