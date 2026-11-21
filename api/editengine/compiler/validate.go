package compiler

import (
	"fmt"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/catalog"
	"ffmpeg-go-server/editengine/document"
)

const (
	MaxClips                                = 10000
	MaxTextItems                            = 2000
	MaxCommands                             = 1000
	MinimumClipDuration       document.Time = 100_000
	MinimumTransitionDuration document.Time = 100_000
)

func (s *compilation) validate() {
	doc := s.input.Document
	if doc.Version != document.Version && doc.Version != document.RecipeVersion && doc.Version != document.MontageVersion {
		s.fail("version", "unsupported_version", "supported DSL versions are 1, 2 and 3")
	}
	if doc.Montage != nil && doc.Version < document.MontageVersion {
		s.fail("version", "unsupported_version", "montage requires version 3")
	}
	if doc.CompilerVersion != Version {
		s.fail("compilerVersion", "unsupported_version", "unsupported compiler version")
	}
	if doc.CatalogVersion != s.compiler.Catalog.Version {
		s.fail("catalogVersion", "unsupported_version", "unsupported catalog version")
	}
	if doc.Mode != "assemble" && doc.Mode != "modify" {
		s.fail("mode", "invalid_mode", "mode must be assemble or modify")
	}
	if doc.Mode == "modify" && s.input.Snapshot == nil {
		s.fail("snapshot", "missing_snapshot", "modify requires a snapshot with a revision")
	}
	if s.input.Snapshot != nil && s.input.Snapshot.Revision == "" {
		s.fail("snapshot.revision", "missing_revision", "snapshot revision is required")
	}
	if doc.Mode == "modify" && (len(doc.Tracks) > 0 || doc.Sequence != nil || len(doc.Audio) > 0) {
		s.fail("mode", "conflict", "modify uses snapshot tracks; use commands and overrides")
	}
	if len(doc.Commands)+len(doc.Rules) > MaxCommands {
		s.fail("commands", "limit", fmt.Sprintf("at most %d recipe commands", MaxCommands))
	}
	if len(doc.Texts) > MaxTextItems {
		s.fail("texts", "limit", fmt.Sprintf("at most %d text items", MaxTextItems))
	}
	s.validateTextEncodings()
	s.validateOutput(doc.Output)
	for slot, input := range doc.Inputs {
		if strings.TrimSpace(slot) == "" || !slices.Contains([]string{"video", "audio", "image"}, input.Kind) {
			s.fail("inputs."+slot, "invalid_slot", "slot requires a name and video, audio or image kind")
		}
	}
	if doc.Sequence != nil {
		s.validateSequence(*doc.Sequence)
	}
	for index, effect := range doc.Effects {
		if _, err := s.compiler.Catalog.ResolveEffect(effect.Preset, effect.Params, effect.Ramp); err != nil {
			s.fail(fmt.Sprintf("effects[%d]", index), "invalid_effect", err.Error())
		}
	}
	for index, transition := range doc.Transitions {
		if _, ok := s.compiler.Catalog.Transition(transition.Preset); !ok {
			s.fail(fmt.Sprintf("transitions[%d].preset", index), "unknown_preset", "unknown transition "+transition.Preset)
		}
	}
	s.validateCommands()
	s.validateRules()
	s.validatePlacements()
	s.validateMontage()
}

func (s *compilation) validateOutput(output document.Output) {
	if !output.Fit.Valid() {
		s.fail("output.fit", "invalid_output", "expected contain or cover")
	}
	for path, choice := range map[string]struct {
		value   string
		allowed []string
	}{
		"aspect":     {output.Aspect, []string{"landscape", "portrait", "classic"}},
		"resolution": {output.Resolution, []string{"480p", "720p", "1080p", "2k", "4k"}},
		"format":     {output.Format, []string{"mp4", "avi", "mp3"}},
		"quality":    {output.Quality, []string{"low", "normal", "high"}},
	} {
		if !slices.Contains(choice.allowed, choice.value) {
			s.fail("output."+path, "invalid_output", "expected "+strings.Join(choice.allowed, ", "))
		}
	}
	if output.FPS < 1 || output.FPS > 120 {
		s.fail("output.fps", "invalid_output", "fps must be 1–120")
	}
}

func (s *compilation) validateSequence(sequence document.Sequence) {
	input, ok := s.input.Document.Inputs[sequence.Use]
	if !ok || input.Kind == "audio" {
		s.fail("sequence.use", "invalid_slot", "sequence requires a declared video or image slot")
	}
	if sequence.Order != "input" && sequence.Order != "reverse" {
		s.fail("sequence.order", "invalid_order", "order must be input or reverse")
	}
	if sequence.Each.Take.From < 0 || sequence.Each.Take.Duration < MinimumClipDuration {
		s.fail("sequence.each.take", "invalid_duration", "take requires from >= 0 and duration >= 100ms (timeline time)")
	}
	if !catalog.FiniteRange(sequence.Each.Rate, 0.25, 4) {
		s.fail("sequence.each.rate", "invalid_rate", "rate must be 0.25–4")
	}
	if sequence.Each.SourceAudio != "keep" && sequence.Each.SourceAudio != "remove" {
		s.fail("sequence.each.source_audio", "invalid_audio", "source_audio must be keep or remove")
	}
	if volume := sequence.Each.Volume; volume != nil && !catalog.FiniteRange(*volume, 0, 200) {
		s.fail("sequence.each.volume", "invalid_volume", "volume must be 0–200 percent")
	}
	s.validatePresets(sequence.Each.Look, sequence.Each.Motion, "sequence.each")
	if between := sequence.Between; between != nil {
		if _, ok := s.compiler.Catalog.Transition(between.Preset); !ok {
			s.fail("sequence.between.preset", "unknown_preset", "unknown transition "+between.Preset)
		}
		if between.Duration < MinimumTransitionDuration {
			s.fail("sequence.between.duration", "invalid_duration", "transition duration must be at least 100ms")
		}
		if between.Policy != "error" && between.Policy != "shrink" {
			s.fail("sequence.between.policy", "invalid_policy", "policy must be error or shrink")
		}
	}
}

func (s *compilation) validatePresets(look, motion, path string) {
	if look != "" {
		if _, ok := s.compiler.Catalog.Look(look); !ok {
			s.fail(path+".look", "unknown_preset", "unknown look "+look)
		}
	}
	if motion != "" {
		if _, ok := s.compiler.Catalog.Motion(motion); !ok {
			s.fail(path+".motion", "unknown_preset", "unknown motion "+motion)
		}
	}
}

func (s *compilation) bind() {
	s.assets = make(map[string]document.Asset)
	used := make(map[string]bool)
	for _, ids := range s.input.Bindings {
		for _, id := range ids {
			used[id] = true
		}
	}
	for _, track := range s.input.Document.Tracks {
		for _, clip := range track.Clips {
			used[clip.AssetID] = true
		}
	}
	if s.input.Document.Mode == "modify" && s.input.Snapshot != nil {
		for _, track := range s.input.Snapshot.Tracks {
			for _, clip := range track.Clips {
				used[clip.AssetID] = true
			}
		}
	}
	for index, asset := range s.input.Assets {
		path := fmt.Sprintf("assets[%d]", index)
		if asset.ID == "" || asset.Version == "" || asset.File == "" {
			s.fail(path, "asset_identity", "asset requires id, immutable version and file")
		}
		if _, exists := s.assets[asset.ID]; exists {
			s.fail(path, "duplicate_asset", "duplicate asset id")
		}
		if !slices.Contains([]string{"video", "audio", "image"}, asset.Kind) {
			s.fail(path+".kind", "invalid_kind", "unknown media kind")
		}
		if used[asset.ID] && asset.Duration <= 0 && asset.Kind != "image" {
			s.require(asset.ID, "metadata", path+".duration", "asset duration is required")
		}
		s.assets[asset.ID] = asset
	}
	for slot, binding := range s.input.Bindings {
		definition, exists := s.input.Document.Inputs[slot]
		if !exists {
			s.fail("bindings."+slot, "unknown_slot", "binding refers to an undeclared slot")
			continue
		}
		if !definition.Multiple && len(binding) > 1 {
			s.fail("bindings."+slot, "slot_cardinality", "slot accepts only one asset")
		}
		for _, id := range binding {
			asset, exists := s.assets[id]
			if !exists {
				s.fail("bindings."+slot, "unknown_asset", "unknown asset "+id)
				continue
			}
			if asset.Kind != definition.Kind {
				s.fail("bindings."+slot, "slot_kind", "asset kind does not match slot")
			}
		}
	}
	for slot, definition := range s.input.Document.Inputs {
		if !definition.Optional && len(s.input.Bindings[slot]) == 0 {
			s.require(slot, "binding", "inputs."+slot, "required slot is empty")
		}
	}
}

func (s *compilation) requireJobs() {
	seen := make(map[string]bool)
	trackIDs := make(map[string]bool)
	for _, track := range s.input.Document.Tracks {
		if track.ID != "" {
			trackIDs[track.ID] = true
		}
	}
	for _, stage := range []struct {
		name string
		jobs []document.Job
	}{{"jobs", s.input.Document.Jobs}, {"before", s.input.Document.Before}, {"after", s.input.Document.After}} {
		for index, job := range stage.jobs {
			path := fmt.Sprintf("%s[%d]", stage.name, index)
			if job.ID == "" || seen[job.ID] {
				s.fail(path+".id", "job_identity", "jobs require unique ids")
				continue
			}
			seen[job.ID] = true
			if !slices.Contains([]string{"captions.generate", "analysis.transcribe", "image.generate", "speech.generate", "scene.generate", "scene.edit"}, job.Type) {
				s.fail(path+".type", "unsupported_job", "unsupported generation job")
				continue
			}
			if stage.name == "before" && !slices.Contains([]string{"image.generate", "speech.generate", "scene.generate", "scene.edit"}, job.Type) ||
				stage.name == "after" && job.Type != "captions.generate" {
				s.fail(path+".type", "invalid_stage", "before supports image/speech/scene generation and scene edits; after supports captions")
				continue
			}
			s.validateJobOrchestration(job, path, trackIDs)
			if len(job.ResultTextIDs) > 0 {
				for _, id := range job.ResultTextIDs {
					if !slices.ContainsFunc(s.input.Document.Texts, func(item document.TextItem) bool { return item.ID == id }) {
						s.fail(path, "missing_result", "materialized text "+id+" is missing")
					}
				}
				continue
			}
			if job.ResultAssetID != "" {
				if _, exists := s.assets[job.ResultAssetID]; !exists {
					s.fail(path, "missing_result", "materialized asset is missing")
				}
				if job.ResultAudioAssetID != "" {
					asset, exists := s.assets[job.ResultAudioAssetID]
					if !exists || asset.Kind != "audio" || job.AudioStart < 0 || job.AudioStart >= asset.Duration {
						s.fail(path+".resultAudioAssetId", "invalid_audio", "scene narration needs an audio asset and a valid source offset")
					}
				}
				continue
			}
			s.require(job.ID, job.Type, path, "materialize this job result before compiling; render never generates media")
		}
	}
}

func (s *compilation) validateJobOrchestration(job document.Job, path string, trackIDs map[string]bool) {
	if job.Instructions != "" && job.Type != "speech.generate" {
		s.fail(path+".instructions", "invalid_job_field", "delivery instructions are only supported for speech.generate")
	}
	if (job.NarrationJob != "" || job.NarrationFrom != 0) && job.Type != "scene.generate" {
		s.fail(path+".narrationJob", "invalid_job_field", "narration binding is only supported for scene.generate")
	}
	if job.VisualMode != "" && job.Type != "scene.generate" && job.Type != "scene.edit" {
		s.fail(path+".visualMode", "invalid_job_field", "visualMode is only supported for scene generation")
	}
	if job.Language != "" && !validJobLanguage(job.Language) {
		s.fail(path+".language", "invalid_language", "language must be an ISO-639-1 code such as 'ro' or 'auto'")
	}
	if job.TrackID != "" && !trackIDs[job.TrackID] {
		s.fail(path+".trackId", "unknown_track", "job trackId must reference a timeline track")
	}
	if job.Duration < 0 || job.Start < 0 {
		s.fail(path, "invalid_placement", "job start and duration must be nonnegative (timeline time)")
	}
	switch job.Type {
	case "captions.generate", "analysis.transcribe":
		s.validateCaptionJobStyle(job, path)
		if len(job.ResultTextIDs) > 0 && slices.ContainsFunc(s.input.Document.Texts, func(item document.TextItem) bool {
			return slices.Contains(job.ResultTextIDs, item.ID) && item.IsCaption && len(item.Words) == 0
		}) {
			s.result.Diagnostics = append(s.result.Diagnostics, document.Diagnostic{Path: path, Code: "phrase_timing_only", Message: "The provider returned phrase timings only; word highlighting is disabled instead of inventing word timestamps", Severity: "warning"})
		}
		if job.MaxWords < 0 || job.MaxWords > 50 {
			s.fail(path+".maxWords", "invalid_max_words", "maxWords must be 1–50, or omitted for the four-word default")
		}
		if job.Input != "" && job.Input != "montage" {
			s.fail(path+".input", "invalid_scope", "caption input must be empty or montage")
		}
		if job.Prompt != "" || job.Text != "" {
			s.fail(path, "invalid_job_field", "captions jobs use language/maxWords, not prompt/text")
		}
	case "image.generate", "scene.generate", "scene.edit":
		if strings.TrimSpace(job.Prompt) == "" && job.ResultAssetID == "" {
			s.fail(path+".prompt", "missing_prompt", job.Type+" requires a prompt until resultAssetId is supplied")
		}
		if job.Type != "image.generate" {
			s.validateSceneJob(job, path)
		}
	case "speech.generate":
		if strings.TrimSpace(job.Text) == "" && strings.TrimSpace(job.Input) == "" && job.ResultAssetID == "" {
			s.fail(path, "missing_text", "speech.generate requires text (or input) until resultAssetId is supplied")
		}
	}
}

func (s *compilation) validateSceneJob(job document.Job, path string) {
	s.validateSceneDesign(job, path)
	if (job.Duration < document.Second && !(job.Duration == 0 && job.NarrationJob != "")) || job.Duration > 60*document.Second {
		s.fail(path+".duration", "invalid_duration", "scene duration must be between 1 and 60 seconds")
	}
	if job.NarrationJob != "" {
		s.validateSceneNarration(job, path)
	} else if job.NarrationFrom != 0 {
		s.fail(path+".narrationFrom", "missing_narration", "narrationFrom requires narrationJob")
	}
	if job.Type == "scene.edit" && job.ResultAssetID == "" {
		asset, exists := s.assets[job.AssetID]
		if !exists || asset.Kind != "video" || asset.Local || !strings.HasSuffix(asset.File, ".scene.json") {
			s.fail(path+".assetId", "invalid_scene", "scene.edit requires a server live-scene assetId")
		}
		if len(job.Images) > 0 {
			s.fail(path+".images", "invalid_scene", "scene.edit preserves the existing images")
		}
	}
	if (job.Width != 0 || job.Height != 0) && (job.Width < 2 || job.Height < 2 || job.Width > 1920 || job.Height > 1920 || job.Width%2 != 0 || job.Height%2 != 0) {
		s.fail(path, "invalid_dimensions", "scene width and height must be even, between 2 and 1920 pixels")
	}
	if job.FPS != 0 && !catalog.FiniteRange(job.FPS, 1, 60) {
		s.fail(path+".fps", "invalid_fps", "scene fps must be between 1 and 60")
	}
}

func validJobLanguage(language string) bool {
	normalized := strings.ToLower(strings.TrimSpace(language))
	if normalized == "auto" {
		return true
	}
	if len(normalized) != 2 {
		return false
	}
	for _, char := range normalized {
		if char < 'a' || char > 'z' {
			return false
		}
	}
	return true
}
