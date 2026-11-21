package composition

import (
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/text"
)

type Composition struct {
	ID               string                 `json:"id"`
	DocumentRevision string                 `json:"documentRevision"`
	CompilerVersion  string                 `json:"compilerVersion"`
	CatalogVersion   string                 `json:"catalogVersion"`
	Duration         document.Time          `json:"duration"`
	Output           document.Output        `json:"output"`
	Assets           []document.Asset       `json:"assets"`
	Tracks           []document.Track       `json:"tracks"`
	Effects          []document.EffectBlock `json:"effects"`
	Transitions      []document.Transition  `json:"transitions"`
	TextItems        []document.TextItem    `json:"textItems"`
	TextRenderKey    string                 `json:"textRenderKey"`
	PreparedText     *text.Prepared         `json:"preparedText,omitempty"`
	Segments         map[string][]Segment   `json:"segments"`
}

type Segment struct {
	SrcStart document.Time `json:"srcStart"`
	SrcEnd   document.Time `json:"srcEnd"`
	Effects  []Effect      `json:"effects"`
}

type Effect struct {
	ID     string             `json:"id"`
	Params map[string]float64 `json:"params"`
	Ramp   *Ramp              `json:"ramp,omitempty"`
}

type Ramp struct {
	document.Ramp
	BlockDuration document.Time `json:"blockDuration"`
	Offset        document.Time `json:"offset"`
}

type Snapshot struct {
	Revision    string                 `json:"revision"`
	Tracks      []document.Track       `json:"tracks"`
	Effects     []document.EffectBlock `json:"effects"`
	Transitions []document.Transition  `json:"transitions"`
	TextItems   []document.TextItem    `json:"textItems"`
	SelectedIDs []string               `json:"selectedIds"`
}

type Requirement struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Path    string `json:"path"`
	Message string `json:"message"`
}

type Result struct {
	Document         *document.Document    `json:"document,omitempty"`
	Bindings         document.Bindings     `json:"bindings,omitempty"`
	Composition      *Composition          `json:"composition,omitempty"`
	ExpectedRevision string                `json:"expectedRevision"`
	Diagnostics      []document.Diagnostic `json:"diagnostics"`
	Requirements     []Requirement         `json:"requirements"`
	Summary          string                `json:"summary"`
	Recovery         *Recovery             `json:"recovery,omitempty"`
}

type Recovery struct {
	Document document.Document `json:"document"`
	Bindings document.Bindings `json:"bindings"`
	Assets   []document.Asset  `json:"assets"`
}
