package projects

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

// Store.write puts Summary before State, so listing never needs the editor payload.
const maxSummaryBytes = 4 << 10

func (s *Store) GetSummary(owner, id string) (Summary, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()
	summary, err := s.readSummary(owner, id)
	if errors.Is(err, os.ErrNotExist) {
		return Summary{}, ErrNotFound
	}
	return summary, err
}

func (s *Store) readSummary(owner, id string) (Summary, error) {
	path, err := s.path(owner, id)
	if err != nil {
		return Summary{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		return Summary{}, fmt.Errorf("open project summary: %w", err)
	}
	defer file.Close()
	return decodeSummary(file, id)
}

func decodeSummary(reader io.Reader, id string) (Summary, error) {
	decoder := json.NewDecoder(io.LimitReader(reader, maxSummaryBytes))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return Summary{}, fmt.Errorf("decode project summary: %w", ErrInvalid)
	}
	fields := make(map[string]json.RawMessage)
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return Summary{}, fmt.Errorf("read project summary field: %w", err)
		}
		if key == "state" {
			break
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return Summary{}, fmt.Errorf("decode project summary field: %w", err)
		}
		fields[key.(string)] = value
	}
	data, err := json.Marshal(fields)
	if err != nil {
		return Summary{}, fmt.Errorf("encode project summary: %w", err)
	}
	var summary Summary
	if err := json.Unmarshal(data, &summary); err != nil {
		return Summary{}, fmt.Errorf("decode project summary: %w", err)
	}
	if summary.ID != id || summary.SessionID == "" || summary.Version < 1 {
		return Summary{}, ErrInvalid
	}
	return summary, nil
}
