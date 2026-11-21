package text

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"ffmpeg-go-server/editengine/document"
)

type Overlay struct {
	Start             document.Time  `json:"start"`
	Duration          document.Time  `json:"duration"`
	X                 int            `json:"x"`
	Y                 int            `json:"y"`
	Animation         string         `json:"animation,omitempty"`
	AnimationDuration document.Time  `json:"animationDuration,omitempty"`
	MotionStart       *document.Time `json:"motionStart,omitempty"`
	MotionDuration    *document.Time `json:"motionDuration,omitempty"`
	Image             string         `json:"image"`
}

type Prepared struct {
	Key      string    `json:"key"`
	Overlays []Overlay `json:"overlays"`
}

func SourceKey(items []document.TextItem, output document.Output) (string, error) {
	source := struct {
		Version    int                 `json:"version"`
		Items      []document.TextItem `json:"items"`
		Resolution string              `json:"resolution"`
		Aspect     string              `json:"aspect"`
	}{Version: 4, Items: items, Resolution: output.Resolution, Aspect: output.Aspect}
	data, err := json.Marshal(source)
	if err != nil {
		return "", fmt.Errorf("encode text source: %w", err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func (prepared *Prepared) Resolve(items []document.TextItem, output document.Output) ([]Overlay, error) {
	if output.Format == "mp3" || len(items) == 0 {
		return nil, nil
	}
	if prepared == nil || len(prepared.Overlays) < len(items) {
		return nil, fmt.Errorf("prepared text images are missing; save or export the project from the editor to prepare them")
	}
	key, err := SourceKey(items, output)
	if err != nil {
		return nil, err
	}
	if prepared.Key != key {
		return nil, fmt.Errorf("text or output dimensions changed; save or export the project from the editor to refresh text images")
	}
	return prepared.Overlays, nil
}
