package scenes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
)

const maxParameterObjects = 32
const maxParameterPosition = 19200
const maxParameterScale = 100
const maxParameterRotation = 100 * math.Pi

var parameterIDPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)
var parameterColorPattern = regexp.MustCompile(`^#[a-fA-F0-9]{6}$`)

type ObjectParameters struct {
	X        *float64 `json:"x,omitempty"`
	Y        *float64 `json:"y,omitempty"`
	Z        *float64 `json:"z,omitempty"`
	Rotation *float64 `json:"rotation,omitempty"`
	ScaleX   *float64 `json:"scaleX,omitempty"`
	ScaleY   *float64 `json:"scaleY,omitempty"`
	Opacity  *float64 `json:"opacity,omitempty"`
	Delay    *float64 `json:"delay,omitempty"`
	Duration *float64 `json:"duration,omitempty"`
	Color    *string  `json:"color,omitempty"`
}

type SceneParameters map[string]ObjectParameters

func (object *ObjectParameters) UnmarshalJSON(data []byte) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return fmt.Errorf("parameter objects cannot be null")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return fmt.Errorf("decode parameter object: %w", err)
	}
	for _, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("parameter values cannot be null; omit unchanged fields")
		}
	}
	type plain ObjectParameters
	var decoded plain
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return fmt.Errorf("decode parameter values: %w", err)
	}
	*object = ObjectParameters(decoded)
	return nil
}

func (parameters SceneParameters) Validate() error {
	if len(parameters) > maxParameterObjects {
		return fmt.Errorf("expose at most %d parameter objects", maxParameterObjects)
	}
	for id, object := range parameters {
		if !parameterIDPattern.MatchString(id) {
			return fmt.Errorf("parameter object IDs need 1-64 ASCII letters, numbers, hyphens or underscores, starting with a letter")
		}
		if err := object.validate(); err != nil {
			return fmt.Errorf("object %s: %w", id, err)
		}
	}
	return nil
}

func (object ObjectParameters) validate() error {
	for _, bound := range []struct {
		value    *float64
		min, max float64
		name     string
	}{
		{object.X, -maxParameterPosition, maxParameterPosition, "x"}, {object.Y, -maxParameterPosition, maxParameterPosition, "y"}, {object.Z, -maxParameterPosition, maxParameterPosition, "z"},
		{object.Rotation, -maxParameterRotation, maxParameterRotation, "rotation"},
		{object.ScaleX, -maxParameterScale, maxParameterScale, "scaleX"}, {object.ScaleY, -maxParameterScale, maxParameterScale, "scaleY"},
		{object.Opacity, 0, 1, "opacity"}, {object.Delay, 0, maxSceneSeconds, "delay"}, {object.Duration, 0, maxSceneSeconds, "duration"},
	} {
		if bound.value != nil && (!finite(*bound.value) || *bound.value < bound.min || *bound.value > bound.max) {
			return fmt.Errorf("%s must be finite and between %g and %g", bound.name, bound.min, bound.max)
		}
	}
	if object.Color != nil && !parameterColorPattern.MatchString(*object.Color) {
		return fmt.Errorf("color must be a six-digit hex color")
	}
	return nil
}

func mergeParameterObject(base, patch ObjectParameters) ObjectParameters {
	if patch.X != nil {
		base.X = patch.X
	}
	if patch.Y != nil {
		base.Y = patch.Y
	}
	if patch.Z != nil {
		base.Z = patch.Z
	}
	if patch.Rotation != nil {
		base.Rotation = patch.Rotation
	}
	if patch.ScaleX != nil {
		base.ScaleX = patch.ScaleX
	}
	if patch.ScaleY != nil {
		base.ScaleY = patch.ScaleY
	}
	if patch.Opacity != nil {
		base.Opacity = patch.Opacity
	}
	if patch.Delay != nil {
		base.Delay = patch.Delay
	}
	if patch.Duration != nil {
		base.Duration = patch.Duration
	}
	if patch.Color != nil {
		base.Color = patch.Color
	}
	return base
}

func applyParameterPatch(base, patch SceneParameters) (SceneParameters, error) {
	if len(patch) == 0 {
		return nil, fmt.Errorf("provide at least one parameter object to patch")
	}
	if err := patch.Validate(); err != nil {
		return nil, err
	}
	result := make(SceneParameters, len(base))
	for id, object := range base {
		result[id] = object
	}
	for id, object := range patch {
		original, exists := base[id]
		if !exists {
			return nil, fmt.Errorf("object %s is not exposed by this source; edit Svelte explicitly to expose new objects", id)
		}
		result[id] = mergeParameterObject(original, object)
	}
	return result, result.Validate()
}
