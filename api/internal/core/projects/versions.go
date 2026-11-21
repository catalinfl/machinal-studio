package projects

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ffmpeg-go-server/internal/platform/auth"
	"github.com/gofiber/fiber/v2"
)

const maxProjectVersions = 20
const maxVersionStorageBytes int64 = 512 << 20

type Version struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	ProjectVersion int       `json:"projectVersion"`
	CreatedAt      time.Time `json:"createdAt"`
}

func (s *Store) versionDir(owner, project string) (string, error) {
	if _, err := s.path(owner, project); err != nil {
		return "", err
	}
	return filepath.Join(s.Root, owner, ".versions", project), nil
}

func (s *Store) ListVersions(owner, project string) ([]Version, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	if _, err := s.readSummary(owner, project); err != nil {
		return nil, err
	}
	return s.listVersions(owner, project)
}

func (s *Store) listVersions(owner, project string) ([]Version, error) {
	dir, err := s.versionDir(owner, project)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("list project versions: %w", err)
	}
	versions := []Version{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".meta.json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("read version metadata: %w", err)
		}
		var version Version
		if json.Unmarshal(data, &version) != nil || !ValidID(version.ID) {
			return nil, ErrInvalid
		}
		versions = append(versions, version)
	}
	sort.Slice(versions, func(i, j int) bool { return versions[i].CreatedAt.After(versions[j].CreatedAt) })
	return versions, nil
}

func (s *Store) SaveVersion(owner, id, name string, expected int) (Version, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	name, err := validateName(name)
	if err != nil {
		return Version{}, err
	}
	project, err := s.read(owner, id)
	if err != nil {
		return Version{}, err
	}
	if project.Version != expected {
		return Version{}, ErrConflict
	}
	versions, err := s.listVersions(owner, id)
	if err != nil {
		return Version{}, err
	}
	if len(versions) >= maxProjectVersions {
		return Version{}, fiber.NewError(422, "Version limit reached (20). Remove an older version first.")
	}
	dir, err := s.versionDir(owner, id)
	if err != nil {
		return Version{}, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Version{}, err
	}
	data, err := json.Marshal(project)
	if err != nil {
		return Version{}, fmt.Errorf("encode project version: %w", err)
	}
	total := int64(len(data))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return Version{}, err
		}
		total += info.Size()
	}
	if total > maxVersionStorageBytes {
		return Version{}, fiber.NewError(422, "Saved versions exceed 512 MiB. Remove an older version first.")
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return Version{}, fmt.Errorf("create version identity: %w", err)
	}
	version := Version{ID: hex.EncodeToString(random[:]), Name: name, ProjectVersion: project.Version, CreatedAt: s.Now().UTC()}
	if err := writeTextAsset(filepath.Join(dir, version.ID+".json"), data); err != nil {
		return Version{}, err
	}
	metadata, err := json.Marshal(version)
	if err != nil {
		return Version{}, err
	}
	if err := writeTextAsset(filepath.Join(dir, version.ID+".meta.json"), metadata); err != nil {
		return Version{}, err
	}
	return version, nil
}

func (s *Store) VersionState(owner, project, id string) (Project, error) {
	if !ValidID(id) {
		return Project{}, ErrInvalid
	}
	if _, err := s.GetSummary(owner, project); err != nil {
		return Project{}, err
	}
	dir, err := s.versionDir(owner, project)
	if err != nil {
		return Project{}, err
	}
	file, err := openSnapshotFile(filepath.Join(dir, id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return Project{}, ErrNotFound
	}
	if err != nil {
		return Project{}, err
	}
	defer file.Close()
	var saved Project
	if err := json.NewDecoder(file).Decode(&saved); err != nil {
		return Project{}, fmt.Errorf("decode saved version: %w", err)
	}
	if saved.ID != project {
		return Project{}, ErrInvalid
	}
	return saved, nil
}

func (s *Store) VersionsHandler(c *fiber.Ctx) error {
	versions, err := s.ListVersions(auth.UserID(c), c.Params("projectID"))
	if err != nil {
		return projectError(c, err)
	}
	return c.JSON(versions)
}

func (s *Store) SaveVersionHandler(c *fiber.Ctx) error {
	var input struct {
		Name    string `json:"name"`
		Version int    `json:"version"`
	}
	if len(c.Body()) > 4096 || c.BodyParser(&input) != nil {
		return projectError(c, ErrInvalid)
	}
	version, err := s.SaveVersion(auth.UserID(c), c.Params("projectID"), input.Name, input.Version)
	if err != nil {
		return projectError(c, err)
	}
	return c.Status(fiber.StatusCreated).JSON(version)
}

func (s *Store) GetVersionHandler(c *fiber.Ctx) error {
	project, err := s.VersionState(auth.UserID(c), c.Params("projectID"), c.Params("versionID"))
	if err != nil {
		return projectError(c, err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(project)
}

func (s *Store) DeleteVersionHandler(c *fiber.Ctx) error {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	owner, project, id := auth.UserID(c), c.Params("projectID"), c.Params("versionID")
	if _, err := s.readSummary(owner, project); err != nil {
		return projectError(c, err)
	}
	if !ValidID(id) {
		return projectError(c, ErrInvalid)
	}
	dir, err := s.versionDir(owner, project)
	if err != nil {
		return projectError(c, err)
	}
	for _, suffix := range []string{".meta.json", ".json"} {
		if err := os.Remove(filepath.Join(dir, id+suffix)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return projectError(c, err)
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}
