package compositions

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/imagegen"
	"ffmpeg-go-server/internal/core/editor/speech"
	"ffmpeg-go-server/internal/core/editor/subtitles"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

// transcriptionTimeout bounds a single orchestration window; the overall
// request inherits the caller's context on top of it.
const orchestrationWindowTimeout = 120 * time.Second

// providerTimeout bounds a single image/speech generation call.
const orchestrationProviderTimeout = 240 * time.Second

// transcribeWindow calls the subtitle pipeline. It is a variable so tests
// can stub the paid provider without network access.
var transcribeWindow = func(ctx context.Context, root, file string, start, duration float64, language string) ([]subtitles.Cue, error) {
	return subtitles.TranscribeWindow(ctx, root, file, start, duration, language)
}

// generateImageCall runs image generation. Stubbed in tests.
var generateImageCall = func(ctx context.Context, dataDir string, safeJoin func(string) (string, error), prompt, model, aspect, background string) (imagegen.GeneratedImage, error) {
	return imagegen.GenerateImage(ctx, dataDir, safeJoin, prompt, model, aspect, background, "")
}

// generateSpeechCall runs TTS. Stubbed in tests.
var generateSpeechCall = func(ctx context.Context, dataDir string, safeJoin func(string) (string, error), request speech.Request) (speech.GeneratedSpeech, error) {
	return speech.GenerateSpeechAudio(ctx, dataDir, safeJoin, request)
}

type generationResult struct {
	composition.Result
	Cost *RenderCost `json:"cost,omitempty"`
}

// CompileAndGenerate behaves like Compile but also executes pending
// generation jobs declared in YAML, so one route call both generates media
// and compiles:
//
//   - captions.generate / analysis.transcribe: transcribes the timeline
//     clips with audio (or only job.assetId when set), materializes caption
//     texts and recompiles. Language "" or "auto" leaves detection to the
//     provider configuration.
//   - image.generate: generates an image from job.prompt (plus optional
//     model/aspect), registers it as an asset and sets job.resultAssetId;
//     the compiler then places it per job.trackId/start/duration.
//   - speech.generate: synthesizes job.text (or job.input) with an optional
//     voice/model, registers the MP3 asset and sets job.resultAssetId.
//
// Jobs that already carry results are reused untouched and never regenerate.
func CompileAndGenerate(c *fiber.Ctx) error {
	input, parsed, err := ParseProject(c.Body())
	if err != nil {
		return parseError(c, err)
	}
	root, session := sessions.ResolveRoot(c)
	result, err := CompileGenerated(c.UserContext(), input, root, session)
	response := generationResult{Result: WithPositions(result, parsed), Cost: completedRenderCost(c.UserContext())}
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(response)
	}
	if HasErrors(result) {
		c.Status(fiber.StatusUnprocessableEntity)
	} else {
		retainProjectComposition(c, result, "")
	}
	return c.JSON(response)
}

func CompileGenerated(ctx context.Context, input compiler.Input, root, session string) (composition.Result, error) {
	if credits.IsMCPWorkflow(ctx) {
		if _, err := mcpRecipeUsage(input.Document); err != nil {
			return generationFailure(input, "", "client_scene_required", err)
		}
	}
	if len(input.Document.Before) > 0 || len(input.Document.After) > 0 {
		return compileStaged(ctx, input, root, session)
	}
	result := engine.Compile(input)
	if HasErrors(result) || result.Composition != nil {
		return result, nil
	}
	captionPending := pendingCaptionJobs(input.Document)
	mediaPending := pendingMediaJobs(input.Document)
	if len(captionPending) == 0 && len(mediaPending) == 0 {
		return result, nil
	}
	if id, err := validateSpeechJobs(input.Document); err != nil {
		return generationFailure(input, id, "invalid_speech", err)
	}
	if input.Document.Mode != "assemble" {
		return result, nil
	}
	doc := input.Document
	assets := input.Assets
	for _, job := range captionPending {
		if len(doc.Tracks) == 0 {
			break
		}
		materialized, err := materializeCaptionJob(ctx, root, session, doc, assets, job)
		if err != nil {
			input.Document, input.Assets = doc, assets
			return generationFailure(input, job.ID, "transcription_failed", err)
		}
		doc = materialized
	}
	for _, job := range mediaPending {
		materializedDoc, materializedAssets, err := materializeMediaJob(ctx, root, session, doc, assets, job)
		if err != nil {
			input.Document, input.Assets = doc, assets
			return generationFailure(input, job.ID, "generation_failed", err)
		}
		doc, assets = materializedDoc, materializedAssets
	}
	input.Document, input.Assets = doc, assets
	return engine.Compile(input), nil
}

func pendingCaptionJobs(doc document.Document) []document.Job {
	var pending []document.Job
	for _, job := range doc.Jobs {
		if job.Type != "captions.generate" && job.Type != "analysis.transcribe" {
			continue
		}
		if len(job.ResultTextIDs) > 0 || job.ResultAssetID != "" {
			continue
		}
		pending = append(pending, job)
	}
	return pending
}

type captionWindow struct {
	file      string
	rate      float64
	timeline  float64
	source    float64
	sourceDur float64
	priority  int
}

func captionWindows(doc document.Document, assets []document.Asset, job document.Job) []captionWindow {
	byID := make(map[string]document.Asset, len(assets))
	for _, asset := range assets {
		byID[asset.ID] = asset
	}
	var windows []captionWindow
	for _, track := range doc.Tracks {
		if track.Muted {
			continue
		}
		if track.Type != "video" && track.Type != "audio" {
			continue
		}
		for _, clip := range track.Clips {
			if clip.Volume == 0 {
				continue
			}
			if job.Input == "montage" && (clip.Provenance == nil || clip.Provenance.Rule != "montage") {
				continue
			}
			asset, exists := byID[clip.AssetID]
			if !exists || asset.Local || asset.Kind == "image" {
				continue
			}
			if job.AssetID != "" && clip.AssetID != job.AssetID {
				continue
			}
			if track.Type == "video" && (!asset.HasAudio || clip.LinkedClipID != "") {
				continue
			}
			rate := clip.PlaybackRate
			if rate < 0.25 || rate > 4 {
				continue
			}
			sourceDur := (clip.OutPoint - clip.InPoint).Seconds()
			if sourceDur <= 0 {
				continue
			}
			priority := 2
			if track.Type == "audio" {
				priority = 1
				if track.ID == "recipe/audio/narration" || strings.EqualFold(track.Name, "narration") {
					priority = 0
				}
			}
			windows = append(windows, captionWindow{
				file: asset.File, rate: rate,
				timeline: clip.Start.Seconds(),
				source:   clip.InPoint.Seconds(), sourceDur: sourceDur, priority: priority,
			})
		}
	}
	if job.AssetID == "" {
		for _, window := range windows {
			if window.priority == 0 {
				windows = slices.DeleteFunc(windows, func(candidate captionWindow) bool { return candidate.priority != 0 })
				break
			}
		}
	}
	sort.SliceStable(windows, func(i, j int) bool {
		if windows[i].timeline == windows[j].timeline {
			return windows[i].priority < windows[j].priority
		}
		return windows[i].timeline < windows[j].timeline
	})
	unique := windows[:0]
	for _, window := range windows {
		duplicate := false
		for _, existing := range unique {
			if existing.file == window.file && existing.timeline == window.timeline && existing.source == window.source && existing.sourceDur == window.sourceDur && existing.rate == window.rate {
				duplicate = true
				break
			}
		}
		if !duplicate {
			unique = append(unique, window)
		}
	}
	return unique
}

func materializeCaptionJob(ctx context.Context, root, session string, doc document.Document, assets []document.Asset, job document.Job) (document.Document, error) {
	windows := captionWindows(doc, assets, job)
	if len(windows) == 0 {
		return doc, fmt.Errorf("job %q has no transcribable clips with audio", job.ID)
	}
	language := strings.ToLower(strings.TrimSpace(job.Language))
	if language == "auto" {
		language = ""
	}
	maxWords := job.MaxWords
	if maxWords == 0 {
		maxWords = 4
	}
	var words, phrases []document.Word
	missingWordTimes := false
	for _, window := range windows {
		subtitles.WarmFile(ctx, session, root, window.file)
		windowCtx, cancel := context.WithTimeout(ctx, orchestrationWindowTimeout)
		cues, err := transcribeWindow(windowCtx, root, window.file, window.source, window.sourceDur, captionWindowLanguage(doc, window.file, language))
		cancel()
		if err != nil {
			return doc, err
		}
		for _, cue := range cues {
			if cue.Start >= 0 && cue.End > cue.Start && cue.End <= window.sourceDur && strings.TrimSpace(cue.Text) != "" {
				phrases = append(phrases, document.Word{Text: strings.TrimSpace(cue.Text), Start: document.Seconds(window.timeline + cue.Start/window.rate), End: document.Seconds(window.timeline + cue.End/window.rate)})
				missingWordTimes = missingWordTimes || len(cue.Words) == 0 || slices.ContainsFunc(cue.Words, func(word subtitles.CueWord) bool {
					return len(strings.Fields(word.Text)) != 1
				})
			}
			for _, word := range cue.Words {
				text := strings.TrimSpace(word.Text)
				if text == "" || word.End <= word.Start {
					continue
				}
				if word.Start < 0 || word.End > window.sourceDur {
					continue
				}
				start := window.timeline + word.Start/window.rate
				end := window.timeline + word.End/window.rate
				if end <= start {
					continue
				}
				words = append(words, document.Word{Text: text,
					Start: document.Seconds(start), End: document.Seconds(end)})
			}
		}
	}
	if len(words) == 0 && len(phrases) == 0 {
		return doc, fmt.Errorf("transcription returned no timestamped speech for job %q", job.ID)
	}
	sort.SliceStable(words, func(i, j int) bool { return words[i].Start < words[j].Start })
	deduped := words[:0]
	lastEnd := document.Time(-1)
	for _, word := range words {
		if word.Start < lastEnd {
			continue
		}
		deduped = append(deduped, word)
		lastEnd = word.End
	}
	style := document.DefaultTextStyle()
	style.HighlightMode = "word"
	width, height := 1920.0, 1080.0
	switch doc.Output.Aspect {
	case "portrait", "9:16":
		width, height = 1080, 1920
	case "classic", "4:3":
		width = 1440
	}
	style.X, style.Y = width/2, height*0.8
	if width == 1080 {
		style.Y = height * 0.76
	}
	if missingWordTimes {
		sort.SliceStable(phrases, func(i, j int) bool { return phrases[i].Start < phrases[j].Start })
		return compiler.MaterializePhraseCaptions(doc, job.ID, phrases, style)
	}
	return compiler.MaterializeCaptions(doc, job.ID, deduped, maxWords, style)
}

func captionWindowLanguage(doc document.Document, file, requested string) string {
	if requested != "" {
		return requested
	}
	for _, jobs := range [][]document.Job{doc.Before, doc.Jobs} {
		for _, job := range jobs {
			if job.Type == "speech.generate" && job.ResultAssetID == file && job.Language != "auto" {
				return job.Language
			}
		}
	}
	return ""
}

func pendingMediaJobs(doc document.Document) []document.Job {
	var pending []document.Job
	for _, job := range doc.Jobs {
		if !slices.Contains([]string{"image.generate", "speech.generate", "scene.generate", "scene.edit"}, job.Type) {
			continue
		}
		if job.ResultAssetID != "" {
			continue
		}
		pending = append(pending, job)
	}
	return pending
}

func orchestrationSafeJoin(session, root string) (string, func(string) (string, error)) {
	if session == "" {
		return root, func(name string) (string, error) { return storage.SafeJoinIn(root, name) }
	}
	return root, func(name string) (string, error) {
		return storage.SafeJoinUser(session, name)
	}
}

func materializeMediaJob(ctx context.Context, root, session string, doc document.Document, assets []document.Asset, job document.Job) (document.Document, []document.Asset, error) {
	switch job.Type {
	case "image.generate":
		return materializeImageJob(ctx, root, session, doc, assets, job)
	case "speech.generate":
		return materializeSpeechJob(ctx, root, session, doc, assets, job)
	case "scene.generate", "scene.edit":
		return materializeSceneJob(ctx, root, session, doc, assets, job)
	default:
		return doc, assets, fmt.Errorf("job %q has unsupported type %q", job.ID, job.Type)
	}
}

func setJobResult(doc document.Document, jobID, assetID string) document.Document {
	for index := range doc.Jobs {
		if doc.Jobs[index].ID == jobID {
			doc.Jobs[index].ResultAssetID = assetID
		}
	}
	for index := range doc.Before {
		if doc.Before[index].ID == jobID {
			doc.Before[index].ResultAssetID = assetID
		}
	}
	return doc
}

func materializeImageJob(ctx context.Context, root, session string, doc document.Document, assets []document.Asset, job document.Job) (document.Document, []document.Asset, error) {
	if strings.TrimSpace(job.Prompt) == "" {
		return doc, assets, fmt.Errorf("job %q needs a prompt", job.ID)
	}
	dataDir, safeJoin := orchestrationSafeJoin(session, root)
	windowCtx, cancel := context.WithTimeout(ctx, orchestrationProviderTimeout)
	defer cancel()
	prompt := job.Prompt
	if job.ImageStyle != "" {
		prompt += "\n" + job.ImageStyle
	}
	generated, err := generateImageCall(windowCtx, dataDir, safeJoin, prompt, job.Model, job.Aspect, job.Background)
	if err != nil {
		return doc, assets, err
	}
	path, err := safeJoin(generated.Name)
	if err != nil {
		return doc, assets, err
	}
	version, err := FileVersion(path)
	if err != nil {
		return doc, assets, err
	}
	assets = append(assets, document.Asset{ID: generated.Name, File: generated.Name,
		Version: version, Kind: "image", Width: generated.Width, Height: generated.Height})
	return setJobResult(doc, job.ID, generated.Name), assets, nil
}

func materializeSpeechJob(ctx context.Context, root, session string, doc document.Document, assets []document.Asset, job document.Job) (document.Document, []document.Asset, error) {
	text := strings.TrimSpace(job.Text)
	if text == "" {
		text = strings.TrimSpace(job.Input)
	}
	if text == "" {
		return doc, assets, fmt.Errorf("job %q needs text (or input)", job.ID)
	}
	dataDir, safeJoin := orchestrationSafeJoin(session, root)
	windowCtx, cancel := context.WithTimeout(ctx, orchestrationProviderTimeout)
	defer cancel()
	if job.ReferenceName != "" {
		media.WarmSession(ctx, session, root, job.ReferenceName)
	}
	generated, err := generateSpeechCall(windowCtx, dataDir, safeJoin, speechJobRequest(job))
	if err != nil {
		return doc, assets, err
	}
	path, err := safeJoin(generated.Name)
	if err != nil {
		return doc, assets, err
	}
	version, err := FileVersion(path)
	if err != nil {
		return doc, assets, err
	}
	source, err := media.ResolveSource(root, generated.Name)
	if err != nil {
		return doc, assets, err
	}
	metadata, err := media.LoadMetadata(windowCtx, &mediacache.Default, source, mediacache.Run)
	if err != nil {
		return doc, assets, err
	}
	assets = append(assets, document.Asset{ID: generated.Name, File: generated.Name,
		Version: version, Kind: "audio", Duration: document.Seconds(metadata.Duration), HasAudio: true})
	doc = setJobResult(doc, job.ID, generated.Name)
	for _, jobs := range [][]document.Job{doc.Before, doc.Jobs} {
		for index := range jobs {
			if jobs[index].ID == job.ID && generated.Language != "" {
				jobs[index].Language = generated.Language
			}
		}
	}
	return doc, assets, nil
}
