package preferences

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

const maxDirectoryBytes = 2048

type DownloadPreference struct {
	Directory string `json:"directory"`
}

type Downloads struct {
	root func() string
	mu   sync.Mutex
}

func NewDownloads() *Downloads {
	return &Downloads{root: func() string { return filepath.Join(storage.DataDir, ".download-preferences") }}
}

func (d *Downloads) path(c *fiber.Ctx) (string, error) {
	return preferencePath(c, d.root())
}

func preferencePath(c *fiber.Ctx, root string) (string, error) {
	owner := auth.UserID(c)
	key, _ := c.Locals("machinalAPIKey").(string)
	if !storage.ValidUserID(owner) || !storage.ValidUserID(key) {
		return "", fiber.ErrUnauthorized
	}
	return filepath.Join(root, owner, key+".json"), nil
}

func (d *Downloads) Get(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	path, err := d.path(c)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return c.JSON(DownloadPreference{})
	}
	var preference DownloadPreference
	if err != nil || json.Unmarshal(data, &preference) != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Could not read download preferences.")
	}
	return c.JSON(preference)
}

func (d *Downloads) Save(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	path, err := d.path(c)
	if err != nil {
		return err
	}
	var preference DownloadPreference
	if len(c.Body()) > maxDirectoryBytes+128 || json.Unmarshal(c.Body(), &preference) != nil ||
		len(preference.Directory) > maxDirectoryBytes || !utf8.ValidString(preference.Directory) || strings.IndexFunc(preference.Directory, unicode.IsControl) >= 0 {
		return fiber.NewError(fiber.StatusBadRequest, fmt.Sprintf("Provide a local download directory of at most %d bytes, without control characters. Empty clears the preference.", maxDirectoryBytes))
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := writePreference(path, preference); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Could not save download preferences.")
	}
	return c.JSON(preference)
}

func writePreference(path string, preference any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("create preference directory: %w", err)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".download-*")
	if err != nil {
		return fmt.Errorf("create preference file: %w", err)
	}
	defer os.Remove(file.Name())
	if err := json.NewEncoder(file).Encode(preference); err != nil {
		file.Close()
		return fmt.Errorf("encode download preference: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close preference file: %w", err)
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return fmt.Errorf("replace download preference: %w", err)
	}
	return nil
}
