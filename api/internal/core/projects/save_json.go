package projects

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

const maxRetainedSaveBody = 64 << 10

// borrowedJSON must not outlive the input to json.Unmarshal (or Fiber's request).
type borrowedJSON []byte

func (value *borrowedJSON) UnmarshalJSON(data []byte) error {
	*value = data
	return nil
}

func validEditorState(state json.RawMessage) bool {
	var header struct {
		SchemaVersion int          `json:"schemaVersion"`
		Timeline      borrowedJSON `json:"timeline"`
	}
	return len(state) <= MaxStateBytes && json.Unmarshal(state, &header) == nil && header.SchemaVersion == 1 && len(header.Timeline) != 0
}

func writeProjectJSON(writer io.Writer, project Project) error {
	state := project.State
	if len(state) == 0 {
		state = json.RawMessage("null")
	}
	if !json.Valid(state) {
		return fmt.Errorf("encode project state: %w", ErrInvalid)
	}
	// Keep the small summary first for bounded reads, then copy validated JSON verbatim.
	header, err := json.Marshal(project.Summary)
	if err != nil {
		return fmt.Errorf("encode project summary: %w", err)
	}
	tail, err := json.Marshal(struct {
		Presentation        *Presentation `json:"presentation,omitempty"`
		PresentationWarning string        `json:"presentationWarning,omitempty"`
	}{project.Presentation, project.PresentationWarning})
	if err != nil {
		return fmt.Errorf("encode project presentation: %w", err)
	}
	header = append(header[:len(header)-1], `,"state":`...)
	if len(tail) > 2 {
		tail[0] = ','
	} else {
		tail = tail[1:]
	}
	for _, part := range [][]byte{header, state, tail} {
		if _, err := io.Copy(writer, bytes.NewReader(part)); err != nil {
			return fmt.Errorf("write project JSON: %w", err)
		}
	}
	return nil
}
