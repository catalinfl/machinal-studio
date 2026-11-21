package projects

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"
)

type PreparedComposition struct {
	JobID         string                   `json:"jobId,omitempty"`
	UpdatedAt     time.Time                `json:"updatedAt"`
	Filename      string                   `json:"filename,omitempty"`
	CompositionID string                   `json:"compositionId,omitempty"`
	Document      *document.Document       `json:"document,omitempty"`
	Bindings      document.Bindings        `json:"bindings,omitempty"`
	Composition   *composition.Composition `json:"composition,omitempty"`
}

type Presentation struct {
	Prepared   *PreparedComposition `json:"prepared,omitempty"`
	LastRender *PreparedComposition `json:"lastRender,omitempty"`
}

type presentationJobs interface {
	List(context.Context, string, string) ([]jobqueue.Job, error)
	Get(context.Context, string, string, string) (jobqueue.Job, error)
}

type PresentationStore struct {
	Root string
	Jobs presentationJobs
}

// Jobs and HTTP readers use separate store instances, but publish one atomic snapshot.
var presentationMu sync.Mutex

func NewPresentationStore() *PresentationStore {
	return &PresentationStore{Root: filepath.Join(storage.DataDir, ".project-presentations")}
}

func (s *PresentationStore) path(owner, session string) (string, error) {
	if !ValidID(owner) || !ValidID(session) {
		return "", ErrInvalid
	}
	return filepath.Join(s.Root, owner, session+".json"), nil
}

func (s *PresentationStore) read(owner, session string) (Presentation, error) {
	path, err := s.path(owner, session)
	if err != nil {
		return Presentation{}, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Presentation{}, nil
	}
	if err != nil {
		return Presentation{}, fmt.Errorf("read project presentation: %w", err)
	}
	var saved Presentation
	if err := json.Unmarshal(data, &saved); err != nil {
		return Presentation{}, fmt.Errorf("decode project presentation: %w", err)
	}
	return saved, nil
}

func (s *PresentationStore) loadSaved(owner, session string) (Presentation, error) {
	presentationMu.Lock()
	defer presentationMu.Unlock()
	return s.read(owner, session)
}

func (s *PresentationStore) Save(owner, session string, prepared PreparedComposition) error {
	complete := prepared.Document != nil && prepared.Composition != nil
	if !complete && prepared.Filename == "" {
		return ErrInvalid
	}
	if prepared.Filename != "" && !sessions.IsRenderOutput(prepared.Filename) {
		return ErrInvalid
	}
	presentationMu.Lock()
	defer presentationMu.Unlock()
	saved, err := s.read(owner, session)
	if err != nil {
		return err
	}
	if complete && (saved.Prepared == nil || !prepared.UpdatedAt.Before(saved.Prepared.UpdatedAt)) {
		saved.Prepared = &prepared
	}
	if prepared.Filename != "" && (saved.LastRender == nil || !prepared.UpdatedAt.Before(saved.LastRender.UpdatedAt)) {
		saved.LastRender = &prepared
	}
	return s.write(owner, session, saved)
}

func (s *PresentationStore) write(owner, session string, saved Presentation) error {
	path, err := s.path(owner, session)
	if err != nil {
		return err
	}
	data, err := json.Marshal(saved)
	if err != nil {
		return fmt.Errorf("encode project presentation: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), privateDir); err != nil {
		return fmt.Errorf("create project presentation directory: %w", err)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".presentation-*")
	if err != nil {
		return fmt.Errorf("create project presentation: %w", err)
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return fmt.Errorf("write project presentation: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return fmt.Errorf("sync project presentation: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close project presentation: %w", err)
	}
	if err := publishJSONFile(file.Name(), path); err != nil {
		return fmt.Errorf("publish project presentation: %w", err)
	}
	return nil
}

func (s *PresentationStore) Load(ctx context.Context, owner, session string) (Presentation, error) {
	presentationMu.Lock()
	saved, err := s.read(owner, session)
	presentationMu.Unlock()
	if err != nil || s.Jobs == nil || saved.Prepared != nil || saved.LastRender != nil {
		return saved, err
	}
	recovered, err := s.recover(ctx, owner, session)
	if err != nil || recovered.Prepared == nil && recovered.LastRender == nil {
		return recovered, err
	}
	presentationMu.Lock()
	defer presentationMu.Unlock()
	saved, err = s.read(owner, session)
	if err != nil {
		return recovered, err
	}
	if saved.Prepared == nil {
		saved.Prepared = recovered.Prepared
	}
	if saved.LastRender == nil {
		saved.LastRender = recovered.LastRender
	}
	if err := s.write(owner, session, saved); err != nil {
		return saved, err
	}
	return saved, nil
}

func (s *PresentationStore) recover(ctx context.Context, owner, session string) (Presentation, error) {
	jobs, err := s.Jobs.List(ctx, owner, session)
	if err != nil {
		return Presentation{}, fmt.Errorf("recover project jobs: %w", err)
	}
	sort.SliceStable(jobs, func(i, j int) bool {
		left, leftErr := time.Parse(time.RFC3339Nano, jobs[i].UpdatedAt)
		right, rightErr := time.Parse(time.RFC3339Nano, jobs[j].UpdatedAt)
		if leftErr != nil {
			return false
		}
		return rightErr != nil || left.After(right)
	})
	saved := Presentation{}
	for _, summary := range jobs {
		if summary.Status != "completed" || summary.Owner != owner || summary.Session != session {
			continue
		}
		isRender := summary.Kind == "render" || summary.Kind == "automation-render" || summary.Kind == "editor-render"
		if (!isRender || saved.LastRender != nil) && (summary.Kind != "compile-generate" || saved.Prepared != nil) {
			continue
		}
		job, err := s.Jobs.Get(ctx, owner, session, summary.ID)
		if err != nil {
			return saved, fmt.Errorf("recover project result: %w", err)
		}
		var result struct {
			PreparedComposition
			File    string          `json:"file"`
			Preview json.RawMessage `json:"preview"`
		}
		if job.Status != "completed" || job.Owner != owner || job.Session != session || json.Unmarshal(job.Result, &result) != nil || len(result.Preview) > 0 {
			continue
		}
		prepared := result.PreparedComposition
		prepared.JobID = job.ID
		prepared.UpdatedAt, err = time.Parse(time.RFC3339Nano, job.UpdatedAt)
		if err != nil {
			continue
		}
		if prepared.Filename == "" {
			prepared.Filename = result.File
		}
		if isRender && sessions.IsRenderOutput(prepared.Filename) && saved.LastRender == nil {
			saved.LastRender = &prepared
		}
		if prepared.Document != nil && prepared.Composition != nil && saved.Prepared == nil {
			saved.Prepared = &prepared
		}
		if saved.Prepared != nil && saved.LastRender != nil {
			break
		}
	}
	// Older render jobs retained only the filename. Never call an unrelated recipe its exact snapshot.
	if saved.LastRender != nil && saved.LastRender.Composition == nil && saved.Prepared != nil && saved.Prepared.Composition.ID == saved.LastRender.CompositionID {
		rendered := *saved.Prepared
		rendered.JobID, rendered.UpdatedAt, rendered.Filename = saved.LastRender.JobID, saved.LastRender.UpdatedAt, saved.LastRender.Filename
		saved.LastRender = &rendered
	}
	return saved, nil
}
