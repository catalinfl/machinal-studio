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
	"sync"
	"time"
	"unicode/utf8"
)

const (
	MaxStateBytes = 128 << 20
	maxNameLength = 120
	privateDir    = 0700
)

var (
	ErrNotFound = errors.New("project not found")
	ErrConflict = errors.New("project changed in another tab; reload it before saving")
	ErrInvalid  = errors.New("invalid project")
	// HTTP autosaves and background jobs use different Store instances.
	projectsMu sync.Mutex
)

type Summary struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	SessionID string    `json:"sessionId"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Project struct {
	Summary
	State               json.RawMessage `json:"state"`
	Presentation        *Presentation   `json:"presentation,omitempty"`
	PresentationWarning string          `json:"presentationWarning,omitempty"`
}

type Store struct {
	Root          string
	Now           func() time.Time
	Session       func(owner, id string) string
	Presentations *PresentationStore
}

func ValidID(id string) bool {
	if len(id) == 0 || len(id) > 64 {
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

func (s *Store) path(owner, id string) (string, error) {
	if !ValidID(owner) || !ValidID(id) {
		return "", ErrInvalid
	}
	return filepath.Join(s.Root, owner, id+".json"), nil
}

func (s *Store) read(owner, id string) (Project, error) {
	path, err := s.path(owner, id)
	if err != nil {
		return Project{}, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Project{}, ErrNotFound
	}
	if err != nil {
		return Project{}, fmt.Errorf("read project: %w", err)
	}
	var project Project
	if err := json.Unmarshal(data, &project); err != nil {
		return Project{}, fmt.Errorf("decode project: %w", err)
	}
	return project, nil
}

func (s *Store) Get(owner, id string) (Project, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	return s.read(owner, id)
}

func (s *Store) List(owner string) ([]Summary, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	return s.list(owner)
}

func (s *Store) list(owner string) ([]Summary, error) {
	if !ValidID(owner) {
		return nil, ErrInvalid
	}
	entries, err := os.ReadDir(filepath.Join(s.Root, owner))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	items := []Summary{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		summary, err := s.readSummary(owner, strings.TrimSuffix(entry.Name(), ".json"))
		if err != nil {
			return nil, err
		}
		items = append(items, summary)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	return items, nil
}

func validateName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxNameLength {
		return "", ErrInvalid
	}
	return name, nil
}

func (s *Store) write(owner string, project Project) error {
	path, err := s.path(owner, project.ID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), privateDir); err != nil {
		return fmt.Errorf("create project directory: %w", err)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".save-*")
	if err != nil {
		return fmt.Errorf("create project save: %w", err)
	}
	defer os.Remove(file.Name())
	if err := writeProjectJSON(file, project); err != nil {
		file.Close()
		return fmt.Errorf("write project: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return fmt.Errorf("sync project: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close project: %w", err)
	}
	if err := publishJSONFile(file.Name(), path); err != nil {
		return fmt.Errorf("publish project: %w", err)
	}
	return nil
}

func (s *Store) create(owner, id, name string) (Project, error) {
	name, err := validateName(name)
	if err != nil {
		return Project{}, err
	}
	now := s.Now().UTC()
	project := Project{Summary: Summary{ID: id, Name: name, SessionID: s.Session(owner, id), Version: 1, CreatedAt: now, UpdatedAt: now}, State: json.RawMessage("null")}
	if err := s.write(owner, project); err != nil {
		return Project{}, err
	}
	return project, nil
}

func (s *Store) EnsureInitial(owner string) ([]Summary, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	items, err := s.list(owner)
	if err != nil || len(items) > 0 {
		return items, err
	}
	project, err := s.create(owner, "default", "Untitled project")
	if err != nil {
		return nil, err
	}
	return []Summary{project.Summary}, nil
}

func (s *Store) Create(owner, name string) (Project, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return Project{}, fmt.Errorf("generate project ID: %w", err)
	}
	return s.create(owner, "p_"+hex.EncodeToString(random[:]), name)
}

func (s *Store) Update(owner, id, name string, version int, state json.RawMessage) (Project, error) {
	project, err := s.update(owner, id, name, version, state)
	if err == nil && state != nil {
		project.State = append(json.RawMessage(nil), state...)
	}
	return project, err
}

// update borrows state only through the synchronous write. HTTP saves return its summary.
func (s *Store) update(owner, id, name string, version int, state json.RawMessage) (Project, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	project, err := s.readForUpdate(owner, id, state)
	if err != nil {
		return Project{}, err
	}
	if project.Version != version {
		return Project{}, ErrConflict
	}
	project.Name, err = validateName(name)
	if err != nil {
		return Project{}, err
	}
	if state != nil {
		if !validEditorState(state) {
			return Project{}, ErrInvalid
		}
		project.State = state
	}
	project.Version++
	project.UpdatedAt = s.Now().UTC()
	if err := s.write(owner, project); err != nil {
		return Project{}, err
	}
	return project, nil
}

func (s *Store) readForUpdate(owner, id string, state json.RawMessage) (Project, error) {
	if state == nil {
		return s.read(owner, id)
	}
	// A complete replacement does not need a second copy of the old timeline.
	summary, err := s.readSummary(owner, id)
	if errors.Is(err, os.ErrNotExist) {
		return Project{}, ErrNotFound
	}
	return Project{Summary: summary}, err
}
