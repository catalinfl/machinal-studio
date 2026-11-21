package catalog

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"slices"

	"ffmpeg-go-server/editengine/document"
)

const Version = "1"

//go:embed catalog.v1.json
var data []byte

type Parameter struct {
	Key     string  `json:"key"`
	Label   string  `json:"label"`
	Default float64 `json:"defaultValue"`
	Min     float64 `json:"min"`
	Max     float64 `json:"max"`
	Step    float64 `json:"step"`
	Unit    string  `json:"unit,omitempty"`
	Integer bool    `json:"integer,omitempty"`
}

type Effect struct {
	ID         string      `json:"id"`
	Parameters []Parameter `json:"parameters"`
	NoRamp     bool        `json:"noRamp"`
}

type Transition struct {
	ID    string `json:"id"`
	Xfade string `json:"xfade"`
}

type Frame struct {
	At        float64            `json:"at"`
	Transform document.Transform `json:"transform"`
}

type Motion struct {
	ID     string  `json:"id"`
	Cap    float64 `json:"cap"`
	Frames []Frame `json:"frames"`
}

type LookEffect struct {
	ID     string  `json:"id"`
	Start  float64 `json:"start"`
	Length struct {
		Fraction float64 `json:"fraction"`
		Cap      float64 `json:"cap"`
	} `json:"length"`
	Params       map[string]float64 `json:"params"`
	Ramp         *document.Ramp     `json:"ramp"`
	FPSParameter string             `json:"fpsParameter"`
}

type Look struct {
	ID      string       `json:"id"`
	Motion  string       `json:"motion"`
	Frames  []Frame      `json:"frames"`
	Effects []LookEffect `json:"effects"`
}

type TextPreset struct {
	ID     string                     `json:"id"`
	Values map[string]json.RawMessage `json:"values"`
}

type Registry struct {
	Version     string       `json:"version"`
	Effects     []Effect     `json:"effects"`
	Transitions []Transition `json:"transitions"`
	Motions     []Motion     `json:"motions"`
	Looks       []Look       `json:"looks"`
	TextPresets []TextPreset `json:"textPresets"`
	Fonts       []struct {
		ID string `json:"id"`
	} `json:"fonts"`
}

func Load() Registry {
	var registry Registry
	if err := json.Unmarshal(data, &registry); err != nil {
		panic("invalid embedded edit catalog: " + err.Error())
	}
	return registry
}

func JSON() json.RawMessage { return slices.Clone(data) }

func (r Registry) Transition(id string) (Transition, bool) {
	for _, value := range r.Transitions {
		if value.ID == id {
			return value, true
		}
	}
	return Transition{}, false
}

func (r Registry) Look(id string) (Look, bool) {
	for _, value := range r.Looks {
		if value.ID == id {
			return value, true
		}
	}
	return Look{}, false
}

func (r Registry) Motion(id string) (Motion, bool) {
	for _, value := range r.Motions {
		if value.ID == id {
			return value, true
		}
	}
	return Motion{}, false
}

func (r Registry) Effect(id string) (Effect, bool) {
	for _, value := range r.Effects {
		if value.ID == id {
			return value, true
		}
	}
	return Effect{}, false
}

func (r Registry) ResolveEffect(id string, params map[string]float64, ramp *document.Ramp) (map[string]float64, error) {
	effect, ok := r.Effect(id)
	if !ok {
		return nil, fmt.Errorf("unknown effect %q", id)
	}
	resolved := make(map[string]float64, len(effect.Parameters))
	for _, parameter := range effect.Parameters {
		resolved[parameter.Key] = parameter.Default
	}
	for key, value := range params {
		index := slices.IndexFunc(effect.Parameters, func(p Parameter) bool { return p.Key == key })
		if index < 0 {
			return nil, fmt.Errorf("unknown parameter %q for %s", key, id)
		}
		parameter := effect.Parameters[index]
		if !FiniteRange(value, parameter.Min, parameter.Max) || parameter.Integer && value != math.Round(value) {
			return nil, fmt.Errorf("%s.%s must be %g–%g (integer: %t)", id, key, parameter.Min, parameter.Max, parameter.Integer)
		}
		resolved[key] = value
	}
	if err := validateRamp(effect, ramp); err != nil {
		return nil, err
	}
	return resolved, nil
}

func validateRamp(effect Effect, ramp *document.Ramp) error {
	if ramp == nil {
		return nil
	}
	if effect.NoRamp {
		return fmt.Errorf("%s does not support intensity ramps", effect.ID)
	}
	if !slices.Contains([]string{"in", "out", "in-out"}, ramp.Mode) {
		return fmt.Errorf("unknown ramp mode %q", ramp.Mode)
	}
	if !slices.Contains([]string{"linear", "ease-in", "ease-out", "ease-in-out"}, ramp.Curve) {
		return fmt.Errorf("unknown ramp curve %q", ramp.Curve)
	}
	maximum := 1.0
	if ramp.Mode == "in-out" {
		maximum = 0.5
	}
	if !FiniteRange(ramp.Amount, 0.05, maximum) {
		return fmt.Errorf("ramp amount must be 0.05–%g", maximum)
	}
	return nil
}

func FiniteRange(value, minimum, maximum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= minimum && value <= maximum
}
