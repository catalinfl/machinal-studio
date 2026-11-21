package projects

import (
	"encoding/json"
	"fmt"
)

func (s *Store) ApplyPrepared(owner, session string, prepared PreparedComposition) (Project, error) {
	if prepared.Document == nil || prepared.Composition == nil || prepared.Composition.ID == "" {
		return Project{}, ErrInvalid
	}
	id := projectIDForSession(owner, session)
	projectsMu.Lock()
	defer projectsMu.Unlock()
	project, err := s.read(owner, id)
	if err != nil {
		return Project{}, err
	}
	if project.SessionID != session {
		return Project{}, ErrNotFound
	}
	previous, replace := canPrepareEditorState(project.State)
	if !replace || previous.PreparedCompositionID == prepared.Composition.ID {
		return project, nil
	}
	// A delayed older job must not replace an already published timeline.
	if s.Presentations != nil {
		saved, err := s.Presentations.loadSaved(owner, session)
		if err != nil {
			return Project{}, err
		}
		if saved.Prepared != nil && saved.Prepared.UpdatedAt.After(prepared.UpdatedAt) {
			return project, nil
		}
	}
	prepared, err = s.referencePreparedText(owner, id, prepared)
	if err != nil {
		return Project{}, err
	}
	state, err := preparedEditorState(prepared, previous)
	if err != nil {
		return Project{}, err
	}
	// Keep forward-compatible top-level project fields outside the generated edit.
	var fields map[string]json.RawMessage
	if len(project.State) > 0 && string(project.State) != "null" {
		if err := json.Unmarshal(project.State, &fields); err != nil {
			return Project{}, fmt.Errorf("decode previous project fields: %w", err)
		}
	}
	var generated map[string]json.RawMessage
	if err := json.Unmarshal(state, &generated); err != nil {
		return Project{}, err
	}
	for key, value := range fields {
		if _, replaced := generated[key]; !replaced {
			generated[key] = value
		}
	}
	project.State, err = json.Marshal(generated)
	if err != nil {
		return Project{}, fmt.Errorf("encode project fields: %w", err)
	}
	if len(project.State) > MaxStateBytes {
		return Project{}, fmt.Errorf("prepared project exceeds state limit: %w", ErrInvalid)
	}
	project.Version++
	project.UpdatedAt = s.Now().UTC()
	if err := s.write(owner, project); err != nil {
		return Project{}, err
	}
	return project, nil
}
