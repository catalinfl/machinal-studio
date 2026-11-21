package mcpserver

import (
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
)

func compositionToolSchema() *jsonschema.Schema {
	schema, err := jsonschema.For[compositionInput](nil)
	if err != nil {
		panic("invalid composition input schema: " + err.Error())
	}
	inlineCompositionSchema(schema, schema.Defs)
	schema.Defs = nil
	return schema
}

func inlineCompositionSchema(schema *jsonschema.Schema, definitions map[string]*jsonschema.Schema) {
	if schema == nil {
		return
	}
	if name, ok := strings.CutPrefix(schema.Ref, "#/$defs/"); ok && definitions[name] != nil {
		*schema = *definitions[name].CloneSchemas()
	}
	for _, property := range schema.Properties {
		inlineCompositionSchema(property, definitions)
	}
	inlineCompositionSchema(schema.Items, definitions)
	if kind := schema.Properties["kind"]; kind != nil {
		if schema.Properties["at"] != nil {
			kind.Enum = []any{"reveal", "action", "hold", "exit"}
		} else if schema.Properties["duration"] != nil {
			kind.Enum = []any{"effect", "look", "motion", "transition", "cut", "none"}
		}
	}
}
