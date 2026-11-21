package compiler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"ffmpeg-go-server/editengine/catalog"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/text"
)

const Version = "1"

type Input struct {
	Document     document.Document     `json:"document"`
	Bindings     document.Bindings     `json:"bindings"`
	Assets       []document.Asset      `json:"assets"`
	Snapshot     *composition.Snapshot `json:"snapshot,omitempty"`
	PreparedText *text.Prepared        `json:"preparedText,omitempty"`
}

type Compiler struct{ Catalog catalog.Registry }

type compileMode uint8

const (
	renderMode compileMode = iota
	draftMode
	preflightMode
)

func New() Compiler { return Compiler{Catalog: catalog.Load()} }

func (compiler Compiler) Validate(input Input) composition.Result {
	return compiler.Preflight(input)
}

type compilation struct {
	compiler    Compiler
	input       Input
	result      composition.Result
	assets      map[string]document.Asset
	composition composition.Composition
}

func (compiler Compiler) Compile(input Input) composition.Result {
	return compiler.compile(input, renderMode)
}

func (compiler Compiler) CompileDraft(input Input) composition.Result {
	return compiler.compile(input, draftMode)
}

// Preflight accepts an empty base timeline while generation is pending and
// never returns a renderable composition.
func (compiler Compiler) Preflight(input Input) composition.Result {
	return compiler.compile(input, preflightMode)
}

func (compiler Compiler) compile(input Input, mode compileMode) composition.Result {
	state := compilation{compiler: compiler, result: composition.Result{
		Diagnostics: []document.Diagnostic{}, Requirements: []composition.Requirement{},
	}}
	if err := state.copyInput(input); err != nil {
		state.fail("document", "invalid_document", err.Error())
		return state.result
	}
	state.normalize()
	state.validate()
	if state.hasErrors() {
		return state.result
	}
	state.bind()
	state.requireJobs()
	if state.hasErrors() || len(state.result.Requirements) > 0 {
		return state.result
	}
	state.plan()
	if state.hasErrors() {
		return state.result
	}
	state.verify(mode != renderMode)
	if state.hasErrors() || mode == preflightMode {
		return state.result
	}
	state.finish()
	return state.result
}

func (s *compilation) copyInput(input Input) error {
	data, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("encode compiler input: %w", err)
	}
	if err := json.Unmarshal(data, &s.input); err != nil {
		return fmt.Errorf("copy compiler input: %w", err)
	}
	for index, item := range input.Document.Texts {
		s.input.Document.Texts[index].Explicit = item.Explicit
	}
	if input.Snapshot != nil {
		s.result.ExpectedRevision = input.Snapshot.Revision
	}
	return nil
}

func (s *compilation) normalize() {
	doc := &s.input.Document
	if doc.Version == 0 {
		doc.Version = document.Version
		if len(doc.Rules) > 0 || len(doc.Before) > 0 || len(doc.After) > 0 || len(doc.Placements) > 0 {
			doc.Version = document.RecipeVersion
		}
		if doc.Montage != nil {
			doc.Version = document.MontageVersion
		}
	}
	if doc.CatalogVersion == "" {
		doc.CatalogVersion = catalog.Version
	}
	if doc.CompilerVersion == "" {
		doc.CompilerVersion = Version
	}
	if doc.InstanceID == "" {
		doc.InstanceID = "sequence"
	}
	output := &doc.Output
	if output.Fit == "" {
		output.Fit = document.VideoFitContain
	}
	if output.Aspect == "" {
		output.Aspect = "landscape"
	}
	if output.Aspect == "16:9" {
		output.Aspect = "landscape"
	}
	if output.Aspect == "9:16" {
		output.Aspect = "portrait"
	}
	if output.Aspect == "4:3" {
		output.Aspect = "classic"
	}
	if output.Resolution == "" {
		output.Resolution = "1080p"
	}
	if output.FPS == 0 {
		output.FPS = 30
	}
	if output.Format == "" {
		output.Format = "mp4"
	}
	if output.Quality == "" {
		output.Quality = "normal"
	}
	if doc.Sequence != nil {
		if doc.Sequence.Order == "" {
			doc.Sequence.Order = "input"
		}
		if doc.Sequence.Each.Rate == 0 {
			doc.Sequence.Each.Rate = 1
		}
		if doc.Sequence.Each.SourceAudio == "" {
			doc.Sequence.Each.SourceAudio = "keep"
		}
		if doc.Sequence.Between != nil && doc.Sequence.Between.Policy == "" {
			doc.Sequence.Between.Policy = "error"
		}
	}
	for trackIndex := range doc.Tracks {
		track := &doc.Tracks[trackIndex]
		if track.Clips == nil {
			track.Clips = []document.Clip{}
		}
		for index := range track.Clips {
			if track.Clips[index].TransformKeyframes == nil {
				track.Clips[index].TransformKeyframes = []document.Keyframe{}
			}
		}
	}
	for index := range doc.Texts {
		if doc.Texts[index].Words == nil {
			doc.Texts[index].Words = []document.Word{}
		}
	}
	for index := range doc.Effects {
		if doc.Effects[index].Params == nil {
			doc.Effects[index].Params = map[string]float64{}
		}
	}
	s.result.Document = doc
}

func (s *compilation) fail(path, code, message string) {
	s.result.Diagnostics = append(s.result.Diagnostics, document.Diagnostic{Path: path, Code: code, Message: message, Severity: "error"})
}

func (s *compilation) hasErrors() bool {
	for _, diagnostic := range s.result.Diagnostics {
		if diagnostic.Severity == "error" {
			return true
		}
	}
	return false
}

func (s *compilation) require(id, kind, path, message string) {
	s.result.Requirements = append(s.result.Requirements, composition.Requirement{ID: id, Kind: kind, Path: path, Message: message})
}

func (s *compilation) finish() {
	if s.composition.Tracks == nil {
		s.composition.Tracks = []document.Track{}
	}
	if s.composition.Effects == nil {
		s.composition.Effects = []document.EffectBlock{}
	}
	if s.composition.Transitions == nil {
		s.composition.Transitions = []document.Transition{}
	}
	if s.composition.TextItems == nil {
		s.composition.TextItems = []document.TextItem{}
	}
	for trackIndex := range s.composition.Tracks {
		track := &s.composition.Tracks[trackIndex]
		if track.Clips == nil {
			track.Clips = []document.Clip{}
		}
		for index := range track.Clips {
			if track.Clips[index].TransformKeyframes == nil {
				track.Clips[index].TransformKeyframes = []document.Keyframe{}
			}
		}
	}
	doc := &s.input.Document
	doc.Texts = s.composition.TextItems
	materializeTimeline := doc.Montage != nil || doc.Mode == "modify" ||
		len(doc.Rules) > 0 || len(doc.Placements) > 0 || len(doc.Before) > 0
	if len(doc.Before) > 0 || len(doc.After) > 0 {
		doc.Jobs = append(doc.Jobs, doc.Before...)
		doc.Jobs = append(doc.Jobs, doc.After...)
		doc.Before, doc.After, doc.Placements = nil, nil, nil
	}
	if materializeTimeline {
		doc.Montage = nil
		doc.Mode, doc.Sequence, doc.Commands, doc.Overrides, doc.Audio = "assemble", nil, nil, nil, nil
		doc.Tracks, doc.Effects, doc.Transitions = s.composition.Tracks, s.composition.Effects, s.composition.Transitions
		for index := range doc.Jobs {
			doc.Jobs[index].TrackID = ""
		}
	}
	doc.Rules = nil
	doc.Revision = ""
	doc.Revision = fingerprint(doc)
	s.composition.DocumentRevision = doc.Revision
	key, err := text.SourceKey(s.composition.TextItems, s.composition.Output)
	if err != nil {
		s.fail("texts", "invalid_text", err.Error())
		return
	}
	s.composition.TextRenderKey = key
	s.composition.ID = fingerprint(s.composition)
	s.composition.PreparedText = s.input.PreparedText
	s.result.Document = doc
	s.result.Composition = &s.composition
	s.result.Bindings = s.input.Bindings
	clips := 0
	for _, track := range s.composition.Tracks {
		clips += len(track.Clips)
	}
	s.result.Summary = fmt.Sprintf("%d clips, %d transitions, %d text items, %.3gs.", clips,
		len(s.composition.Transitions), len(s.composition.TextItems), s.composition.Duration.Seconds())
}

func fingerprint(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic("validated composition is not serializable: " + err.Error())
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
