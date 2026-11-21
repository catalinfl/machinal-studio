package ai

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
)

const deleteFragmentPrefix = "__delete_fragment_"

var duplicateMediaPattern = regexp.MustCompile(`(?:^| )(?:[2-9]|[1-9]\d+|two|three|four|five|six|seven|eight|nine|doua|trei|patru|cinci|sase|sapte|opt|noua) (?:copies|times|copii|ori)(?: |$)`)

func junctionKey(leftID, rightID string) string {
	return leftID + "\x00" + rightID
}

func isVisualClip(project project, target clipTarget) bool {
	return target.Track.Type == trackTypeVideo && clipMediaKind(project, target.Clip) != mediaKindAudio
}

type instructionValidationContext struct {
	instruction string
	plan        editPlan
	project     project
}

func newInstructionValidationContext(instruction string, plan editPlan, project project) *instructionValidationContext {
	return &instructionValidationContext{
		instruction: instruction,
		plan:        plan,
		project:     project,
	}
}

func (ctx *instructionValidationContext) validateRequestedImageSequence() error {
	if !requestsEveryImage(ctx.instruction) {
		return nil
	}
	requestedDuration, hasDuration := requestedImageDuration(ctx.instruction)
	transitionDuration, hasTransition := requestedTransitionDuration(ctx.instruction)
	finalClips := finalClipTargets(ctx.plan, ctx.project)
	imagesBySource := make(map[string]clipTarget)
	for _, target := range finalClips {
		source, ok := sourceForClip(ctx.project, target.Clip)
		if !ok || source.Kind != mediaKindImage {
			continue
		}
		current, exists := imagesBySource[source.ID]
		if !exists || target.Clip.Start < current.Clip.Start {
			imagesBySource[source.ID] = target
		}
	}
	imageCount := 0
	for _, source := range ctx.project.Sources {
		if source.Kind != mediaKindImage {
			continue
		}
		if image, ok := imagesBySource[source.ID]; ok {
			imageCount++
			if hasDuration && !approxEqual(image.Clip.End-image.Clip.Start, requestedDuration) {
				return fmt.Errorf("instruction requires %.3g seconds from each image", requestedDuration)
			}
		}
	}
	if !hasTransition || imageCount < 2 {
		return nil
	}
	junctions := make(map[string]float64)
	for _, transition := range ctx.project.Transitions {
		junctions[junctionKey(transition.LeftClipID, transition.RightClipID)] = transition.Duration
	}
	for _, operation := range ctx.plan.Operations {
		if operation.Type != "add_transition" && operation.Type != "update_transition" || operation.Duration == nil {
			continue
		}
		junctions[junctionKey(operation.LeftClipID, operation.RightClipID)] = *operation.Duration
	}
	for _, track := range ctx.project.Tracks {
		ordered := sortedTrackClips(finalClips, track.ID)
		for index := 0; index < len(ordered)-1; index++ {
			left, right := ordered[index], ordered[index+1]
			if strings.HasPrefix(left.Clip.ID, deleteFragmentPrefix) || strings.HasPrefix(right.Clip.ID, deleteFragmentPrefix) {
				continue
			}
			leftSource, leftOK := sourceForClip(ctx.project, left.Clip)
			rightSource, rightOK := sourceForClip(ctx.project, right.Clip)
			if !leftOK || !rightOK || leftSource.Kind != mediaKindImage || rightSource.Kind != mediaKindImage {
				continue
			}
			duration, ok := junctions[junctionKey(left.Clip.ID, right.Clip.ID)]
			if !ok {
				return fmt.Errorf("instruction requires a %.3g-second transition between every consecutive image", transitionDuration)
			}
			if !approxEqual(duration, transitionDuration) {
				return fmt.Errorf("instruction requires %.3g-second transitions between images", transitionDuration)
			}
		}
	}
	return nil
}

func finalClipTargets(plan editPlan, project project) map[string]clipTarget {
	clips := clipsAfterDeleteRanges(plan, project)
	for _, operation := range plan.Operations {
		switch operation.Type {
		case "delete_range":
			continue
		case "add_media":
			source, sourceOK := sourceByID(project.Sources, operation.SourceID)
			track, trackOK := trackByID(project.Tracks, operation.ChannelID)
			if !sourceOK || !trackOK || operation.Start == nil || operation.SourceIn == nil || operation.SourceOut == nil {
				continue
			}
			rate := valueOr(operation.PlaybackRate, defaultPlaybackRate)
			if rate <= 0 {
				continue
			}
			clips[operation.ResultID] = clipTarget{Track: track, Clip: clip{ID: operation.ResultID, Name: source.Name, SourceID: source.ID, SourceDuration: source.Duration, MediaKind: source.Kind, Start: *operation.Start, End: *operation.Start + (*operation.SourceOut-*operation.SourceIn)/rate, SourceIn: *operation.SourceIn, SourceOut: *operation.SourceOut, Rate: rate}}
		case "move_clip":
			target, ok := clips[operation.ClipID]
			if !ok {
				continue
			}
			start := target.Clip.Start
			if operation.Start != nil {
				start = *operation.Start
			} else if operation.Delta != nil {
				start += *operation.Delta
			}
			duration := target.Clip.End - target.Clip.Start
			target.Clip.Start, target.Clip.End = start, start+duration
			clips[operation.ClipID] = target
		case "update_clip":
			target, ok := clips[operation.ClipID]
			if !ok {
				continue
			}
			if operation.Start != nil {
				target.Clip.Start = *operation.Start
			}
			if operation.InPoint != nil {
				target.Clip.SourceIn = *operation.InPoint
			}
			if operation.OutPoint != nil {
				target.Clip.SourceOut = *operation.OutPoint
			}
			if operation.PlaybackRate != nil {
				target.Clip.Rate = *operation.PlaybackRate
			}
			if target.Clip.Rate > 0 {
				target.Clip.End = target.Clip.Start + (target.Clip.SourceOut-target.Clip.SourceIn)/target.Clip.Rate
			}
			clips[operation.ClipID] = target
		case "remove_source_audio":
			if target, ok := clips[operation.ClipID]; ok && target.Clip.LinkedID != "" {
				delete(clips, target.Clip.LinkedID)
			}
		case "delete_clip":
			if target, ok := clips[operation.ClipID]; ok && target.Clip.LinkedID != "" {
				delete(clips, target.Clip.LinkedID)
			}
			delete(clips, operation.ClipID)
		}
	}
	return clips
}

func deleteRangeTargetsTrack(operation editOperation, track track) bool {
	return !track.Locked && (len(operation.ChannelIDs) == 0 || slices.Contains(operation.ChannelIDs, track.ID))
}

func existingClipSurvivesPlan(plan editPlan, track track, clip clip) bool {
	type interval struct{ start, end float64 }
	intervals := make([]interval, 0)
	for _, operation := range plan.Operations {
		if operation.Type == "delete_clip" && (operation.ClipID == clip.ID || operation.ClipID == clip.LinkedID) {
			return false
		}
		if operation.Type != "delete_range" || operation.Start == nil || operation.End == nil || !deleteRangeTargetsTrack(operation, track) {
			continue
		}
		start := math.Max(clip.Start, *operation.Start)
		end := math.Min(clip.End, *operation.End)
		if end > start {
			intervals = append(intervals, interval{start: start, end: end})
		}
	}
	sort.Slice(intervals, func(i, j int) bool { return intervals[i].start < intervals[j].start })
	covered := 0.0
	for index := 0; index < len(intervals); {
		end := intervals[index].end
		start := intervals[index].start
		index++
		for index < len(intervals) && intervals[index].start <= end+timingEpsilon {
			end = math.Max(end, intervals[index].end)
			index++
		}
		covered += end - start
	}
	return covered < clip.End-clip.Start-timingEpsilon
}

func clipsAfterDeleteRanges(plan editPlan, project project) map[string]clipTarget {
	clips := clipTargets(project)
	deletions := make([]editOperation, 0)
	for _, operation := range plan.Operations {
		if operation.Type == "delete_range" && operation.Start != nil && operation.End != nil {
			deletions = append(deletions, operation)
		}
	}
	sort.Slice(deletions, func(i, j int) bool { return *deletions[i].Start > *deletions[j].Start })
	fragment := 0
	for _, deletion := range deletions {
		start, end := *deletion.Start, *deletion.End
		amount := end - start
		if amount <= 0 {
			continue
		}
		type clipEntry struct {
			id     string
			target clipTarget
		}
		entries := make([]clipEntry, 0, len(clips))
		for id, target := range clips {
			entries = append(entries, clipEntry{id: id, target: target})
		}
		for _, entry := range entries {
			id, target := entry.id, entry.target
			if !deleteRangeTargetsTrack(deletion, target.Track) {
				continue
			}
			clip := target.Clip
			if clip.End <= start {
				continue
			}
			if clip.Start >= end {
				clip.Start -= amount
				clip.End -= amount
				target.Clip = clip
				clips[id] = target
				continue
			}
			rate := clip.Rate
			if rate <= 0 {
				rate = 1
			}
			if clip.Start < start && clip.End > end {
				right := target
				fragment++
				right.Clip.ID = fmt.Sprintf("%s%d", deleteFragmentPrefix, fragment)
				right.Clip.Start = start
				right.Clip.End = clip.End - amount
				right.Clip.SourceIn = clip.SourceIn + (end-clip.Start)*rate
				right.Clip.LinkedID = ""
				clips[right.Clip.ID] = right
				clip.End = start
				clip.SourceOut = clip.SourceIn + (start-clip.Start)*rate
				target.Clip = clip
				clips[id] = target
				continue
			}
			if clip.Start < start && clip.End > start {
				clip.End = start
				clip.SourceOut = clip.SourceIn + (start-clip.Start)*rate
				target.Clip = clip
				clips[id] = target
				continue
			}
			if clip.Start < end && clip.End > end {
				clip.SourceIn += (end - clip.Start) * rate
				clip.Start = start
				clip.End -= amount
				target.Clip = clip
				clips[id] = target
				continue
			}
			delete(clips, id)
		}
	}
	return clips
}

func sortedTrackClips(clips map[string]clipTarget, trackID string) []clipTarget {
	result := make([]clipTarget, 0)
	for _, target := range clips {
		if target.Track.ID == trackID {
			result = append(result, target)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if !approxEqual(result[i].Clip.Start, result[j].Clip.Start) {
			return result[i].Clip.Start < result[j].Clip.Start
		}
		if !approxEqual(result[i].Clip.End, result[j].Clip.End) {
			return result[i].Clip.End < result[j].Clip.End
		}
		return result[i].Clip.ID < result[j].Clip.ID
	})
	return result
}

func clipsAreAdjacent(clips map[string]clipTarget, trackID, leftID, rightID string) bool {
	ordered := sortedTrackClips(clips, trackID)
	for index := 0; index < len(ordered)-1; index++ {
		if ordered[index].Clip.ID == leftID && ordered[index+1].Clip.ID == rightID {
			return true
		}
	}
	return false
}

func requestsDuplicateMedia(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, phrase := range []string{"again", "another copy", "twice", "duplicate", "repeat", "multiple copies", "several copies", "inca o data", "inca o copie", "de doua ori", "mai multe copii", "duplica", "repeta"} {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return duplicateMediaPattern.MatchString(normalized)
}

func (ctx *instructionValidationContext) validateRequestedMediaSources() error {
	requested := make(map[string]mediaSource)
	requestedByKind := make(map[mediaKind]map[string]bool)
	mentionedSourceIDs := specificallyMentionedSourceIDs(ctx.instruction, ctx.project.Sources)
	namedAudio, hasNamedAudio, ambiguousAudio := bestMentionedSource(ctx.instruction, ctx.project.Sources, mediaKindAudio)
	if ambiguousAudio {
		return fmt.Errorf("instruction matches multiple audio sources; use a more specific song name")
	}
	for _, source := range ctx.project.Sources {
		namedSource := mentionedSourceIDs[source.ID]
		if source.Kind == mediaKindAudio && hasNamedAudio {
			namedSource = source.ID == namedAudio.ID
		}
		if namedSource || source.Kind == mediaKindImage && requestsEveryImage(ctx.instruction) {
			requested[source.ID] = source
			if requestedByKind[source.Kind] == nil {
				requestedByKind[source.Kind] = make(map[string]bool)
			}
			requestedByKind[source.Kind][source.ID] = true
		}
	}
	if len(requested) == 0 {
		return nil
	}
	existing := make(map[string]bool)
	for _, track := range ctx.project.Tracks {
		for _, clip := range track.Clips {
			if existingClipSurvivesPlan(ctx.plan, track, clip) {
				if source, ok := sourceForClip(ctx.project, clip); ok {
					existing[source.ID] = true
				}
			}
		}
	}
	added := make(map[string]bool)
	for _, operation := range ctx.plan.Operations {
		if operation.Type != "add_media" {
			continue
		}
		source, ok := sourceByID(ctx.project.Sources, operation.SourceID)
		if !ok {
			continue
		}
		if kindSources := requestedByKind[source.Kind]; len(kindSources) > 0 && !kindSources[source.ID] {
			return fmt.Errorf("instruction names specific %s media, but add_media selected %s", source.Kind, source.Name)
		}
		if requested[source.ID].ID != "" && !requestsDuplicateMedia(ctx.instruction) {
			if existing[source.ID] {
				return fmt.Errorf("source %s is already on the timeline; use its existing clip ID instead of add_media", source.Name)
			}
			if added[source.ID] {
				return fmt.Errorf("source %s must be added only once", source.Name)
			}
		}
		added[source.ID] = true
	}
	represented := make(map[string]bool)
	for _, target := range finalClipTargets(ctx.plan, ctx.project) {
		if source, ok := sourceForClip(ctx.project, target.Clip); ok {
			represented[source.ID] = true
		}
	}
	for id, source := range requested {
		if !represented[id] {
			return fmt.Errorf("instruction requires timeline media for source %s", source.Name)
		}
	}
	return nil
}

type sourceRangeCandidate struct {
	SourceIn, SourceOut float64
	Start, End          int
}

const sourceTimeUnit = durationUnitPattern

var sourceRangePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?:from|de\s+la|between|intre)\s+(?:` + sourceTimeUnit + `\s+)?(\d+(?:[.,]\d+)?)\s*(?:` + sourceTimeUnit + `)?\s*(?:to|la|and|si)\s+(?:` + sourceTimeUnit + `\s+)?(\d+(?:[.,]\d+)?)\s*(?:` + sourceTimeUnit + `)?`),
	regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(?:` + sourceTimeUnit + `)?\s*(?:-|to|la)\s*(?:` + sourceTimeUnit + `\s+)?(\d+(?:[.,]\d+)?)\s*` + sourceTimeUnit),
}

var (
	segmentDurationBeforeRange = regexp.MustCompile(`(?:cuts?|cut[ -]?uri|clips?|clip[ -]?uri|segments?|segmente|secvente|bucati|momente|highlights?|shots?)\s+(?:de|of|for|lasting|a cate)\s*$`)
	segmentDurationAfterRange  = regexp.MustCompile(`^\s*(?:each|fiecare|per\s+(?:cut|clip|segment)|cuts?|cut[ -]?uri|clips?|clip[ -]?uri|segments?|segmente|secvente|bucati)\b`)
)

func isSegmentDurationRange(instruction string, start, end int) bool {
	before := instruction[max(0, start-64):start]
	after := instruction[end:min(len(instruction), end+64)]
	return segmentDurationBeforeRange.MatchString(before) || segmentDurationAfterRange.MatchString(after)
}

func requestedSourceRanges(instruction string) []sourceRangeCandidate {
	normalized := normalizeIntentText(instruction)
	if (strings.Contains(normalized, "split at") || strings.Contains(normalized, "razor") || strings.Contains(normalized, "taie la")) &&
		!strings.Contains(normalized, "source") && !strings.Contains(normalized, "sursa") &&
		!strings.Contains(normalized, "portiunea") && !strings.Contains(normalized, "portion") {
		return nil
	}

	folded := foldIntentText(instruction)
	ranges := make([]sourceRangeCandidate, 0)
	for _, pattern := range sourceRangePatterns {
		for _, match := range pattern.FindAllStringSubmatchIndex(folded, -1) {
			if len(match) != 6 {
				continue
			}
			if isSegmentDurationRange(folded, match[0], match[1]) {
				continue
			}
			start, startErr := strconv.ParseFloat(strings.ReplaceAll(folded[match[2]:match[3]], ",", "."), 64)
			end, endErr := strconv.ParseFloat(strings.ReplaceAll(folded[match[4]:match[5]], ",", "."), 64)
			if startErr != nil || endErr != nil || start < 0 || end <= start {
				continue
			}
			candidate := sourceRangeCandidate{SourceIn: start, SourceOut: end, Start: match[0], End: match[1]}
			duplicate := false
			for _, existing := range ranges {
				if approxEqual(existing.SourceIn, start) && approxEqual(existing.SourceOut, end) && existing.Start < candidate.End && candidate.Start < existing.End {
					duplicate = true
					break
				}
			}
			if !duplicate {
				ranges = append(ranges, candidate)
			}
		}
	}
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].Start < ranges[j].Start })
	return ranges
}

func requestedSourceRange(instruction string) (float64, float64, bool) {
	ranges := requestedSourceRanges(instruction)
	if len(ranges) == 0 {
		return 0, 0, false
	}
	return ranges[0].SourceIn, ranges[0].SourceOut, true
}

func sourceMentionSpan(instruction, name string) (int, int, bool) {
	if dot := strings.LastIndex(name, "."); dot > 0 {
		name = name[:dot]
	}
	folded := foldIntentText(instruction)
	tokens := strings.Fields(normalizeIntentText(name))
	if len(tokens) > 0 {
		parts := make([]string, len(tokens))
		for index, token := range tokens {
			parts[index] = regexp.QuoteMeta(token)
		}
		pattern := regexp.MustCompile(`(?:^|[^a-z0-9])` + strings.Join(parts, `[^a-z0-9]+`) + `(?:$|[^a-z0-9])`)
		if span := pattern.FindStringIndex(folded); span != nil {
			return span[0], span[1], true
		}
	}

	bestStart, bestEnd := 0, 0
	for word := range distinctiveSourceWords(name) {
		pattern := regexp.MustCompile(`(?:^|[^a-z0-9])` + regexp.QuoteMeta(word) + `(?:$|[^a-z0-9])`)
		if span := pattern.FindStringIndex(folded); span != nil && span[1]-span[0] > bestEnd-bestStart {
			bestStart, bestEnd = span[0], span[1]
		}
	}
	return bestStart, bestEnd, bestEnd > bestStart
}

func requestedSourceRangesByID(instruction string, sources []mediaSource, ranges []sourceRangeCandidate) map[string]sourceRangeCandidate {
	type sourceMention struct {
		source     mediaSource
		start, end int
	}
	mentionedIDs := specificallyMentionedSourceIDs(instruction, sources)
	mentions := make([]sourceMention, 0)
	for _, source := range sources {
		if source.Kind != mediaKindVideo || !mentionedIDs[source.ID] {
			continue
		}
		if start, end, ok := sourceMentionSpan(instruction, source.Name); ok {
			mentions = append(mentions, sourceMention{source: source, start: start, end: end})
		}
	}

	result := make(map[string]sourceRangeCandidate)
	for _, sourceRange := range ranges {
		bestIndex, bestDistance := -1, int(^uint(0)>>1)
		for index, mention := range mentions {
			if _, assigned := result[mention.source.ID]; assigned {
				continue
			}
			distance := mention.start - sourceRange.End
			if mention.end <= sourceRange.Start {
				distance = sourceRange.Start - mention.end
			} else if distance < 0 {
				distance = -distance + len(instruction)
			}
			if distance < bestDistance {
				bestIndex, bestDistance = index, distance
			}
		}
		if bestIndex >= 0 {
			result[mentions[bestIndex].source.ID] = sourceRange
		}
	}
	return result
}

func (ctx *instructionValidationContext) validateRequestedSourceRange() error {
	ranges := requestedSourceRanges(ctx.instruction)
	if len(ranges) == 0 {
		return nil
	}
	rangesBySource := requestedSourceRangesByID(ctx.instruction, ctx.project.Sources, ranges)

	allVideos := make(map[string]clipTarget)
	for id, target := range clipTargets(ctx.project) {
		if target.Track.Type == trackTypeVideo {
			allVideos[id] = target
		}
	}

	targetRanges := make(map[string]sourceRangeCandidate)
	for id, target := range allVideos {
		if source, ok := sourceForClip(ctx.project, target.Clip); ok {
			if sourceRange, requested := rangesBySource[source.ID]; requested {
				targetRanges[id] = sourceRange
			}
		}
	}

	videoAdds := make([]editOperation, 0)
	for _, operation := range ctx.plan.Operations {
		if operation.Type == "update_clip" {
			if _, ok := allVideos[operation.ClipID]; ok && len(ranges) == 1 && len(targetRanges) == 0 {
				targetRanges[operation.ClipID] = ranges[0]
			}
		}
		if operation.Type != "add_media" {
			continue
		}
		if source, ok := sourceByID(ctx.project.Sources, operation.SourceID); ok && source.Kind == mediaKindVideo {
			videoAdds = append(videoAdds, operation)
		}
	}
	if len(targetRanges) == 0 && len(videoAdds) == 0 && len(allVideos) == 1 && len(ranges) == 1 {
		for id := range allVideos {
			targetRanges[id] = ranges[0]
		}
	}

	for id, sourceRange := range targetRanges {
		target := allVideos[id]
		resultIn, resultOut := target.Clip.SourceIn, target.Clip.SourceOut
		for _, operation := range ctx.plan.Operations {
			if operation.Type != "update_clip" || operation.ClipID != id {
				continue
			}
			if operation.InPoint != nil {
				resultIn = *operation.InPoint
			}
			if operation.OutPoint != nil {
				resultOut = *operation.OutPoint
			}
		}
		if !approxEqual(resultIn, sourceRange.SourceIn) || !approxEqual(resultOut, sourceRange.SourceOut) {
			return fmt.Errorf("instruction requires update_clip for video %s with source window %.3g to %.3g seconds", id, sourceRange.SourceIn, sourceRange.SourceOut)
		}
	}

	for _, operation := range videoAdds {
		source, _ := sourceByID(ctx.project.Sources, operation.SourceID)
		sourceRange, requested := rangesBySource[source.ID]
		if !requested && len(videoAdds) == 1 && len(ranges) == 1 {
			sourceRange, requested = ranges[0], true
		}
		if !requested {
			continue
		}
		if operation.SourceIn == nil || operation.SourceOut == nil || !approxEqual(*operation.SourceIn, sourceRange.SourceIn) || !approxEqual(*operation.SourceOut, sourceRange.SourceOut) {
			return fmt.Errorf("instruction requires add_media for video %s with source window %.3g to %.3g seconds", source.Name, sourceRange.SourceIn, sourceRange.SourceOut)
		}
	}
	return nil
}

func requestsAllClipLooks(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, phrase := range []string{
		"all clips", "every clip", "all images", "every image", "all photos", "every photo",
		"toate clipurile", "fiecare clip", "toate imaginile", "fiecare imagine", "toate pozele", "fiecare poza",
	} {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

func requestedVisualTargets(instruction string, plan editPlan, project project, imageOnly bool, opType string, opOk func(editOperation) bool, returnEarly bool, broadRequest bool) []string {
	finalClips := finalClipTargets(plan, project)
	targets := make([]string, 0)
	seen := make(map[string]bool)
	appendTarget := func(id string) {
		target, ok := finalClips[id]
		if !ok || seen[id] || !isVisualClip(project, target) {
			return
		}
		if imageOnly && clipMediaKind(project, target.Clip) != mediaKindImage {
			return
		}
		seen[id] = true
		targets = append(targets, id)
	}
	if broadRequest {
		for _, track := range project.Tracks {
			for _, target := range sortedTrackClips(finalClips, track.ID) {
				appendTarget(target.Clip.ID)
			}
		}
		return targets
	}
	for _, clipID := range project.Focus.SelectedClipIDs {
		appendTarget(clipID)
	}
	if returnEarly && len(targets) > 0 {
		return targets
	}
	for _, operation := range plan.Operations {
		if operation.Type == opType && (opOk == nil || opOk(operation)) {
			appendTarget(operation.ClipID)
		}
	}
	return targets
}

func requestedClipLookTargets(instruction string, plan editPlan, project project) []string {
	if !requestsClipLooks(instruction) {
		return nil
	}
	imageOnly := requestsEveryImage(instruction) && !(requestsAllClipLooks(instruction) || requestsSharedClipLook(instruction) || requestsVariedClipLooks(instruction))
	broad := requestsEveryImage(instruction) || requestsAllClipLooks(instruction) || requestsSharedClipLook(instruction) || requestsVariedClipLooks(instruction)
	return requestedVisualTargets(instruction, plan, project, imageOnly, "apply_preset", nil, true, broad)
}

func requestedMotionPresetTargets(instruction string, plan editPlan, project project) []string {
	if !requestsMotionPresets(instruction) {
		return nil
	}
	return requestedVisualTargets(instruction, plan, project, requestsEveryImage(instruction), "update_clip", func(op editOperation) bool {
		return op.MotionPreset != ""
	}, false, requestsEveryImage(instruction))
}

func (ctx *instructionValidationContext) validateRequestedMotionPresets() error {
	targets := requestedMotionPresetTargets(ctx.instruction, ctx.plan, ctx.project)
	if len(targets) == 0 {
		return nil
	}
	assignments := make(map[string]string, len(targets))
	for _, track := range ctx.project.Tracks {
		for _, clip := range track.Clips {
			assignments[clip.ID] = clip.MotionPreset
		}
	}
	for _, operation := range ctx.plan.Operations {
		if operation.Type == "update_clip" && operation.MotionPreset != "" {
			assignments[operation.ClipID] = operation.MotionPreset
		}
	}
	for _, target := range targets {
		if assignments[target] == "" || assignments[target] == "none" {
			return fmt.Errorf("instruction requires a motionPreset transform for visual clip %s", target)
		}
	}
	return nil
}

func (ctx *instructionValidationContext) validateEffectExclusions() error {
	if !rejectsEffects(ctx.instruction) {
		return nil
	}
	for _, operation := range ctx.plan.Operations {
		if oneOf(operation.Type, "add_effect", "update_effect", "delete_effect", "apply_preset") {
			return fmt.Errorf("instruction explicitly excludes effects and clip-look presets")
		}
	}
	return nil
}

func (ctx *instructionValidationContext) validateRequestedClipLooks() error {
	if !requestsClipLooks(ctx.instruction) {
		return nil
	}
	targets := requestedClipLookTargets(ctx.instruction, ctx.plan, ctx.project)
	if len(targets) == 0 {
		for _, target := range finalClipTargets(ctx.plan, ctx.project) {
			if isVisualClip(ctx.project, target) {
				return fmt.Errorf("instruction requests clip presets but the plan has no apply_preset operations")
			}
		}
		return nil
	}

	assignments := make(map[string]string, len(targets))
	for _, effect := range ctx.project.Effects {
		if effect.OwnerID != "" && effect.ClipLookID != "" {
			assignments[effect.OwnerID] = effect.ClipLookID
		}
	}
	for _, operation := range ctx.plan.Operations {
		if operation.Type == "apply_preset" {
			assignments[operation.ClipID] = operation.PresetID
		}
	}
	for _, target := range targets {
		if assignments[target] == "" {
			return fmt.Errorf("instruction requires apply_preset for visual clip %s", target)
		}
	}

	if requestsSharedClipLook(ctx.instruction) {
		preset := assignments[targets[0]]
		for _, target := range targets[1:] {
			if assignments[target] != preset {
				return fmt.Errorf("instruction requests one shared preset for all targeted clips")
			}
		}
	}
	if requestsVariedClipLooks(ctx.instruction) && len(targets) > 1 {
		unique := make(map[string]bool)
		for _, target := range targets {
			unique[assignments[target]] = true
		}
		if len(unique) == 1 {
			return fmt.Errorf("instruction delegates varied preset choices, but one preset was repeated on every targeted clip")
		}
	}
	return nil
}

func (ctx *instructionValidationContext) validateCompleteAudio() error {
	finalClips := finalClipTargets(ctx.plan, ctx.project)
	for _, requestedSource := range completeAudioSources(ctx.instruction, ctx.plan, ctx.project) {
		complete := false
		for _, target := range finalClips {
			if target.Track.Type != trackTypeAudio {
				continue
			}
			source, ok := sourceForClip(ctx.project, target.Clip)
			if !ok || source.ID != requestedSource.ID {
				continue
			}
			if approxEqual(target.Clip.SourceIn, 0) && approxEqual(target.Clip.SourceOut, requestedSource.Duration) && approxEqual(target.Clip.Rate, defaultPlaybackRate) {
				complete = true
				break
			}
		}
		if !complete {
			return fmt.Errorf("instruction requires the complete audio source %s at natural speed", requestedSource.Name)
		}
	}
	return nil
}

func (ctx *instructionValidationContext) validateImageScopedAudio() error {
	requestedSources := imageScopedAudioSources(ctx.instruction, ctx.project)
	if len(requestedSources) == 0 {
		return nil
	}
	imageStart, imageEnd, hasImages := imageSequenceRange(ctx.plan, ctx.project)
	if !hasImages {
		for _, target := range finalClipTargets(ctx.plan, ctx.project) {
			if source, ok := sourceForClip(ctx.project, target.Clip); ok && source.Kind == mediaKindImage {
				return fmt.Errorf("instruction requires one continuous image sequence for scoped audio")
			}
		}
		return nil
	}
	finalClips := finalClipTargets(ctx.plan, ctx.project)
	for _, requestedSource := range requestedSources {
		expectedDuration := math.Min(requestedSource.Duration, imageEnd-imageStart)
		matched := false
		for _, target := range finalClips {
			if target.Track.Type != trackTypeAudio {
				continue
			}
			source, ok := sourceForClip(ctx.project, target.Clip)
			if !ok || source.ID != requestedSource.ID {
				continue
			}
			if approxEqual(target.Clip.Start, imageStart) && approxEqual(target.Clip.End, imageStart+expectedDuration) && approxEqual(target.Clip.SourceIn, 0) && approxEqual(target.Clip.SourceOut, expectedDuration) && approxEqual(target.Clip.Rate, defaultPlaybackRate) {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("instruction requires audio source %s only during the image sequence", requestedSource.Name)
		}
	}
	return nil
}

func (ctx *instructionValidationContext) validateVisualScopedAudio() error {
	requestedSources := visualScopedAudioSources(ctx.instruction, ctx.project)
	if len(requestedSources) == 0 {
		return nil
	}
	visualStart, visualEnd, hasVisuals := visualSequenceRange(ctx.plan, ctx.project)
	if !hasVisuals {
		return nil
	}
	finalClips := finalClipTargets(ctx.plan, ctx.project)
	for _, requestedSource := range requestedSources {
		expectedDuration := math.Min(requestedSource.Duration, visualEnd-visualStart)
		matched := false
		for _, target := range finalClips {
			if target.Track.Type != trackTypeAudio {
				continue
			}
			source, ok := sourceForClip(ctx.project, target.Clip)
			if !ok || source.ID != requestedSource.ID {
				continue
			}
			if approxEqual(target.Clip.Start, visualStart) && approxEqual(target.Clip.End, visualStart+expectedDuration) && approxEqual(target.Clip.SourceIn, 0) && approxEqual(target.Clip.SourceOut, expectedDuration) && approxEqual(target.Clip.Rate, defaultPlaybackRate) {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("instruction requires audio source %s throughout the final visual interval", requestedSource.Name)
		}
	}
	return nil
}

func (ctx *instructionValidationContext) validateDefaultScopedAudio() error {
	if !requestsDefaultScopedAudio(ctx.instruction) {
		return nil
	}
	start, end, hasRange := scopedAudioRange(ctx.instruction, ctx.plan, ctx.project)
	if !hasRange {
		return nil
	}
	finalClips := finalClipTargets(ctx.plan, ctx.project)
	for _, requestedSource := range scopedAudioSources(ctx.instruction, ctx.plan, ctx.project) {
		expectedDuration := math.Min(requestedSource.Duration, end-start)
		matched := false
		for _, target := range finalClips {
			if target.Track.Type != trackTypeAudio {
				continue
			}
			source, ok := sourceForClip(ctx.project, target.Clip)
			if !ok || source.ID != requestedSource.ID {
				continue
			}
			if approxEqual(target.Clip.Start, start) && approxEqual(target.Clip.End, start+expectedDuration) && approxEqual(target.Clip.SourceIn, 0) && approxEqual(target.Clip.SourceOut, expectedDuration) && approxEqual(target.Clip.Rate, defaultPlaybackRate) {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("audio source %s must fit the focused visual interval unless the complete song is explicitly requested", requestedSource.Name)
		}
	}
	return nil
}

func (ctx *instructionValidationContext) validateSourceAudioRemoval() error {
	if !requestsSourceAudioRemoval(ctx.instruction) {
		return nil
	}

	clips := clipTargets(ctx.project)
	linkedVideos := make(map[string]clipTarget)
	for id, target := range clips {
		if target.Track.Type != trackTypeVideo || target.Clip.LinkedID == "" {
			continue
		}
		linked, ok := clips[target.Clip.LinkedID]
		if ok && linked.Track.Type == trackTypeAudio {
			linkedVideos[id] = target
		}
	}
	removed := make(map[string]bool)
	targeted := make(map[string]bool)
	addedVideo := false
	for _, operation := range ctx.plan.Operations {
		switch operation.Type {
		case "add_media":
			source, ok := sourceByID(ctx.project.Sources, operation.SourceID)
			if ok && source.Kind == mediaKindVideo {
				addedVideo = true
				if operation.IncludeAudio == nil || *operation.IncludeAudio {
					return fmt.Errorf("video %s must be added with includeAudio=false because the instruction removes or replaces its source audio", source.Name)
				}
			}
		case "remove_source_audio":
			removed[operation.ClipID] = true
		case "update_clip", "move_clip", "split_clip", "apply_preset":
			if _, ok := linkedVideos[operation.ClipID]; ok {
				targeted[operation.ClipID] = true
			}
		}
	}
	mentionedSourceIDs := specificallyMentionedSourceIDs(ctx.instruction, ctx.project.Sources)
	for id, target := range linkedVideos {
		source, sourceOK := sourceForClip(ctx.project, target.Clip)
		if (sourceOK && mentionedSourceIDs[source.ID]) || (!sourceOK && instructionMentionsSource(ctx.instruction, target.Clip.Name)) {
			targeted[id] = true
		}
	}
	if len(targeted) == 0 && !addedVideo && len(linkedVideos) == 1 {
		for id := range linkedVideos {
			targeted[id] = true
		}
	}
	for id := range targeted {
		if !removed[id] {
			return fmt.Errorf("instruction requires remove_source_audio for existing video clip %s", id)
		}
	}
	return nil
}

func validateInstructionCompliance(instruction string, plan editPlan, project project) error {
	ctx := newInstructionValidationContext(instruction, plan, project)
	if err := ctx.validateRequestedMediaSources(); err != nil {
		return err
	}
	if err := ctx.validateRequestedImageSequence(); err != nil {
		return err
	}
	if err := ctx.validateRequestedSourceRange(); err != nil {
		return err
	}
	if err := ctx.validateEffectExclusions(); err != nil {
		return err
	}
	if err := ctx.validateRequestedClipLooks(); err != nil {
		return err
	}
	if err := ctx.validateRequestedMotionPresets(); err != nil {
		return err
	}
	if err := ctx.validateCompleteAudio(); err != nil {
		return err
	}
	if err := ctx.validateImageScopedAudio(); err != nil {
		return err
	}
	if err := ctx.validateVisualScopedAudio(); err != nil {
		return err
	}
	if err := ctx.validateDefaultScopedAudio(); err != nil {
		return err
	}
	return ctx.validateSourceAudioRemoval()
}
