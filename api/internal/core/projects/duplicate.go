package projects

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"

	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

const maxDuplicateBytes int64 = 10 << 30

func (s *Store) Duplicate(ctx context.Context, owner, id, name string, expected int) (Project, error) {
	original, err := s.Get(owner, id)
	if err != nil {
		return Project{}, err
	}
	if original.Version != expected {
		return Project{}, ErrConflict
	}
	name, err = validateName(name)
	if err != nil {
		return Project{}, err
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return Project{}, fmt.Errorf("create duplicate identity: %w", err)
	}
	nextID := "p_" + hex.EncodeToString(random[:])
	now := s.Now().UTC()
	copy := Project{Summary: Summary{ID: nextID, Name: name, SessionID: s.Session(owner, nextID), Version: 1, CreatedAt: now, UpdatedAt: now}, State: original.State}
	published := false
	defer func() {
		if !published && copy.SessionID == nextID {
			for _, path := range []string{filepath.Join(storage.DataDir, nextID), filepath.Join(s.Root, owner, ".text-assets", nextID)} {
				if err := os.RemoveAll(path); err != nil {
					log.Printf("remove unpublished duplicate staging: %v", err)
				}
			}
		}
	}()
	if err := s.copyProjectSources(ctx, owner, original, copy); err != nil {
		return Project{}, err
	}
	if err := s.activate(owner, copy.Summary); err != nil {
		return Project{}, err
	}
	projectsMu.Lock()
	defer projectsMu.Unlock()
	latest, err := s.readSummary(owner, id)
	if err != nil {
		return Project{}, err
	}
	if latest.Version != expected {
		return Project{}, ErrConflict
	}
	if err := s.write(owner, copy); err != nil {
		return Project{}, err
	}
	published = true
	return copy, nil
}

func (s *Store) copyProjectSources(ctx context.Context, owner string, source, target Project) error {
	var state struct {
		Media []struct {
			Name       string `json:"name"`
			SourceMode string `json:"sourceMode"`
		} `json:"media"`
		Timeline struct {
			Session *struct {
				Reference   *textAssetReference `json:"preparedTextRef"`
				Composition struct {
					Reference *textAssetReference `json:"preparedTextRef"`
				} `json:"composition"`
			} `json:"documentSession"`
		} `json:"timeline"`
	}
	if len(source.State) == 0 || string(source.State) == "null" {
		return nil
	}
	if json.Unmarshal(source.State, &state) != nil {
		return ErrInvalid
	}
	from, err := sessions.TouchOwned(source.SessionID, owner)
	if err != nil {
		return err
	}
	to, err := storage.EnsureUserDir(target.SessionID)
	if err != nil {
		return err
	}
	releaseSource, releaseTarget := sessions.UseWorkspace(source.SessionID), sessions.UseWorkspace(target.SessionID)
	defer releaseSource()
	defer releaseTarget()
	remaining := maxDuplicateBytes
	if limit := sessions.MaxSessionBytes(); limit > 0 && limit < remaining {
		remaining = limit
	}
	seen := map[string]bool{}
	for _, media := range state.Media {
		if media.SourceMode == "wasm" || seen[media.Name] {
			continue
		}
		seen[media.Name] = true
		if _, err := storage.SafeJoinIn(from, media.Name); err != nil {
			return ErrInvalid
		}
		path, err := objectstore.EnsureSessionFile(ctx, sessions.S3Prefix(source.SessionID), from, media.Name)
		if err != nil {
			return fmt.Errorf("copy project source %q: %w", media.Name, err)
		}
		destination, err := storage.SafeJoinIn(to, media.Name)
		if err != nil {
			return ErrInvalid
		}
		written, err := copyProjectFile(ctx, path, destination, remaining)
		if err != nil {
			return fmt.Errorf("copy project source %q: %w", media.Name, err)
		}
		remaining -= written
	}
	if session := state.Timeline.Session; session != nil {
		for _, reference := range []*textAssetReference{session.Reference, session.Composition.Reference} {
			if reference == nil {
				continue
			}
			from, err := s.textAssetPath(owner, source.ID, *reference)
			if err != nil {
				return err
			}
			to, err := s.textAssetPath(owner, target.ID, *reference)
			if err != nil {
				return err
			}
			if _, err := copyProjectFile(ctx, from, to, MaxStateBytes); err != nil {
				return err
			}
		}
	}
	return nil
}

func copyProjectFile(ctx context.Context, source, target string, limit int64) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	input, err := openSnapshotFile(source)
	if err != nil {
		return 0, err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return 0, err
	}
	if info.Size() > limit {
		return 0, fiber.NewError(413, "Not enough project storage to duplicate these originals.")
	}
	if err := os.MkdirAll(filepath.Dir(target), privateDir); err != nil {
		return 0, err
	}
	output, err := os.CreateTemp(filepath.Dir(target), ".duplicate-*")
	if err != nil {
		return 0, err
	}
	defer os.Remove(output.Name())
	defer output.Close()
	buffer := make([]byte, 128<<10)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		n, readErr := input.Read(buffer)
		if total+int64(n) > limit {
			return 0, ErrInvalid
		}
		if n > 0 {
			written, err := output.Write(buffer[:n])
			total += int64(written)
			if err != nil {
				return 0, err
			}
			if written != n {
				return 0, io.ErrShortWrite
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return 0, readErr
		}
	}
	if err := output.Sync(); err != nil {
		return 0, err
	}
	if err := output.Close(); err != nil {
		return 0, err
	}
	if err := publishJSONFile(output.Name(), target); err != nil {
		return 0, err
	}
	return total, nil
}

func (s *Store) DuplicateHandler(c *fiber.Ctx) error {
	var input struct {
		Name    string `json:"name"`
		Version int    `json:"version"`
	}
	if len(c.Body()) > 4096 || c.BodyParser(&input) != nil {
		return projectError(c, ErrInvalid)
	}
	project, err := s.Duplicate(c.UserContext(), auth.UserID(c), c.Params("projectID"), input.Name, input.Version)
	if err != nil {
		return projectError(c, err)
	}
	return sendProject(c, project, fiber.StatusCreated)
}
