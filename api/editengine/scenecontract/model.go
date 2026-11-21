package scenecontract

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

const MaxModelBytes = 4 << 20
const maxModelJSONBytes = 256 << 10

func ValidateModelContainer(data []byte) error {
	if len(data) < 28 || len(data) > MaxModelBytes {
		return fmt.Errorf("GLB must contain between 28 bytes and %d MiB", MaxModelBytes>>20)
	}
	read := func(offset int) uint32 { return binary.LittleEndian.Uint32(data[offset : offset+4]) }
	if read(0) != 0x46546c67 || read(4) != 2 || uint64(read(8)) != uint64(len(data)) {
		return fmt.Errorf("use a valid GLB version 2 container")
	}
	jsonSize := int(read(12))
	binaryHeader := 20 + jsonSize
	if jsonSize < 1 || jsonSize > maxModelJSONBytes || jsonSize%4 != 0 || read(16) != 0x4e4f534a || binaryHeader+8 > len(data) {
		return fmt.Errorf("invalid GLB JSON chunk")
	}
	binarySize := int(read(binaryHeader))
	if binarySize%4 != 0 || read(binaryHeader+4) != 0x004e4942 || binaryHeader+8+binarySize != len(data) {
		return fmt.Errorf("GLB requires exactly one embedded binary chunk")
	}
	if !utf8.Valid(data[20:binaryHeader]) {
		return fmt.Errorf("GLB metadata must be UTF-8")
	}
	var document map[string]any
	if err := json.Unmarshal(data[20:binaryHeader], &document); err != nil {
		return fmt.Errorf("decode GLB metadata: %w", err)
	}
	asset, ok := document["asset"].(map[string]any)
	if !ok || asset["version"] != "2.0" {
		return fmt.Errorf("unsupported GLB asset version")
	}
	return validateModelTree(document, 0)
}

func validateModelTree(value any, depth int) error {
	if depth > 32 {
		return fmt.Errorf("GLB structure is too deeply nested")
	}
	switch node := value.(type) {
	case map[string]any:
		for key, child := range node {
			if key == "__proto__" || key == "prototype" || key == "constructor" {
				return fmt.Errorf("unsupported GLB metadata key")
			}
			if key == "uri" {
				return fmt.Errorf("GLB must embed all resources; URI references are unsupported")
			}
			switch key {
			case "extensions", "extensionsUsed", "extensionsRequired", "animations", "skins", "targets", "sparse":
				if child != nil && !emptyModelFeature(child) {
					return fmt.Errorf("unsupported GLB feature: %s", key)
				}
			}
			if err := validateModelTree(child, depth+1); err != nil {
				return err
			}
		}
	case []any:
		if len(node) > 512 {
			return fmt.Errorf("GLB metadata array exceeds limits")
		}
		for _, child := range node {
			if err := validateModelTree(child, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

func emptyModelFeature(value any) bool {
	switch value := value.(type) {
	case []any:
		return len(value) == 0
	case map[string]any:
		return len(value) == 0
	default:
		return false
	}
}
