package projects

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	"ffmpeg-go-server/internal/platform/sessions"
)

type storedJSON struct {
	file *os.File
	size int64
}

// These files are atomically published by the store's JSON encoder.
func openStoredJSON(path string) (*storedJSON, error) {
	file, err := openSnapshotFile(path)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err == nil && (!info.Mode().IsRegular() || info.Size() < 2) {
		err = ErrInvalid
	}
	if err == nil {
		var ends [2]byte
		_, err = file.ReadAt(ends[:1], 0)
		if err == nil {
			_, err = file.ReadAt(ends[1:], info.Size()-1)
		}
		if err == nil && (ends[0] != '{' || ends[1] != '}') {
			err = ErrInvalid
		}
	}
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("open stored JSON: %w", err)
	}
	return &storedJSON{file: file, size: info.Size()}, nil
}

func (s *Store) openSnapshot(owner, id string) (*storedJSON, Summary, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	path, err := s.path(owner, id)
	if err != nil {
		return nil, Summary{}, err
	}
	snapshot, err := openStoredJSON(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, Summary{}, ErrNotFound
	}
	if err != nil {
		return nil, Summary{}, err
	}
	summary, err := decodeSummary(io.NewSectionReader(snapshot.file, 0, snapshot.size), id)
	if err != nil {
		snapshot.file.Close()
		return nil, Summary{}, err
	}
	return snapshot, summary, nil
}

func (s *PresentationStore) openSnapshot(owner, session string) (*storedJSON, error) {
	presentationMu.Lock()
	defer presentationMu.Unlock()
	path, err := s.path(owner, session)
	if err != nil {
		return nil, err
	}
	return openStoredJSON(path)
}

func (s *PresentationStore) openForRead(ctx context.Context, owner, session string) (*storedJSON, error) {
	snapshot, err := s.openSnapshot(owner, session)
	if !errors.Is(err, os.ErrNotExist) && !(err == nil && snapshot.size == 2 && s.Jobs != nil) {
		return snapshot, err
	}
	if snapshot != nil {
		snapshot.file.Close()
	}
	// History recovery is only for legacy projects without a retained presentation.
	if _, err := s.Load(ctx, owner, session); err != nil {
		return nil, err
	}
	snapshot, err = s.openSnapshot(owner, session)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return snapshot, err
}

type projectStream struct {
	io.Reader
	size  int64
	files []*os.File
}

func (s *projectStream) Close() error {
	var err error
	for _, file := range s.files {
		err = errors.Join(err, file.Close())
	}
	s.files = nil
	return err
}

func (s *Store) openResponse(ctx context.Context, owner, id string) (*projectStream, error) {
	snapshot, summary, err := s.openSnapshot(owner, id)
	if err != nil {
		return nil, err
	}
	if err := s.activate(owner, summary); err != nil {
		snapshot.file.Close()
		return nil, err
	}
	token := ""
	if sessions.IsLegacySession(summary.SessionID) {
		token, err = sessions.MediaToken(summary.SessionID)
		if err != nil {
			snapshot.file.Close()
			return nil, err
		}
	}
	var presentation *storedJSON
	warning := ""
	if s.Presentations != nil {
		presentation, err = s.Presentations.openForRead(ctx, owner, summary.SessionID)
		if err != nil {
			log.Printf("load project presentation %s: %v", id, err)
			warning = "The prepared composition could not be loaded. Your saved timeline is safe; reload the project to retry."
		}
	}
	return newProjectStream(snapshot, presentation, token, warning), nil
}

func newProjectStream(snapshot, presentation *storedJSON, token, warning string) *projectStream {
	// String-only metadata cannot produce a JSON encoding error.
	metadata, _ := json.Marshal(struct {
		MediaToken          string `json:"mediaToken,omitempty"`
		PresentationWarning string `json:"presentationWarning,omitempty"`
	}{token, warning})
	tail := metadata[1:]
	if len(metadata) > 2 {
		tail = append([]byte(","), tail...)
	}
	const junction = `,"presentation":`
	stream := &projectStream{size: snapshot.size - 1 + int64(len(junction)+len(tail)), files: []*os.File{snapshot.file}}
	readers := []io.Reader{io.NewSectionReader(snapshot.file, 0, snapshot.size-1), strings.NewReader(junction)}
	if presentation == nil {
		readers = append(readers, strings.NewReader("{}"))
		stream.size += 2
	} else {
		readers = append(readers, io.NewSectionReader(presentation.file, 0, presentation.size))
		stream.files = append(stream.files, presentation.file)
		stream.size += presentation.size
	}
	readers = append(readers, bytes.NewReader(tail))
	stream.Reader = io.MultiReader(readers...)
	return stream
}
