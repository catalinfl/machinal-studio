package document

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"

	"gopkg.in/yaml.v3"
)

const MaxDocumentBytes = 4 << 20

// Full projects include base64 text images; keep this aligned with the client limit.
const MaxProjectBytes = 128 << 20

type Diagnostic struct {
	Code     string `json:"code"`
	Path     string `json:"path"`
	Line     int    `json:"line,omitempty"`
	Column   int    `json:"column,omitempty"`
	Message  string `json:"message"`
	Severity string `json:"severity"`
}

func (d Diagnostic) Error() string { return fmt.Sprintf("%s: %s", d.Path, d.Message) }

type Parsed struct {
	Document  Document
	Positions map[string]Diagnostic
}

func Parse(data []byte) (Parsed, error) {
	parsed := Parsed{Positions: make(map[string]Diagnostic)}
	if len(data) > MaxDocumentBytes {
		return parsed, fmt.Errorf("document exceeds %d bytes", MaxDocumentBytes)
	}
	encoded, err := yamlJSON(data, reflect.TypeFor[Document](), parsed.Positions)
	if err != nil {
		return parsed, err
	}
	if err := DecodeJSON(encoded, &parsed.Document); err != nil {
		return parsed, fmt.Errorf("decode document: %w", err)
	}
	return parsed, nil
}

func ProjectJSON(data []byte) ([]byte, error) {
	if len(data) > MaxProjectBytes {
		return nil, fmt.Errorf("project exceeds %d bytes", MaxProjectBytes)
	}
	return yamlJSON(data, reflect.TypeFor[any](), make(map[string]Diagnostic))
}

func yamlJSON(data []byte, kind reflect.Type, positions map[string]Diagnostic) ([]byte, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	var root yaml.Node
	if err := decoder.Decode(&root); err != nil {
		return nil, fmt.Errorf("parse document: %w", err)
	}
	var extra yaml.Node
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, fmt.Errorf("exactly one YAML document is required")
	}
	if len(root.Content) != 1 || root.Content[0].Kind != yaml.MappingNode {
		return nil, fmt.Errorf("document must be a mapping")
	}
	if err := inspectNode(root.Content[0], kind, "", positions, 0); err != nil {
		return nil, err
	}
	var value any
	if err := root.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode YAML: %w", err)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("convert YAML: %w", err)
	}
	return encoded, nil
}

func DecodeJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("exactly one JSON value is required")
	}
	return nil
}

func inspectNode(node *yaml.Node, kind reflect.Type, path string, positions map[string]Diagnostic, depth int) error {
	position := Diagnostic{Path: path, Line: node.Line, Column: node.Column, Severity: "error", Code: "parse"}
	positions[path] = position
	reject := func(message string) error { position.Message = message; return position }
	if depth > 32 {
		return reject("document nesting exceeds 32 levels")
	}
	if node.Anchor != "" || node.Kind == yaml.AliasNode {
		return reject("YAML anchors and aliases are not supported")
	}
	if node.Tag == "!!null" {
		return reject("null is not supported; omit optional fields")
	}
	for kind.Kind() == reflect.Pointer {
		kind = kind.Elem()
	}
	if kind == reflect.TypeFor[TextStyle]() && node.Kind != yaml.MappingNode {
		return reject("caption style must be a mapping of supported text style fields")
	}
	if kind.Kind() == reflect.Interface {
		switch node.Kind {
		case yaml.MappingNode:
			kind = reflect.TypeFor[map[string]any]()
		case yaml.SequenceNode:
			kind = reflect.TypeFor[[]any]()
		}
	}
	if kind.Kind() == reflect.String && (node.Kind != yaml.ScalarNode || node.Tag != "!!str") {
		message := "expected a string"
		if node.Kind == yaml.ScalarNode {
			message += fmt.Sprintf("; quote the value as %q", node.Value)
		}
		return reject(message)
	}
	if kind.Kind() == reflect.Slice && node.Kind != yaml.SequenceNode {
		return reject("expected a sequence (YAML list); prefix each item with '- ' or use [...]")
	}
	if node.Kind == yaml.MappingNode {
		fields := jsonFields(kind)
		seen := make(map[string]bool)
		for index := 0; index < len(node.Content); index += 2 {
			key, value := node.Content[index], node.Content[index+1]
			childPath := strings.TrimPrefix(path+"."+key.Value, ".")
			if key.Tag != "!!str" || key.Value == "<<" {
				return reject("mapping keys must be strings; merge keys are not supported")
			}
			if seen[key.Value] {
				return Diagnostic{Code: "duplicate_key", Path: childPath, Line: key.Line, Column: key.Column, Severity: "error", Message: "duplicate key"}
			}
			seen[key.Value] = true
			childType, ok := fields[key.Value]
			if kind.Kind() == reflect.Map {
				childType, ok = kind.Elem(), true
			}
			if !ok {
				return Diagnostic{Code: "unknown_field", Path: childPath, Line: key.Line, Column: key.Column, Severity: "error", Message: "unknown field"}
			}
			if err := inspectNode(value, childType, childPath, positions, depth+1); err != nil {
				return err
			}
		}
	} else if node.Kind == yaml.SequenceNode {
		if kind.Kind() != reflect.Slice {
			return reject("unexpected sequence")
		}
		for index, child := range node.Content {
			if err := inspectNode(child, kind.Elem(), fmt.Sprintf("%s[%d]", path, index), positions, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

func jsonFields(kind reflect.Type) map[string]reflect.Type {
	fields := make(map[string]reflect.Type)
	if kind.Kind() != reflect.Struct {
		return fields
	}
	for index := 0; index < kind.NumField(); index++ {
		field := kind.Field(index)
		if field.Anonymous {
			for name, value := range jsonFields(field.Type) {
				fields[name] = value
			}
			continue
		}
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if name != "" && name != "-" {
			fields[name] = jsonFieldType(kind, field, name)
		}
	}
	return fields
}

func jsonFieldType(owner reflect.Type, field reflect.StructField, name string) reflect.Type {
	// Raw caption patches preserve omitted defaults, but their wire shape is TextStyle.
	if owner == reflect.TypeFor[Job]() && name == "style" {
		return reflect.TypeFor[TextStyle]()
	}
	return field.Type
}
