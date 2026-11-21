package sessions

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ffmpeg-go-server/internal/platform/storage"
)

func projectOwnerPath(id string) string {
	return filepath.Join(storage.DataDir, ".project-owners", id)
}

func BindProject(id, owner string) error {
	if !Valid(id) || !Valid(owner) {
		return fmt.Errorf("invalid project owner")
	}
	if err := os.MkdirAll(filepath.Dir(projectOwnerPath(id)), 0700); err != nil {
		return fmt.Errorf("create owner directory: %w", err)
	}
	// Bind once: an existing project can never be reassigned to another account.
	file, err := os.OpenFile(projectOwnerPath(id), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if os.IsExist(err) {
		if existing, ok := persistentProjectOwner(id); ok && existing == owner {
			return nil
		}
		return fmt.Errorf("project owner mismatch")
	}
	if err != nil {
		return fmt.Errorf("create project owner: %w", err)
	}
	if _, err := file.WriteString(owner); err != nil {
		file.Close()
		return fmt.Errorf("write project owner: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close project owner: %w", err)
	}
	return nil
}

func persistentProjectOwner(id string) (string, bool) {
	if !Valid(id) {
		return "", false
	}
	data, err := os.ReadFile(projectOwnerPath(id))
	owner := strings.TrimSpace(string(data))
	return owner, err == nil && Valid(owner)
}

func isPersistentProject(id string) bool {
	_, ok := persistentProjectOwner(id)
	return ok
}
