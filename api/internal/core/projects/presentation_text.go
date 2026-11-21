package projects

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"

	"ffmpeg-go-server/internal/platform/filecache"
)

const compactPresentationHeader = `{"storageVersion":1,`

func projectIDForSession(owner, session string) string {
	if session == "u_"+owner {
		return "default"
	}
	return session
}

func (s *PresentationStore) textAssets() *Store {
	root := s.TextAssetsRoot
	if root == "" {
		root = filepath.Join(s.Root, ".project-assets")
	}
	return &Store{Root: root}
}

func (s *Store) retainTextAsset(owner, project string, data []byte) (textAssetReference, error) {
	var header struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(data, &header); err != nil {
		return textAssetReference{}, fmt.Errorf("read retained caption cache: %w", err)
	}
	reference := textAssetReference{ID: fmt.Sprintf("%x", sha256.Sum256(data)), Key: header.Key}
	if err := s.saveTextAsset(owner, project, reference, data); err != nil {
		return textAssetReference{}, err
	}
	return reference, nil
}

func (s *PresentationStore) compactTextAssets(owner, session string, data []byte) ([]byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, fmt.Errorf("decode retained presentation: %w", err)
	}
	if len(fields) == 0 {
		return data, nil
	}
	for _, name := range []string{"prepared", "lastRender"} {
		if len(fields[name]) == 0 || bytes.Equal(fields[name], []byte("null")) {
			continue
		}
		compacted, err := s.compactSnapshot(owner, session, fields[name])
		if err != nil {
			return nil, fmt.Errorf("retain %s caption cache: %w", name, err)
		}
		fields[name] = compacted
	}
	delete(fields, "storageVersion")
	compacted, err := json.Marshal(fields)
	if err != nil {
		return nil, fmt.Errorf("encode compact presentation: %w", err)
	}
	return append([]byte(compactPresentationHeader), compacted[1:]...), nil
}

func (s *PresentationStore) compactSnapshot(owner, session string, data []byte) ([]byte, error) {
	var snapshot map[string]json.RawMessage
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return nil, err
	}
	var compiled map[string]json.RawMessage
	if len(snapshot["composition"]) == 0 || bytes.Equal(snapshot["composition"], []byte("null")) {
		return data, nil
	}
	if err := json.Unmarshal(snapshot["composition"], &compiled); err != nil {
		return nil, err
	}
	text := compiled["preparedText"]
	if len(text) == 0 || bytes.Equal(text, []byte("null")) {
		return data, nil
	}
	reference, err := s.textAssets().retainTextAsset(owner, projectIDForSession(owner, session), text)
	if err != nil {
		return nil, err
	}
	delete(compiled, "preparedText")
	snapshot["composition"], err = json.Marshal(compiled)
	if err != nil {
		return nil, err
	}
	snapshot["preparedTextRef"], err = json.Marshal(reference)
	if err != nil {
		return nil, err
	}
	return json.Marshal(snapshot)
}

// Only legacy files are decoded; ordinary opens keep the bounded snapshot stream.
func (s *PresentationStore) compactLegacyFile(owner, session, path string) error {
	file, err := openSnapshotFile(path)
	if err != nil {
		return err
	}
	defer file.Close()
	defer filecache.Release(file)
	var header [len(compactPresentationHeader)]byte
	count, err := file.ReadAt(header[:], 0)
	if err != nil && err != io.EOF {
		return fmt.Errorf("read presentation storage version: %w", err)
	}
	if bytes.Equal(header[:count], []byte(compactPresentationHeader)) {
		return nil
	}
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if info.Size() > 2*MaxStateBytes {
		return ErrInvalid
	}
	data, err := io.ReadAll(io.NewSectionReader(file, 0, info.Size()))
	if err != nil {
		return fmt.Errorf("read legacy presentation: %w", err)
	}
	compacted, err := s.compactTextAssets(owner, session, data)
	if err != nil {
		return err
	}
	if bytes.Equal(data, compacted) {
		return nil
	}
	filecache.Release(file)
	if err := file.Close(); err != nil {
		return err
	}
	return s.writeData(owner, session, compacted)
}

func (s *Store) referencePreparedText(owner, project string, prepared PreparedComposition) (PreparedComposition, error) {
	if prepared.Composition == nil || prepared.Composition.PreparedText == nil {
		return prepared, nil
	}
	data, err := json.Marshal(prepared.Composition.PreparedText)
	if err != nil {
		return prepared, fmt.Errorf("encode retained caption cache: %w", err)
	}
	reference, err := s.retainTextAsset(owner, project, data)
	if err != nil {
		return prepared, err
	}
	compiled := *prepared.Composition
	compiled.PreparedText = nil
	prepared.Composition, prepared.PreparedTextRef = &compiled, &reference
	return prepared, nil
}
