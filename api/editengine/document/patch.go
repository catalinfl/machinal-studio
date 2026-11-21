package document

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type Patch struct {
	Path  string          `json:"path"`
	Value json.RawMessage `json:"value"`
}

func ApplyPatches(doc Document, expectedRevision string, patches []Patch) (Document, error) {
	if doc.Revision != expectedRevision {
		return doc, fmt.Errorf("document revision changed; recompile before editing")
	}
	if len(patches) == 0 || len(patches) > 100 {
		return doc, fmt.Errorf("provide 1–100 document changes")
	}
	encoded, err := json.Marshal(doc)
	if err != nil {
		return doc, fmt.Errorf("encode document: %w", err)
	}
	var value map[string]any
	if err := json.Unmarshal(encoded, &value); err != nil {
		return doc, err
	}
	for _, patch := range patches {
		normalized, err := NormalizePatchPath(patch.Path)
		if err != nil {
			return doc, fmt.Errorf("%s: %w", patch.Path, err)
		}
		parts := strings.Split(normalized, ".")
		if parts[0] == "version" || parts[0] == "revision" || parts[0] == "catalogVersion" || parts[0] == "compilerVersion" {
			return doc, fmt.Errorf("%s: version fields cannot be patched", patch.Path)
		}
		if err := patchValue(value, parts, patch.Value); err != nil {
			return doc, fmt.Errorf("%s: %w", patch.Path, err)
		}
	}
	delete(value, "revision")
	encoded, err = json.Marshal(value)
	if err != nil {
		return doc, err
	}
	parsed, err := Parse(encoded)
	if err != nil {
		// Keep the positioned diagnostic (e.g. "tracks[0].between: unknown field")
		// but tell the model which patch caused it and what the valid shapes are.
		if diagnostic, ok := err.(Diagnostic); ok {
			return doc, fmt.Errorf("patch failed at %s: %w (valid track fields: id, name, type, muted, hidden, locked, clips; valid clip fields: id, assetId, start, inPoint, outPoint, playbackRate, volume, opacity, fadeIn, fadeOut, look, motion, transform, transformKeyframes; transitions are a top-level array, not a clip field; time is seconds or \"500ms\")", diagnostic.Path, diagnostic)
		}
		return doc, err
	}
	return parsed.Document, nil
}

// NormalizePatchPath accepts the two notations models spontaneously produce
// ("document.mode", "tracks[0].clips") and rewrites them to the canonical
// dot form relative to the document root ("mode", "tracks.0.clips").
// Canonical paths never include a "document." prefix and never use brackets.
func NormalizePatchPath(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", fmt.Errorf("empty patch path (use dot paths relative to the document root, e.g. \"sequence.between.duration\" or \"tracks.0.clips\")")
	}
	// "tracks[0].clips" -> "tracks.0.clips", "a[0][1]" -> "a.0.1".
	var builder strings.Builder
	for _, r := range trimmed {
		switch r {
		case '[':
			builder.WriteByte('.')
		case ']':
			// drop, the '.' before the index already separates segments
		default:
			builder.WriteRune(r)
		}
	}
	normalized := builder.String()
	parts := strings.Split(normalized, ".")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			return "", fmt.Errorf("empty patch path segment in %q (use dot paths like \"tracks.0.clips\", no brackets, no \"document.\" prefix)", path)
		}
		clean = append(clean, part)
	}
	// Strip a leading "document" envelope: the patch root is already the document.
	if len(clean) > 1 && strings.EqualFold(clean[0], "document") {
		clean = clean[1:]
	} else if len(clean) == 1 && strings.EqualFold(clean[0], "document") {
		return "", fmt.Errorf("path %q addresses the whole document; patch a field inside it (e.g. \"mode\", \"sequence\", \"tracks.0.clips\")", path)
	}
	return strings.Join(clean, "."), nil
}

func patchValue(value any, parts []string, encoded json.RawMessage) error {
	if len(parts) == 0 || parts[0] == "" {
		return fmt.Errorf("empty patch path")
	}
	var replacement any
	if err := json.Unmarshal(encoded, &replacement); err != nil {
		return fmt.Errorf("invalid patch value: %w", err)
	}
	switch current := value.(type) {
	case map[string]any:
		if len(parts) == 1 {
			current[parts[0]] = replacement
			return nil
		}
		child, ok := current[parts[0]]
		if !ok {
			return fmt.Errorf("path does not exist (paths are relative to the document root, e.g. \"sequence.between.duration\" or \"tracks.0.clips\"; do not prefix with \"document.\")")
		}
		return patchValue(child, parts[1:], encoded)
	case []any:
		index, err := strconv.Atoi(parts[0])
		if err != nil || index < 0 || index >= len(current) {
			return fmt.Errorf("array index %q is out of range (use zero-based dot indices like \"tracks.0\", not brackets like \"tracks[0]\"; replace the whole array to append/remove items)", parts[0])
		}
		if len(parts) == 1 {
			current[index] = replacement
			return nil
		}
		return patchValue(current[index], parts[1:], encoded)
	default:
		return fmt.Errorf("path does not address an object")
	}
}
