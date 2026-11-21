package ai

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"

	edittext "ffmpeg-go-server/editengine/text"
	"ffmpeg-go-server/internal/core/editor/render"
	"ffmpeg-go-server/internal/core/editor/speech"
)

const (
	// 500 runes is the server-side safety cap; the model contract asks for
	// 160 (see systemPrompt FINAL CHECK) so normal summaries stay shorter.
	maxSummaryLen = 500
	maxTextLen    = 1000

	// User-facing speech/image text caps: large enough for scripts, small
	// enough to bound TTS and image-model payloads.
	maxSpeechInputRunes = 4000
	maxImagePromptRunes = 4000
	maxImageStyleRunes  = 300

	maxVolumePercent    = 200
	maxUndoCount        = 100
	minItemDuration     = 0.1
	minTransition       = 0.05
	defaultPlaybackRate = 1
	defaultUndoCount    = 1
)

var resultIDPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,31}$`)

type interval struct{ start, end float64 }

type planValidationContext struct {
	project       project
	tracks        map[string]track
	effects       map[string]effect
	texts         map[string]bool
	clips         map[string]clipTarget
	resultIDs     map[string]bool
	finalDuration float64
	deletions     []interval
}

func newPlanValidationContext(plan editPlan, project project) *planValidationContext {
	ctx := &planValidationContext{project: project}

	ctx.tracks = make(map[string]track, len(project.Tracks))
	for _, track := range project.Tracks {
		ctx.tracks[track.ID] = track
	}

	ctx.effects = make(map[string]effect, len(project.Effects))
	for _, effect := range project.Effects {
		ctx.effects[effect.ID] = effect
	}

	ctx.texts = make(map[string]bool, len(project.Texts))
	for _, text := range project.Texts {
		ctx.texts[text.ID] = true
	}

	ctx.clips = clipsAfterDeleteRanges(plan, project)
	ctx.resultIDs = make(map[string]bool)
	ctx.finalDuration = calculateDurationAfterDeleteOp(&plan, project.Duration)
	return ctx
}

func calculateDurationAfterDeleteOp(plan *editPlan, projectDuration float64) float64 {
	deletedClipsDuration := 0.0

	for _, op := range plan.Operations {
		if op.Type == "delete_range" && len(op.ChannelIDs) == 0 && op.Start != nil && op.End != nil && finite(*op.Start, *op.End) {
			deletedClipsDuration += math.Max(0, *op.End-*op.Start)
		}
	}

	return math.Max(0, projectDuration-deletedClipsDuration)
}

func validVolume(v float64) bool {
	return finite(v) && v >= 0 && v <= maxVolumePercent
}

func validDeleteRange(start, end, projectDuration float64) bool {
	return finite(start, end) && start >= 0 && end <= projectDuration+timingEpsilon && end-start >= minItemDuration
}

func endsWithin(start, duration, limit float64) bool {
	return start+duration <= limit+timingEpsilon
}

func validTimedWithin(start, duration, limit float64) bool {
	return validTimedItem(start, duration) && endsWithin(start, duration, limit)
}

func validSplitPoint(time, clipStart, clipEnd float64) bool {
	return time-clipStart >= minItemDuration && clipEnd-time >= minItemDuration
}

func validTimelinePosition(start, end float64) bool {
	return start >= 0 && start <= maxTimeline && end <= maxTimeline
}

func clipsFormJunction(left, right clip) bool {
	return left.Start < right.Start && left.End >= right.Start-minTransition
}

func validatePlan(plan editPlan, project project) error {
	if len(plan.Summary) > maxSummaryLen || len(plan.Operations) > maxOperations || len(plan.ImageJobs) > maxImageJobs || len(plan.SpeechJobs) > maxSpeechJobs {
		return fmt.Errorf("plan is too large: operations=%d (limit %d), summary bytes=%d (limit %d), image jobs=%d (limit %d), speech jobs=%d (limit %d)", len(plan.Operations), maxOperations, len(plan.Summary), maxSummaryLen, len(plan.ImageJobs), maxImageJobs, len(plan.SpeechJobs), maxSpeechJobs)
	}
	if plan.Mode == planModeRecommend && len(plan.Operations) == 0 && len(plan.ImageJobs) == 0 && len(plan.SpeechJobs) == 0 {
		return fmt.Errorf("a recommendation must include at least one executable operation")
	}
	if err := validateImageJobs(plan.ImageJobs, project); err != nil {
		return err
	}
	if err := validateSpeechJobs(plan.SpeechJobs); err != nil {
		return err
	}
	undoCount := 0
	for _, operation := range plan.Operations {
		if operation.Type == "undo" {
			undoCount++
		}
	}
	if undoCount > 0 && (undoCount != 1 || len(plan.Operations) != 1) {
		return fmt.Errorf("undo must be the only operation in a plan")
	}
	ctx := newPlanValidationContext(plan, project)
	for index, operation := range plan.Operations {
		fail := func(message string) error { return fmt.Errorf("operation %d: %s", index+1, message) }
		var err error
		switch operation.Type {
		case "delete_range":
			err = ctx.validateDeleteRange(operation, fail)
		case "add_effect":
			err = ctx.validateAddEffect(operation, fail)
		case "update_effect":
			err = ctx.validateUpdateEffect(operation, fail)
		case "delete_effect":
			err = ctx.validateDeleteEffect(operation, fail)
		case "add_text":
			err = ctx.validateAddText(operation, fail)
		case "update_text":
			err = ctx.validateUpdateText(operation, fail)
		case "delete_text":
			err = ctx.validateDeleteText(operation, fail)
		case "add_media":
			err = ctx.validateAddMedia(operation, fail)
		case "move_clip":
			err = ctx.validateMoveClip(operation, fail)
		case "update_clip":
			err = ctx.validateUpdateClip(operation, fail)
		case "split_clip":
			err = ctx.validateSplitClip(operation, fail)
		case "remove_source_audio":
			err = ctx.validateRemoveSourceAudio(operation, fail)
		case "delete_clip":
			err = ctx.validateDeleteClip(operation, fail)
		case "apply_preset":
			err = ctx.validateApplyPreset(operation, fail)
		case "add_transition", "update_transition":
			err = ctx.validateTransition(operation, fail)
		case "undo":
			err = ctx.validateUndo(operation, fail)
		default:
			err = fail("unknown operation type " + operation.Type)
		}
		if err != nil {
			return err
		}
	}
	if err := ctx.checkDeletionOverlaps(); err != nil {
		return err
	}
	if planContainsUndo(plan) {
		return fmt.Errorf("undo is unavailable for timeline edit plans")
	}
	return nil
}

func validateSpeechJobs(jobs []speechJob) error {
	seen := make(map[string]bool, len(jobs))
	for index, job := range jobs {
		fail := func(message string) error { return fmt.Errorf("speech job %d: %s", index+1, message) }
		if !resultIDPattern.MatchString(job.ID) || seen[job.ID] {
			return fail("id must be valid and unique")
		}
		seen[job.ID] = true
		input := strings.TrimSpace(job.Input)
		if input == "" || !utf8.ValidString(input) || utf8.RuneCountInString(input) > maxSpeechInputRunes {
			return fail(fmt.Sprintf("input must contain between 1 and %d characters", maxSpeechInputRunes))
		}
		validVoice := false
		for _, preset := range speechModelPresets {
			if job.Model == preset.ID {
				validVoice = slices.Contains(preset.Voices, job.Voice)
				break
			}
		}
		if !validVoice {
			return fail("voice is not available for the selected model")
		}
		if err := speech.ValidateRequest(speech.Request{Input: input, Model: job.Model, Voice: job.Voice, Language: job.Language, Instructions: job.Instructions}); err != nil {
			return fail(err.Error())
		}
		if !finite(job.Start) || job.Start < 0 || job.Start > maxTimeline {
			return fail("invalid start time")
		}
		if job.Volume != nil && !validVolume(*job.Volume) {
			return fail(fmt.Sprintf("volume must be between 0 and %d", maxVolumePercent))
		}
	}
	return nil
}

func validateImageJobs(jobs []imageJob, project project) error {
	seen := make(map[string]bool, len(jobs))
	for index, job := range jobs {
		fail := func(message string) error { return fmt.Errorf("image job %d: %s", index+1, message) }
		if !resultIDPattern.MatchString(job.ID) || seen[job.ID] {
			return fail("id must be valid and unique")
		}
		seen[job.ID] = true
		prompt := strings.TrimSpace(job.Prompt)
		if prompt == "" || !utf8.ValidString(prompt) || utf8.RuneCountInString(prompt) > maxImagePromptRunes {
			return fail(fmt.Sprintf("prompt must contain between 1 and %d characters", maxImagePromptRunes))
		}
		if utf8.RuneCountInString(job.Style) > maxImageStyleRunes {
			return fail(fmt.Sprintf("style must contain at most %d characters", maxImageStyleRunes))
		}
		if !oneOf(job.Placement, "media-bin", "overlay") {
			return fail("unknown placement")
		}
		if !oneOf(job.Position, "left", "center", "right") {
			return fail("unknown position")
		}
		if !finite(job.Start, job.Duration) || job.Start < 0 || job.Start > maxTimeline || job.Duration < 0.2 || job.Start+job.Duration > maxTimeline {
			return fail("invalid timing")
		}
		if !oneOf(job.Background, "auto", "transparent", "opaque") {
			return fail("unknown background mode")
		}
		if !oneOf(job.Quality, "auto", "low", "medium", "high") {
			return fail("unknown quality")
		}
		if !presetID(transformPresets, job.MotionPreset) {
			return fail("unknown motion preset " + job.MotionPreset)
		}
		if job.Opacity != nil && (!finite(*job.Opacity) || *job.Opacity < 0 || *job.Opacity > 1) {
			return fail("opacity must be between 0 and 1")
		}
		if job.Fade != nil && (!finite(*job.Fade) || *job.Fade < 0 || *job.Fade > job.Duration/2+timingEpsilon) {
			return fail("fade must fit within half the image duration")
		}
		if job.SourceName != "" && !editableProxyImage(project.Sources, job.SourceName) {
			return fail("sourceName must identify a Proxy image")
		}
	}
	return nil
}

func editableProxyImage(sources []mediaSource, name string) bool {
	for _, source := range sources {
		if strings.EqualFold(source.Name, name) {
			return source.Kind == mediaKindImage && source.SourceMode == "proxy"
		}
	}
	return false
}

func (ctx *planValidationContext) checkDeletionOverlaps() error {
	sort.Slice(ctx.deletions, func(i, j int) bool { return ctx.deletions[i].start < ctx.deletions[j].start })
	for i := 1; i < len(ctx.deletions); i++ {
		if ctx.deletions[i].start < ctx.deletions[i-1].end {
			return fmt.Errorf("delete ranges overlap")
		}
	}
	return nil
}

func (ctx *planValidationContext) validateDeleteRange(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "start", "end", "channelIds") {
		return fail("unsupported delete_range fields")
	}
	if operation.Start == nil || operation.End == nil {
		return fail("delete range requires start and end")
	}
	if !validDeleteRange(*operation.Start, *operation.End, ctx.project.Duration) {
		return fail("invalid delete range")
	}
	for _, id := range operation.ChannelIDs {
		track, ok := ctx.tracks[id]
		if !ok || track.Locked {
			return fail("unknown or locked channel " + id)
		}
	}
	ctx.deletions = append(ctx.deletions, interval{*operation.Start, *operation.End})
	return nil
}

func (ctx *planValidationContext) validateAddEffect(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "channelId", "effectId", "start", "duration", "params") {
		return fail("unsupported add_effect fields")
	}
	track, ok := ctx.tracks[operation.ChannelID]
	if !ok || track.Locked {
		return fail("unknown or locked effect channel")
	}
	if track.Type != trackTypeVideo {
		return fail("effects require a video channel")
	}
	if operation.Start == nil || operation.Duration == nil {
		return fail("add_effect requires start and duration")
	}
	if !validTimedWithin(*operation.Start, *operation.Duration, ctx.finalDuration) {
		return fail("invalid effect target or timing")
	}
	if err := render.ValidateEffect(operation.EffectID, operation.Params); err != nil {
		return fail(err.Error())
	}
	return nil
}

func (ctx *planValidationContext) validateUpdateEffect(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "blockId", "start", "duration", "params") {
		return fail("unsupported update_effect fields")
	}
	effect, ok := ctx.effects[operation.BlockID]
	if !ok || ctx.tracks[effect.TrackID].Locked {
		return fail("unknown effect block " + operation.BlockID)
	}
	start, duration := effect.Start, effect.Duration
	if operation.Start != nil {
		start = *operation.Start
	}
	if operation.Duration != nil {
		duration = *operation.Duration
	}
	if !validTimedWithin(start, duration, ctx.finalDuration) {
		return fail("invalid effect timing")
	}
	if err := render.ValidateEffect(effect.Preset, operation.Params); err != nil {
		return fail(err.Error())
	}
	if operation.Start == nil && operation.Duration == nil && len(operation.Params) == 0 {
		return fail("empty effect update")
	}
	return nil
}

func (ctx *planValidationContext) validateDeleteEffect(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "blockId") {
		return fail("unsupported delete_effect fields")
	}
	effect, ok := ctx.effects[operation.BlockID]
	if !ok || ctx.tracks[effect.TrackID].Locked {
		return fail("unknown effect block " + operation.BlockID)
	}
	return nil
}

func (ctx *planValidationContext) validateAddText(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "start", "duration", "text", "textPresetId", "style") {
		return fail("unsupported add_text fields")
	}
	if operation.Start == nil || operation.Duration == nil || operation.Text == nil {
		return fail("add_text requires start, duration and text")
	}
	if !validTimedWithin(*operation.Start, *operation.Duration, ctx.finalDuration) {
		return fail("invalid text item")
	}
	if len(*operation.Text) > maxTextLen {
		return fail("text is too long")
	}
	if err := edittext.ValidateEncoding(*operation.Text); err != nil {
		return fail(err.Error())
	}
	if operation.TextPresetID != "" && !presetID(textPresets, operation.TextPresetID) {
		return fail("unknown text preset " + operation.TextPresetID)
	}
	if err := validateTextStyle(operation.Style, ctx.project.Aspect); err != nil {
		return fail(err.Error())
	}
	if isCaptionText(operation.TextPresetID, operation.Style) && captionWordCount(*operation.Text) > maxAICaptionWords {
		return fail("caption text must contain at most 5 words per caption; split longer lines into sequential captions")
	}
	return nil
}

func (ctx *planValidationContext) validateUpdateText(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "textId", "start", "duration", "text", "textPresetId", "style") {
		return fail("unsupported update_text fields")
	}
	if !ctx.texts[operation.TextID] {
		return fail("unknown text item " + operation.TextID)
	}
	current := findText(ctx.project.Texts, operation.TextID)
	start, duration := current.Start, current.Duration
	if operation.Start != nil {
		start = *operation.Start
	}
	if operation.Duration != nil {
		duration = *operation.Duration
	}
	if !validTimedWithin(start, duration, ctx.finalDuration) {
		return fail("invalid text update")
	}
	if operation.Text != nil && len(*operation.Text) > maxTextLen {
		return fail("text is too long")
	}
	if operation.Text != nil {
		if err := edittext.ValidateEncoding(*operation.Text); err != nil {
			return fail(err.Error())
		}
	}
	if operation.Start == nil && operation.Duration == nil && operation.Text == nil && operation.TextPresetID == "" && operation.Style == nil {
		return fail("empty text update")
	}
	if operation.TextPresetID != "" && !presetID(textPresets, operation.TextPresetID) {
		return fail("unknown text preset " + operation.TextPresetID)
	}
	if err := validateTextStyle(operation.Style, ctx.project.Aspect); err != nil {
		return fail(err.Error())
	}
	if operation.Text != nil && isCaptionText(operation.TextPresetID, operation.Style) && captionWordCount(*operation.Text) > maxAICaptionWords {
		return fail("caption text must contain at most 5 words per caption; split longer lines into sequential captions")
	}
	return nil
}

func isCaptionText(presetID string, style *textStyle) bool {
	if presetID != "" && oneOf(presetID, captionPresetIDs...) {
		return true
	}
	return style != nil && style.IsCaption != nil && *style.IsCaption
}

func captionWordCount(text string) int {
	return len(strings.Fields(text))
}

func (ctx *planValidationContext) validateDeleteText(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "textId") {
		return fail("unsupported delete_text fields")
	}
	if !ctx.texts[operation.TextID] {
		return fail("unknown text item " + operation.TextID)
	}
	return nil
}

func (ctx *planValidationContext) validateAddMedia(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "sourceId", "resultId", "channelId", "start", "sourceIn", "sourceOut", "playbackRate", "volume", "includeAudio") {
		return fail("unsupported add_media fields")
	}
	if !resultIDPattern.MatchString(operation.ResultID) {
		return fail("add_media requires a valid resultId")
	}
	if ctx.resultIDs[operation.ResultID] {
		return fail("add_media resultId is not unique")
	}
	if _, exists := ctx.clips[operation.ResultID]; exists {
		return fail("add_media resultId conflicts with an existing clip")
	}
	source, ok := sourceByID(ctx.project.Sources, operation.SourceID)
	if len(ctx.project.Sources) == 0 || !ok {
		return fail("add_media requires a known sourceId and non-empty source list")
	}
	if operation.IncludeAudio == nil || source.Kind != mediaKindVideo && *operation.IncludeAudio {
		return fail("add_media requires an explicit valid includeAudio choice")
	}
	track, ok := ctx.tracks[operation.ChannelID]
	if !ok || track.Locked {
		return fail("invalid or locked media channel")
	}
	if source.Kind == mediaKindAudio && track.Type != trackTypeAudio || source.Kind != mediaKindAudio && track.Type != trackTypeVideo {
		return fail("media kind does not match channel type")
	}
	if operation.Start == nil || operation.SourceIn == nil || operation.SourceOut == nil {
		return fail("add_media requires start, sourceIn and sourceOut")
	}
	start, sourceIn, sourceOut := *operation.Start, *operation.SourceIn, *operation.SourceOut
	rate := valueOr(operation.PlaybackRate, defaultPlaybackRate)
	if err := validateClipWindow(ctx.project, clipTarget{Clip: clip{SourceID: source.ID, SourceOut: source.Duration, Name: source.Name}}, start, sourceIn, sourceOut, rate); err != nil {
		return fail("invalid media source window or timing")
	}
	if operation.Volume != nil && !validVolume(*operation.Volume) {
		return fail("media volume is out of range")
	}
	ctx.resultIDs[operation.ResultID] = true
	ctx.clips[operation.ResultID] = clipTarget{Track: track, Clip: clip{ID: operation.ResultID, Name: source.Name, SourceID: source.ID, MediaKind: source.Kind, Start: start, End: start + (sourceOut-sourceIn)/rate, SourceIn: sourceIn, SourceOut: sourceOut, Rate: rate}}
	return nil
}

func (ctx *planValidationContext) validateMoveClip(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "clipId", "channelId", "start", "delta") {
		return fail("unsupported move_clip fields")
	}
	target, ok := ctx.clips[operation.ClipID]
	if !ok || target.Track.Locked {
		return fail("unknown, locked, or mismatched clip channel")
	}
	if operation.ChannelID != "" && operation.ChannelID != target.Track.ID {
		return fail("unknown, locked, or mismatched clip channel")
	}
	if (operation.Start == nil) == (operation.Delta == nil) {
		return fail("move_clip requires exactly one of start or delta")
	}
	start := target.Clip.Start
	if operation.Start != nil {
		if !finite(*operation.Start) || *operation.Start < 0 || *operation.Start > maxTimeline {
			return fail("clip move is out of range")
		}
		start = *operation.Start
	} else {
		if !finite(*operation.Delta) || math.Abs(*operation.Delta) > maxTimeline {
			return fail("clip move is out of range")
		}
		start += *operation.Delta
	}
	if !validTimelinePosition(start, start+target.Clip.End-target.Clip.Start) {
		return fail("clip move is out of range")
	}
	duration := target.Clip.End - target.Clip.Start
	target.Clip.Start, target.Clip.End = start, start+duration
	ctx.clips[operation.ClipID] = target
	return nil
}

func (ctx *planValidationContext) validateUpdateClip(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "clipId", "start", "inPoint", "outPoint", "playbackRate", "volume", "transform", "motionPreset") {
		return fail("unsupported update_clip fields")
	}
	target, ok := ctx.clips[operation.ClipID]
	if !ok || target.Track.Locked {
		return fail("unknown or locked clip " + operation.ClipID)
	}
	if operation.Start == nil && operation.InPoint == nil && operation.OutPoint == nil && operation.PlaybackRate == nil && operation.Volume == nil && operation.Transform == nil && operation.MotionPreset == "" {
		return fail("empty clip update")
	}
	start, sourceIn, sourceOut, rate := target.Clip.Start, target.Clip.SourceIn, target.Clip.SourceOut, target.Clip.Rate
	if operation.Start != nil {
		start = *operation.Start
	}
	if operation.InPoint != nil {
		sourceIn = *operation.InPoint
	}
	if operation.OutPoint != nil {
		sourceOut = *operation.OutPoint
	}
	if operation.PlaybackRate != nil {
		rate = *operation.PlaybackRate
	}
	if err := validateClipWindow(ctx.project, target, start, sourceIn, sourceOut, rate); err != nil {
		return fail("invalid clip timing or source window")
	}
	if operation.Volume != nil && !validVolume(*operation.Volume) {
		return fail("clip volume is out of range")
	}
	if target.Track.Type != trackTypeVideo && (operation.Transform != nil || operation.MotionPreset != "") {
		return fail("audio clips cannot receive transform changes")
	}
	if err := validateTransform(operation.Transform); err != nil {
		return fail(err.Error())
	}
	if operation.MotionPreset != "" && !presetID(transformPresets, operation.MotionPreset) {
		return fail("unknown motion preset " + operation.MotionPreset)
	}
	target.Clip.Start, target.Clip.SourceIn, target.Clip.SourceOut, target.Clip.Rate = start, sourceIn, sourceOut, rate
	target.Clip.End = start + (sourceOut-sourceIn)/rate
	ctx.clips[operation.ClipID] = target
	return nil
}

func (ctx *planValidationContext) validateSplitClip(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "clipId", "time") {
		return fail("unsupported split_clip fields")
	}
	target, ok := ctx.clips[operation.ClipID]
	if !ok || target.Track.Locked {
		return fail("unknown or locked clip " + operation.ClipID)
	}
	if operation.Time == nil || !finite(*operation.Time) || !validSplitPoint(*operation.Time, target.Clip.Start, target.Clip.End) {
		return fail("invalid clip split")
	}
	if target.Clip.LinkedID != "" {
		if linked, linkedOK := ctx.clips[target.Clip.LinkedID]; !linkedOK || linked.Track.Locked {
			return fail("linked clip cannot be split")
		}
	}
	target.Clip.End = *operation.Time
	ctx.clips[operation.ClipID] = target
	return nil
}

func (ctx *planValidationContext) validateRemoveSourceAudio(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "clipId") {
		return fail("unsupported remove_source_audio fields")
	}
	target, ok := ctx.clips[operation.ClipID]
	if !ok || target.Track.Locked {
		return fail("unknown or locked clip " + operation.ClipID)
	}
	if target.Track.Type != trackTypeVideo || target.Clip.LinkedID == "" {
		return fail("video has no removable linked source audio")
	}
	linked, linkedOK := ctx.clips[target.Clip.LinkedID]
	if !linkedOK || linked.Track.Locked || linked.Track.Type != trackTypeAudio {
		return fail("video has no removable linked source audio")
	}
	target.Clip.LinkedID = ""
	ctx.clips[operation.ClipID] = target
	delete(ctx.clips, linked.Clip.ID)
	return nil
}

func (ctx *planValidationContext) validateDeleteClip(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "clipId") {
		return fail("unsupported delete_clip fields")
	}
	target, ok := ctx.clips[operation.ClipID]
	if !ok || target.Track.Locked {
		return fail("unknown or locked clip " + operation.ClipID)
	}
	if target.Track.Type == trackTypeAudio && target.Clip.LinkedID != "" {
		if linked, linkedOK := ctx.clips[target.Clip.LinkedID]; linkedOK && linked.Track.Type == trackTypeVideo {
			return fail("use remove_source_audio to delete linked audio without deleting its video")
		}
	}
	if target.Clip.LinkedID != "" {
		if linked, linkedOK := ctx.clips[target.Clip.LinkedID]; linkedOK {
			if linked.Track.Locked {
				return fail("linked clip is on a locked channel")
			}
			delete(ctx.clips, linked.Clip.ID)
		}
	}
	delete(ctx.clips, operation.ClipID)
	return nil
}

func (ctx *planValidationContext) validateApplyPreset(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "clipId", "presetId") {
		return fail("unsupported apply_preset fields")
	}
	target, ok := ctx.clips[operation.ClipID]
	if !ok || target.Track.Locked || target.Track.Type != trackTypeVideo {
		return fail("unknown, locked, or non-video clip")
	}
	if !presetID(clipPresets, operation.PresetID) {
		return fail("unknown clip preset " + operation.PresetID)
	}
	return nil
}

func (ctx *planValidationContext) validateTransition(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "channelId", "leftClipId", "rightClipId", "effectId", "duration") {
		return fail("unsupported transition fields")
	}
	if _, ok := transitionPresets[operation.EffectID]; !ok {
		return fail("invalid transition preset or duration")
	}
	if operation.Duration == nil || !finite(*operation.Duration) || *operation.Duration < minTransition {
		return fail("invalid transition preset or duration")
	}
	left, leftOK := ctx.clips[operation.LeftClipID]
	right, rightOK := ctx.clips[operation.RightClipID]
	if !leftOK || !rightOK || left.Track.ID != operation.ChannelID || right.Track.ID != operation.ChannelID || left.Track.ID != right.Track.ID {
		return fail("invalid or locked transition clips")
	}
	if left.Track.Type != trackTypeVideo || left.Track.Locked || !clipsAreAdjacent(ctx.clips, operation.ChannelID, operation.LeftClipID, operation.RightClipID) {
		return fail("invalid or locked transition clips")
	}
	if !clipsFormJunction(left.Clip, right.Clip) {
		return fail("transition clips are not a junction")
	}
	maxOverlap := maxTransitionOverlap(ctx.project, left.Clip, right.Clip)
	if *operation.Duration > maxOverlap+timingEpsilon {
		return fail(fmt.Sprintf("transition duration %.3gs exceeds the %.3gs limit for these clips", *operation.Duration, maxOverlap))
	}
	return nil
}

func (ctx *planValidationContext) validateUndo(operation editOperation, fail func(string) error) error {
	if !hasEditOperationFields(operation, "count") {
		return fail("unsupported undo fields")
	}
	count := defaultUndoCount
	if operation.Count != nil {
		count = *operation.Count
	}
	if count < 1 || count > maxUndoCount {
		return fail(fmt.Sprintf("undo count must be between 1 and %d", maxUndoCount))
	}
	return nil
}
