package projects

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"unicode/utf16"
	"unicode/utf8"
)

func canonicalStateValue(value any) any {
	switch value := value.(type) {
	case []any:
		for index, item := range value {
			value[index] = canonicalStateValue(item)
		}
		return value
	case map[string]any:
		keys := make([]string, 0, len(value))
		for key := range value {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			left, right := utf16.Encode([]rune(keys[i])), utf16.Encode([]rune(keys[j]))
			for index := 0; index < len(left) && index < len(right); index++ {
				if left[index] != right[index] {
					return left[index] < right[index]
				}
			}
			return len(left) < len(right)
		})
		entries := make([]any, 0, len(keys))
		for _, key := range keys {
			entries = append(entries, []any{key, canonicalStateValue(value[key])})
		}
		return []any{"object", entries}
	default:
		return value
	}
}

// v2 ignores JSON field order and matches the browser across escaped Unicode and HTML.
func editorStateFingerprint(data json.RawMessage, canonical bool) (string, error) {
	var state struct {
		SchemaVersion int             `json:"schemaVersion"`
		Timeline      json.RawMessage `json:"timeline"`
		Media         json.RawMessage `json:"media"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return "", fmt.Errorf("decode project fingerprint: %w", err)
	}
	input := fmt.Appendf(nil, `{"schemaVersion":%d,"timeline":`, state.SchemaVersion)
	input = append(input, state.Timeline...)
	input = append(input, `,"media":`...)
	input = append(input, state.Media...)
	input = append(input, '}')
	prefix := ""
	if canonical {
		var value any
		if err := json.Unmarshal(input, &value); err != nil {
			return "", fmt.Errorf("decode canonical project: %w", err)
		}
		var err error
		input, err = json.Marshal(canonicalStateValue(value))
		if err != nil {
			return "", fmt.Errorf("encode canonical project: %w", err)
		}
		prefix = "v2:"
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, input); err != nil {
		return "", fmt.Errorf("compact project fingerprint: %w", err)
	}
	left, right := uint32(0x811c9dc5), uint32(0x9e3779b9)
	hashUnit := func(unit uint32) {
		left = (left ^ unit) * 0x01000193
		right = (right ^ unit) * 0x01000193
	}
	// Match JavaScript's UTF-16 hashing without whole-project string/rune/UTF-16 copies.
	for remaining := compact.Bytes(); len(remaining) > 0; {
		char, size := utf8.DecodeRune(remaining)
		remaining = remaining[size:]
		if char > 0xffff {
			high, low := utf16.EncodeRune(char)
			hashUnit(uint32(high))
			hashUnit(uint32(low))
		} else {
			hashUnit(uint32(char))
		}
	}
	return fmt.Sprintf("%s%08x%08x", prefix, left, right), nil
}
