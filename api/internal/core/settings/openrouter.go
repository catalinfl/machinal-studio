package settings

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

const (
	keyEnvironment = "OPENROUTER_API_KEY"
	keyFilename    = ".openrouter-key"
	maxKeyBytes    = 512
	maxBodyBytes   = 1024
)

type KeyVerifier func(context.Context, string) error

type Service struct {
	path   string
	verify KeyVerifier
	mu     sync.Mutex
}

func New(root string, verify KeyVerifier) (*Service, error) {
	service := &Service{path: filepath.Join(root, keyFilename), verify: verify}
	key, err := os.ReadFile(service.path)
	if errors.Is(err, os.ErrNotExist) {
		return service, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read saved OpenRouter configuration: %w", err)
	}
	if err := validateKey(strings.TrimSpace(string(key))); err != nil {
		return nil, fmt.Errorf("saved OpenRouter configuration is invalid")
	}
	if err := os.Setenv(keyEnvironment, strings.TrimSpace(string(key))); err != nil {
		return nil, fmt.Errorf("activate saved OpenRouter configuration: %w", err)
	}
	return service, nil
}

func (service *Service) Status(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(fiber.Map{"configured": strings.TrimSpace(os.Getenv(keyEnvironment)) != ""})
}

func (service *Service) Save(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	if !c.Is("json") {
		return c.Status(fiber.StatusUnsupportedMediaType).SendString("Send the key as application/json.")
	}
	if len(c.Body()) > maxBodyBytes {
		return c.Status(fiber.StatusRequestEntityTooLarge).SendString("OpenRouter configuration is too large.")
	}
	var request struct {
		APIKey string `json:"apiKey"`
	}
	if err := c.BodyParser(&request); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Enter an OpenRouter API key.")
	}
	key := strings.TrimSpace(request.APIKey)
	if err := validateKey(key); err != nil {
		return err
	}
	if err := service.verify(c.UserContext(), key); err != nil {
		return err
	}
	if err := service.activate(key); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Could not save the key. Check that the API data volume is writable and try again.")
	}
	return service.Status(c)
}

func validateKey(key string) error {
	if !strings.HasPrefix(key, "sk-or-") || len(key) <= len("sk-or-") || len(key) > maxKeyBytes {
		return fiber.NewError(fiber.StatusBadRequest, "Enter a valid OpenRouter API key beginning with sk-or-.")
	}
	for _, char := range key {
		if char < '!' || char > '~' {
			return fiber.NewError(fiber.StatusBadRequest, "The API key must not contain spaces or line breaks.")
		}
	}
	return nil
}

func (service *Service) activate(key string) error {
	service.mu.Lock()
	defer service.mu.Unlock()
	if err := writeKey(service.path, key); err != nil {
		return err
	}
	return os.Setenv(keyEnvironment, key)
}

func writeKey(path, key string) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".openrouter-key-*")
	if err != nil {
		return fmt.Errorf("stage OpenRouter configuration: %w", err)
	}
	// Cleanup is best-effort; a failed rename leaves only a private hidden file.
	defer os.Remove(file.Name())
	if _, err := file.WriteString(key); err != nil {
		return fmt.Errorf("write OpenRouter configuration: %w", errors.Join(err, file.Close()))
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync OpenRouter configuration: %w", errors.Join(err, file.Close()))
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close OpenRouter configuration: %w", err)
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return fmt.Errorf("publish OpenRouter configuration: %w", err)
	}
	return nil
}
