package ai

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

func normalizePlanForInstruction(instruction string, plan editPlan, project project) editPlan {
	if requestsRecommendationOnly(instruction) {
		plan.Mode = planModeRecommend
	} else {
		plan.Mode = planModeEdit
	}
	normalizeAudioOperations(instruction, &plan, project)
	normalizeLinkedClipDeletes(&plan, project)
	normalizeExistingMediaReferences(instruction, &plan, project)
	normalizeCompleteAudio(instruction, &plan, project)
	normalizeImagePlan(instruction, &plan, project)
	normalizeMotion(instruction, &plan, project)
	normalizeScopedAudio(instruction, &plan, project)
	normalizeAITextEncoding(&plan)
	normalizeCaptionWordLimit(&plan)
	removeUnrequestedCaptionTransitions(instruction, &plan)
	return plan
}

func removeUnrequestedCaptionTransitions(instruction string, plan *editPlan) {
	normalized := normalizeIntentText(instruction)
	if !strings.Contains(normalized, "caption") && !strings.Contains(normalized, "subtitr") && !strings.Contains(normalized, "subtitl") {
		return
	}
	if strings.Contains(normalized, "transition") || strings.Contains(normalized, "tranzit") {
		return
	}
	operations := plan.Operations[:0]
	for _, operation := range plan.Operations {
		if operation.Type != "add_transition" && operation.Type != "update_transition" {
			operations = append(operations, operation)
		}
	}
	plan.Operations = operations
}

// maxAICaptionWords keeps AI captions readable on screen. Longer spoken
// lines are split into sequential captions with proportional timing.
const maxAICaptionWords = 5

func isCaptionOperation(operation editOperation) bool {
	if operation.Type != "add_text" || operation.Text == nil {
		return false
	}
	if operation.TextPresetID != "" && oneOf(operation.TextPresetID, captionPresetIDs...) {
		return true
	}
	return operation.Style != nil && operation.Style.IsCaption != nil && *operation.Style.IsCaption
}

func splitCaptionWords(text string, limit int) [][]string {
	words := strings.Fields(text)
	if len(words) <= limit {
		return nil
	}
	chunks := make([][]string, 0, len(words)/limit+1)
	for start := 0; start < len(words); start += limit {
		end := min(start+limit, len(words))
		chunks = append(chunks, words[start:end])
	}
	return chunks
}

func normalizeCaptionWordLimit(plan *editPlan) {
	normalized := make([]editOperation, 0, len(plan.Operations))
	for _, operation := range plan.Operations {
		chunks := splitCaptionWordsForOperation(operation)
		if len(chunks) == 0 {
			normalized = append(normalized, operation)
			continue
		}
		normalized = append(normalized, splitCaptionOperation(operation, chunks)...)
		if len(normalized) > maxOperations {
			plan.Operations = normalized[:maxOperations]
			return
		}
	}
	plan.Operations = normalized
}

func splitCaptionWordsForOperation(operation editOperation) [][]string {
	if !isCaptionOperation(operation) {
		return nil
	}
	return splitCaptionWords(*operation.Text, maxAICaptionWords)
}

func splitCaptionOperation(operation editOperation, chunks [][]string) []editOperation {
	start := valueOr(operation.Start, 0)
	duration := valueOr(operation.Duration, 0)
	totalWords := 0
	for _, chunk := range chunks {
		totalWords += len(chunk)
	}
	if totalWords == 0 || duration <= 0 {
		return []editOperation{operation}
	}
	split := make([]editOperation, 0, len(chunks))
	cursor := start
	for index, chunk := range chunks {
		chunkDuration := duration * float64(len(chunk)) / float64(totalWords)
		if chunkDuration < minItemDuration {
			chunkDuration = minItemDuration
		}
		if index == len(chunks)-1 {
			chunkDuration = max(chunkDuration, start+duration-cursor)
		}
		text := strings.Join(chunk, " ")
		next := operation
		next.Start = floatPtr(cursor)
		next.Duration = floatPtr(chunkDuration)
		next.Text = stringPtr(text)
		split = append(split, next)
		cursor += chunkDuration
	}
	return split
}

func normalizeAudioOperations(instruction string, plan *editPlan, project project) {
	if requestsSourceAudioRemoval(instruction) {
		normalizeSourceAudioRemoval(plan, project)
	}

	normalizeEffectExclusions(instruction, plan)
}

func normalizeSourceAudioRemoval(plan *editPlan, project project) {
	clipsByID := clipTargets(project)
	normalizedOperations := make([]editOperation, 0, len(plan.Operations))
	removedVideoIDs := make(map[string]struct{})

	for _, operation := range plan.Operations {
		operation = normalizeLinkedAudioRemoval(operation, clipsByID)
		if operation.Type == "remove_source_audio" {
			if _, alreadyRemoved := removedVideoIDs[operation.ClipID]; alreadyRemoved {
				continue
			}
			removedVideoIDs[operation.ClipID] = struct{}{}
		}
		normalizedOperations = append(normalizedOperations, operation)
	}

	plan.Operations = normalizedOperations
}

func normalizeLinkedAudioRemoval(operation editOperation, clipsByID map[string]clipTarget) editOperation {
	if !oneOf(operation.Type, "delete_clip", "remove_source_audio") {
		return operation
	}

	audioTarget, exists := clipsByID[operation.ClipID]
	if !exists || audioTarget.Track.Type != trackTypeAudio || audioTarget.Clip.LinkedID == "" {
		return operation
	}

	linkedVideoTarget, exists := clipsByID[audioTarget.Clip.LinkedID]
	if !exists || linkedVideoTarget.Track.Type != trackTypeVideo {
		return operation
	}

	operation.Type = "remove_source_audio"
	operation.ClipID = linkedVideoTarget.Clip.ID
	return operation
}

func normalizeLinkedClipDeletes(plan *editPlan, project project) {
	clipsByID := clipTargets(project)
	deletedVideos := make(map[string]bool)
	for _, operation := range plan.Operations {
		if target, ok := clipsByID[operation.ClipID]; operation.Type == "delete_clip" && ok && target.Track.Type == trackTypeVideo {
			deletedVideos[operation.ClipID] = true
		}
	}

	operations := make([]editOperation, 0, len(plan.Operations))
	for _, operation := range plan.Operations {
		if operation.Type == "remove_source_audio" && deletedVideos[operation.ClipID] {
			continue
		}
		if operation.Type == "delete_clip" {
			if target, ok := clipsByID[operation.ClipID]; ok && target.Track.Type == trackTypeAudio && deletedVideos[target.Clip.LinkedID] {
				continue
			}
		}
		operations = append(operations, operation)
	}
	plan.Operations = operations
}

func normalizeImagePlan(instruction string, plan *editPlan, project project) {
	ensureAllImagesInPlan(instruction, plan, project)
	normalizeSharedClipLook(instruction, plan, project)
	normalizeImageSequenceTiming(instruction, plan, project)
}

func normalizeMotion(instruction string, plan *editPlan, project project) {
	ensureAllImageTransitions(instruction, plan, project)
	normalizeImageTransitionOrder(instruction, plan, project)
	normalizeTransitionJunctions(plan, project)
	normalizeRequestedMotionPresets(instruction, plan, project)
}

func normalizeEffectExclusions(instruction string, plan *editPlan) {
	if !rejectsEffects(instruction) {
		return
	}
	normalizedOperations := make([]editOperation, 0, len(plan.Operations))
	for _, operation := range plan.Operations {
		if oneOf(operation.Type, "add_effect", "update_effect", "delete_effect", "apply_preset") {
			continue
		}
		normalizedOperations = append(normalizedOperations, operation)
	}
	plan.Operations = normalizedOperations
}

func bestMentionedSource(instruction string, sources []mediaSource, kind mediaKind) (mediaSource, bool, bool) {
	best := mediaSource{}
	bestScore := 0
	ambiguous := false
	for _, source := range sources {
		if source.Kind != kind {
			continue
		}
		score := instructionSourceMatchScore(instruction, source.Name)
		if score > bestScore {
			best, bestScore = source, score
			ambiguous = false
		} else if score > 0 && score == bestScore {
			ambiguous = true
		}
	}
	return best, bestScore > 0 && !ambiguous, ambiguous
}

func mediaSourcesByKind(sources []mediaSource, kind mediaKind) []mediaSource {
	matchingSources := make([]mediaSource, 0)
	for _, source := range sources {
		if source.Kind == kind {
			matchingSources = append(matchingSources, source)
		}
	}
	return matchingSources
}

func completeAudioSources(instruction string, plan editPlan, project project) []mediaSource {
	if !requestsCompleteAudio(instruction) {
		return nil
	}

	audioSources := mediaSourcesByKind(project.Sources, mediaKindAudio)
	if named, ok, _ := bestMentionedSource(instruction, project.Sources, mediaKindAudio); ok {
		return []mediaSource{named}
	}
	chosenSourceIDs := make(map[string]struct{})
	clipsByID := clipTargets(project)
	for _, clipID := range project.Focus.SelectedClipIDs {
		if target, ok := clipsByID[clipID]; ok && target.Track.Type == trackTypeAudio {
			if source, sourceOK := sourceForClip(project, target.Clip); sourceOK && source.Kind == mediaKindAudio {
				chosenSourceIDs[source.ID] = struct{}{}
			}
		}
	}
	for _, operation := range plan.Operations {
		if operation.Type != "add_media" {
			continue
		}
		if source, ok := sourceByID(project.Sources, operation.SourceID); ok && source.Kind == mediaKindAudio {
			chosenSourceIDs[source.ID] = struct{}{}
		}
	}
	if len(chosenSourceIDs) == 1 {
		for _, source := range audioSources {
			if _, chosen := chosenSourceIDs[source.ID]; chosen {
				return []mediaSource{source}
			}
		}
	}
	if len(audioSources) == 1 {
		return audioSources
	}
	return nil
}

func normalizeCompleteAudio(instruction string, plan *editPlan, project project) {
	clipsByID := clipTargets(project)
	for _, source := range completeAudioSources(instruction, *plan, project) {
		if normalizeAddedAudioOperations(source, plan) {
			continue
		}

		clipID := existingAudioClipID(source, project, clipsByID, *plan)
		if clipID == "" {
			continue
		}

		normalizeExistingAudioClip(source, clipID, plan)
	}
}

func normalizeAddedAudioOperations(source mediaSource, plan *editPlan) bool {
	normalized := false
	for index := range plan.Operations {
		operation := &plan.Operations[index]
		if operation.Type != "add_media" || operation.SourceID != source.ID {
			continue
		}
		setCompleteAudioSourceRange(operation, source.Duration)
		normalized = true
	}
	return normalized
}

func existingAudioClipID(source mediaSource, project project, clipsByID map[string]clipTarget, plan editPlan) string {
	for _, selectedID := range project.Focus.SelectedClipIDs {
		if target, ok := clipsByID[selectedID]; ok && isSurvivingAudioClip(source, project, target, plan) {
			return selectedID
		}
	}
	for _, track := range project.Tracks {
		if track.Type != trackTypeAudio {
			continue
		}
		for _, clip := range track.Clips {
			target := clipTarget{Track: track, Clip: clip}
			if isSurvivingAudioClip(source, project, target, plan) {
				return clip.ID
			}
		}
	}
	return ""
}

func isSurvivingAudioClip(source mediaSource, project project, target clipTarget, plan editPlan) bool {
	if target.Track.Type != trackTypeAudio {
		return false
	}
	existingSource, sourceOK := sourceForClip(project, target.Clip)
	return sourceOK && existingSource.ID == source.ID && existingClipSurvivesPlan(plan, target.Track, target.Clip)
}

func normalizeExistingAudioClip(source mediaSource, clipID string, plan *editPlan) {
	updated := false
	for index := range plan.Operations {
		operation := &plan.Operations[index]
		if operation.Type != "update_clip" || operation.ClipID != clipID {
			continue
		}
		setCompleteAudioClipRange(operation, source.Duration)
		updated = true
	}
	if updated {
		return
	}
	plan.Operations = append(plan.Operations, editOperation{
		Type:         "update_clip",
		ClipID:       clipID,
		InPoint:      floatPtr(0),
		OutPoint:     floatPtr(source.Duration),
		PlaybackRate: floatPtr(1),
	})
}

func setCompleteAudioSourceRange(operation *editOperation, duration float64) {
	operation.SourceIn = floatPtr(0)
	operation.SourceOut = floatPtr(duration)
	operation.PlaybackRate = floatPtr(1)
	operation.IncludeAudio = boolPtr(false)
}

func setCompleteAudioClipRange(operation *editOperation, duration float64) {
	operation.InPoint = floatPtr(0)
	operation.OutPoint = floatPtr(duration)
	operation.PlaybackRate = floatPtr(1)
}

func normalizeSharedClipLook(instruction string, plan *editPlan, project project) {
	if !requestsSharedClipLook(instruction) {
		return
	}
	targets := requestedClipLookTargets(instruction, *plan, project)
	if len(targets) == 0 {
		return
	}
	targetClipIDs := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		targetClipIDs[target] = struct{}{}
	}

	presetID := ""
	for _, operation := range plan.Operations {
		_, targetsClip := targetClipIDs[operation.ClipID]
		if operation.Type == "apply_preset" && targetsClip {
			presetID = operation.PresetID
			break
		}
	}
	if presetID == "" {
		return
	}
	appliedClipIDs := make(map[string]struct{}, len(targets))
	for index := range plan.Operations {
		operation := &plan.Operations[index]
		_, targetsClip := targetClipIDs[operation.ClipID]
		if operation.Type == "apply_preset" && targetsClip {
			operation.PresetID = presetID
			appliedClipIDs[operation.ClipID] = struct{}{}
		}
	}
	for _, target := range targets {
		if _, applied := appliedClipIDs[target]; !applied {
			plan.Operations = append(plan.Operations, editOperation{
				Type:     "apply_preset",
				ClipID:   target,
				PresetID: presetID,
			})
		}
	}
}

func normalizeRequestedMotionPresets(instruction string, plan *editPlan, project project) {
	targets := requestedMotionPresetTargets(instruction, *plan, project)
	if len(targets) == 0 {
		return
	}
	assignedPresetByClipID := make(map[string]string, len(targets))
	updateIndexByClipID := make(map[string]int, len(targets))
	for _, track := range project.Tracks {
		for _, clip := range track.Clips {
			assignedPresetByClipID[clip.ID] = clip.MotionPreset
		}
	}
	for index, operation := range plan.Operations {
		if operation.Type != "update_clip" {
			continue
		}
		updateIndexByClipID[operation.ClipID] = index
		if operation.MotionPreset != "" {
			assignedPresetByClipID[operation.ClipID] = operation.MotionPreset
		}
	}

	motionPresets := []string{"ken-burns", "pan-left", "zoom-in", "pan-right", "zoom-out", "pan-up", "pan-down", "drift"}
	for index, target := range targets {
		if preset := assignedPresetByClipID[target]; preset != "" && preset != "none" {
			continue
		}

		preset := motionPresets[index%len(motionPresets)]
		if operationIndex, ok := updateIndexByClipID[target]; ok {
			plan.Operations[operationIndex].MotionPreset = preset
		} else {
			plan.Operations = append(plan.Operations, editOperation{
				Type:         "update_clip",
				ClipID:       target,
				MotionPreset: preset,
			})
		}
		assignedPresetByClipID[target] = preset
	}
}

func imageSequenceRange(plan editPlan, project project) (float64, float64, bool) {
	images := make([]clipTarget, 0)
	for _, target := range finalClipTargets(plan, project) {
		source, ok := sourceForClip(project, target.Clip)
		if !ok || source.Kind != mediaKindImage {
			continue
		}
		images = append(images, target)
	}
	if len(images) == 0 {
		return 0, 0, false
	}
	sort.Slice(images, func(i, j int) bool { return images[i].Clip.Start < images[j].Clip.Start })
	start, end, trackID := images[0].Clip.Start, images[0].Clip.End, images[0].Track.ID
	for _, target := range images[1:] {
		if target.Track.ID != trackID || target.Clip.Start > end+timingEpsilon {
			return 0, 0, false
		}
		end = math.Max(end, target.Clip.End)
	}
	return start, end, end > start
}

func imageScopedAudioSources(instruction string, project project) []mediaSource {
	if !requestsImageScopedAudio(instruction) {
		return nil
	}

	audioSources := mediaSourcesByKind(project.Sources, mediaKindAudio)
	if named, ok, _ := bestMentionedSource(instruction, project.Sources, mediaKindAudio); ok {
		return []mediaSource{named}
	}
	if mentionsAudioEdit(instruction) && len(audioSources) == 1 {
		return audioSources
	}
	return nil
}

func visualSequenceRange(plan editPlan, project project) (float64, float64, bool) {
	start, end := math.Inf(1), 0.0
	for _, target := range finalClipTargets(plan, project) {
		if !isVisualClip(project, target) {
			continue
		}
		start = math.Min(start, target.Clip.Start)
		end = math.Max(end, target.Clip.End)
	}
	return start, end, finite(start) && end > start
}

func visualScopedAudioSources(instruction string, project project) []mediaSource {
	if !requestsVisualScopedAudio(instruction) {
		return nil
	}
	if named, ok, _ := bestMentionedSource(instruction, project.Sources, mediaKindAudio); ok {
		return []mediaSource{named}
	}
	audioSources := mediaSourcesByKind(project.Sources, mediaKindAudio)
	if len(audioSources) == 1 {
		return audioSources
	}
	return nil
}

func scopedAudioSources(instruction string, plan editPlan, project project) []mediaSource {
	if requestsImageScopedAudio(instruction) {
		return imageScopedAudioSources(instruction, project)
	}
	if requestsVisualScopedAudio(instruction) {
		return visualScopedAudioSources(instruction, project)
	}
	if !requestsDefaultScopedAudio(instruction) {
		return nil
	}
	if named, ok, _ := bestMentionedSource(instruction, project.Sources, mediaKindAudio); ok {
		return []mediaSource{named}
	}

	chosen := make(map[string]bool)
	clipsByID := clipTargets(project)
	for _, clipID := range project.Focus.SelectedClipIDs {
		if target, ok := clipsByID[clipID]; ok && target.Track.Type == trackTypeAudio {
			if source, sourceOK := sourceForClip(project, target.Clip); sourceOK && source.Kind == mediaKindAudio {
				chosen[source.ID] = true
			}
		}
	}
	for _, operation := range plan.Operations {
		if operation.Type != "add_media" {
			continue
		}
		if source, ok := sourceByID(project.Sources, operation.SourceID); ok && source.Kind == mediaKindAudio {
			chosen[source.ID] = true
		}
	}
	if len(chosen) == 1 {
		for _, source := range project.Sources {
			if chosen[source.ID] {
				return []mediaSource{source}
			}
		}
	}
	audioSources := mediaSourcesByKind(project.Sources, mediaKindAudio)
	if len(audioSources) == 1 {
		return audioSources
	}
	return nil
}

func focusedVisualRange(plan editPlan, project project) (float64, float64, bool) {
	finalClips := finalClipTargets(plan, project)
	start, end := math.Inf(1), 0.0
	for _, clipID := range project.Focus.SelectedClipIDs {
		target, ok := finalClips[clipID]
		if !ok || !isVisualClip(project, target) {
			continue
		}
		start = math.Min(start, target.Clip.Start)
		end = math.Max(end, target.Clip.End)
	}
	if finite(start) && end > start {
		return start, end, true
	}

	for _, target := range finalClips {
		if !isVisualClip(project, target) || project.Focus.Playhead < target.Clip.Start || project.Focus.Playhead >= target.Clip.End {
			continue
		}
		return target.Clip.Start, target.Clip.End, true
	}
	return visualSequenceRange(plan, project)
}

func scopedAudioRange(instruction string, plan editPlan, project project) (float64, float64, bool) {
	if requestsImageScopedAudio(instruction) {
		return imageSequenceRange(plan, project)
	}
	if requestsVisualScopedAudio(instruction) {
		return visualSequenceRange(plan, project)
	}
	if requestsDefaultScopedAudio(instruction) {
		if requestsEveryImage(instruction) {
			return imageSequenceRange(plan, project)
		}
		return focusedVisualRange(plan, project)
	}
	return 0, 0, false
}

func normalizeScopedAudio(instruction string, plan *editPlan, project project) {
	start, end, hasRange := scopedAudioRange(instruction, *plan, project)
	if !hasRange {
		return
	}
	clipsByID := clipTargets(project)
	for _, source := range scopedAudioSources(instruction, *plan, project) {
		if normalizeAddedScopedAudio(source, start, end, plan) {
			continue
		}
		clipID := existingAudioClipID(source, project, clipsByID, *plan)
		if clipID != "" {
			normalizeExistingScopedAudio(source, clipID, start, end, plan)
		}
	}
}

func normalizeAddedScopedAudio(source mediaSource, start, end float64, plan *editPlan) bool {
	normalized := false
	for index := range plan.Operations {
		operation := &plan.Operations[index]
		if operation.Type != "add_media" || operation.SourceID != source.ID {
			continue
		}
		operation.Start = floatPtr(start)
		operation.SourceIn = floatPtr(0)
		operation.SourceOut = floatPtr(math.Min(source.Duration, end-start))
		operation.PlaybackRate = floatPtr(1)
		operation.IncludeAudio = boolPtr(false)
		normalized = true
	}
	return normalized
}

func normalizeExistingScopedAudio(source mediaSource, clipID string, start, end float64, plan *editPlan) {
	for index := range plan.Operations {
		operation := &plan.Operations[index]
		if operation.Type != "update_clip" || operation.ClipID != clipID {
			continue
		}
		operation.Start = floatPtr(start)
		operation.InPoint = floatPtr(0)
		operation.OutPoint = floatPtr(math.Min(source.Duration, end-start))
		operation.PlaybackRate = floatPtr(1)
		return
	}
	plan.Operations = append(plan.Operations, editOperation{
		Type:         "update_clip",
		ClipID:       clipID,
		Start:        floatPtr(start),
		InPoint:      floatPtr(0),
		OutPoint:     floatPtr(math.Min(source.Duration, end-start)),
		PlaybackRate: floatPtr(1),
	})
}

func normalizeExistingMediaReferences(instruction string, plan *editPlan, project project) {
	if requestsDuplicateMedia(instruction) {
		return
	}

	mentionedSourceIDs := specificallyMentionedSourceIDs(instruction, project.Sources)
	existingClipIDBySourceID := make(map[string]string)
	rememberExistingClip := func(track track, clip clip) {
		if !existingClipSurvivesPlan(*plan, track, clip) {
			return
		}
		if source, ok := sourceForClip(project, clip); ok && existingClipIDBySourceID[source.ID] == "" {
			existingClipIDBySourceID[source.ID] = clip.ID
		}
	}

	clipsByID := clipTargets(project)
	for _, clipID := range project.Focus.SelectedClipIDs {
		if target, ok := clipsByID[clipID]; ok {
			rememberExistingClip(target.Track, target.Clip)
		}
	}
	for _, track := range project.Tracks {
		for _, clip := range track.Clips {
			rememberExistingClip(track, clip)
		}
	}

	plannedClipIDBySourceID := make(map[string]string)
	replacementClipIDs := make(map[string]string)
	normalizedOperations := make([]editOperation, 0, len(plan.Operations))
	for _, operation := range plan.Operations {
		if operation.Type == "add_media" {
			source, sourceOK := sourceByID(project.Sources, operation.SourceID)
			requestedAllImages := source.Kind == mediaKindImage && requestsEveryImage(instruction)
			requested := sourceOK && (mentionedSourceIDs[source.ID] || requestedAllImages)
			if requested {
				if clipID := existingClipIDBySourceID[source.ID]; clipID != "" {
					replacementClipIDs[operation.ResultID] = clipID
					continue
				}
				if resultID := plannedClipIDBySourceID[source.ID]; resultID != "" {
					replacementClipIDs[operation.ResultID] = resultID
					continue
				}
				plannedClipIDBySourceID[source.ID] = operation.ResultID
			}
		}
		normalizedOperations = append(normalizedOperations, operation)
	}

	resolveClipID := func(clipID string) string {
		for replacementClipIDs[clipID] != "" && replacementClipIDs[clipID] != clipID {
			clipID = replacementClipIDs[clipID]
		}
		return clipID
	}
	for index := range normalizedOperations {
		normalizedOperations[index].ClipID = resolveClipID(normalizedOperations[index].ClipID)
		normalizedOperations[index].LeftClipID = resolveClipID(normalizedOperations[index].LeftClipID)
		normalizedOperations[index].RightClipID = resolveClipID(normalizedOperations[index].RightClipID)
	}

	plan.Operations = normalizedOperations
}

func ensureAllImagesInPlan(instruction string, plan *editPlan, project project) {
	if !requestsEveryImage(instruction) {
		return
	}
	images := mediaSourcesByKind(project.Sources, mediaKindImage)
	if len(images) == 0 {
		return
	}

	representedSourceIDs, usedClipIDs := imagePlanIDs(*plan, project)
	imageTrack, ok := imageInsertionTrack(*plan, project)
	if !ok {
		return
	}

	sequence := imageSequenceTail(*plan, project, imageTrack.ID)
	imageDuration, hasImageDuration := requestedImageDuration(instruction)
	transitionDuration, hasTransition := requestedTransitionDuration(instruction)
	appendMissingImages(plan, images, representedSourceIDs, usedClipIDs, sequence, imageAppendOptions{
		trackID:            imageTrack.ID,
		imageDuration:      imageDuration,
		hasImageDuration:   hasImageDuration,
		transitionDuration: transitionDuration,
		hasTransition:      hasTransition,
		transitionPreset:   plannedImageTransitionPreset(*plan),
	})
}

func imagePlanIDs(plan editPlan, project project) (map[string]struct{}, map[string]struct{}) {
	representedSourceIDs := make(map[string]struct{})
	for _, track := range project.Tracks {
		for _, clip := range track.Clips {
			if !existingClipSurvivesPlan(plan, track, clip) {
				continue
			}
			if source, ok := sourceForClip(project, clip); ok {
				representedSourceIDs[source.ID] = struct{}{}
			}
		}
	}

	usedClipIDs := make(map[string]struct{})
	for id := range clipTargets(project) {
		usedClipIDs[id] = struct{}{}
	}
	for _, operation := range plan.Operations {
		if operation.Type != "add_media" {
			continue
		}
		representedSourceIDs[operation.SourceID] = struct{}{}
		usedClipIDs[operation.ResultID] = struct{}{}
	}
	return representedSourceIDs, usedClipIDs
}

func imageInsertionTrack(plan editPlan, project project) (track, bool) {
	for _, operation := range plan.Operations {
		if operation.Type != "add_media" {
			continue
		}
		source, sourceOK := sourceByID(project.Sources, operation.SourceID)
		if !sourceOK || source.Kind != mediaKindImage {
			continue
		}
		candidate, trackOK := trackByID(project.Tracks, operation.ChannelID)
		if trackOK && candidate.Type == trackTypeVideo && !candidate.Locked {
			return candidate, true
		}
	}
	for _, candidate := range project.Tracks {
		if candidate.Type == trackTypeVideo && !candidate.Locked {
			return candidate, true
		}
	}
	return track{}, false
}

func imageSequenceTail(plan editPlan, project project, trackID string) imageAppendState {
	sequence := imageAppendState{}
	for _, target := range clipsAfterDeleteRanges(plan, project) {
		if target.Track.ID != trackID {
			continue
		}
		clip := target.Clip
		if clip.End >= sequence.end {
			sequence.end = clip.End
			if clipMediaKind(project, clip) == mediaKindImage && !strings.HasPrefix(clip.ID, "__delete_fragment_") {
				sequence.previousImageID = clip.ID
			} else {
				sequence.previousImageID = ""
			}
		}
	}
	for _, operation := range plan.Operations {
		if operation.Type != "add_media" || operation.ChannelID != trackID {
			continue
		}
		if operation.Start == nil || operation.SourceIn == nil || operation.SourceOut == nil {
			continue
		}
		rate := valueOr(operation.PlaybackRate, 1)
		operationEnd := *operation.Start + (*operation.SourceOut-*operation.SourceIn)/rate
		if operationEnd >= sequence.end {
			sequence.end = operationEnd
			source, ok := sourceByID(project.Sources, operation.SourceID)
			if ok && source.Kind == mediaKindImage {
				sequence.previousImageID = operation.ResultID
			} else {
				sequence.previousImageID = ""
			}
		}
	}
	return sequence
}

func plannedImageTransitionPreset(plan editPlan) string {
	for _, operation := range plan.Operations {
		if operation.Type == "add_transition" || operation.Type == "update_transition" {
			return operation.EffectID
		}
	}
	return "cross-dissolve"
}

type imageAppendState struct {
	end             float64
	previousImageID string
}

type imageAppendOptions struct {
	trackID            string
	imageDuration      float64
	hasImageDuration   bool
	transitionDuration float64
	hasTransition      bool
	transitionPreset   string
}

func appendMissingImages(
	plan *editPlan,
	images []mediaSource,
	representedSourceIDs map[string]struct{},
	usedClipIDs map[string]struct{},
	sequence imageAppendState,
	options imageAppendOptions,
) {
	nextResultID := func() string {
		for index := 1; ; index++ {
			candidate := fmt.Sprintf("image%d", index)
			if _, used := usedClipIDs[candidate]; !used {
				usedClipIDs[candidate] = struct{}{}
				return candidate
			}
		}
	}

	for _, source := range images {
		if _, represented := representedSourceIDs[source.ID]; represented {
			continue
		}
		duration := source.Duration
		if options.hasImageDuration {
			duration = options.imageDuration
		} else if options.hasTransition {
			duration = math.Max(duration, 2*options.transitionDuration)
		}
		rate := 1.0
		sourceOut := math.Min(source.Duration, duration)
		if duration > source.Duration {
			rate = source.Duration / duration
			if rate < minPlaybackRate {
				continue
			}
		}
		start := sequence.end
		if options.hasTransition && sequence.previousImageID != "" {
			start = math.Max(0, sequence.end-options.transitionDuration)
		}
		resultID := nextResultID()
		plan.Operations = append(plan.Operations, editOperation{
			Type:         "add_media",
			SourceID:     source.ID,
			ResultID:     resultID,
			ChannelID:    options.trackID,
			Start:        floatPtr(start),
			SourceIn:     floatPtr(0),
			SourceOut:    floatPtr(sourceOut),
			PlaybackRate: floatPtr(rate),
			IncludeAudio: boolPtr(false),
		})
		if options.hasTransition && sequence.previousImageID != "" {
			plan.Operations = append(plan.Operations, editOperation{
				Type:        "add_transition",
				ChannelID:   options.trackID,
				LeftClipID:  sequence.previousImageID,
				RightClipID: resultID,
				EffectID:    options.transitionPreset,
				Duration:    floatPtr(options.transitionDuration),
			})
		}
		sequence.end = start + duration
		sequence.previousImageID = resultID
		representedSourceIDs[source.ID] = struct{}{}
	}
}

func normalizeImageSequenceTiming(instruction string, plan *editPlan, project project) {
	if !requestsEveryImage(instruction) {
		return
	}
	imageDuration, hasImageDuration := requestedImageDuration(instruction)
	transitionDuration, hasTransitionDuration := requestedTransitionDuration(instruction)
	imageClipIDs := make(map[string]struct{})
	for id, target := range clipTargets(project) {
		if clipMediaKind(project, target.Clip) == mediaKindImage {
			imageClipIDs[id] = struct{}{}
		}
	}

	normalizeAddedImageTiming(plan, project, imageClipIDs, imageDuration, hasImageDuration)
	if hasImageDuration {
		normalizeExistingImageTiming(plan, project, imageDuration)
	}
	if hasTransitionDuration {
		normalizeImageTransitionDurations(plan, imageClipIDs, transitionDuration)
	}
}

func normalizeAddedImageTiming(plan *editPlan, project project, imageClipIDs map[string]struct{}, imageDuration float64, hasImageDuration bool) {
	for index := range plan.Operations {
		operation := &plan.Operations[index]
		if operation.Type != "add_media" {
			continue
		}
		source, ok := sourceByID(project.Sources, operation.SourceID)
		if !ok || source.Kind != mediaKindImage {
			continue
		}
		imageClipIDs[operation.ResultID] = struct{}{}
		if !hasImageDuration || operation.SourceIn == nil {
			continue
		}
		rate := valueOr(operation.PlaybackRate, 1)
		available := source.Duration - *operation.SourceIn
		if available <= 0 {
			continue
		}
		window := imageDuration * rate
		if window > available {
			rate = available / imageDuration
			if rate < minPlaybackRate || rate > maxPlaybackRate {
				continue
			}
			operation.PlaybackRate = floatPtr(rate)
			window = available
		}
		operation.SourceOut = floatPtr(*operation.SourceIn + window)
	}
}

func normalizeExistingImageTiming(plan *editPlan, project project, imageDuration float64) {
	finalClips := finalClipTargets(*plan, project)
	for _, track := range project.Tracks {
		for _, existingClip := range track.Clips {
			target, exists := finalClips[existingClip.ID]
			if !exists || clipMediaKind(project, target.Clip) != mediaKindImage {
				continue
			}
			if approxEqual(target.Clip.End-target.Clip.Start, imageDuration) {
				continue
			}
			source, ok := sourceForClip(project, target.Clip)
			if !ok {
				continue
			}
			available := source.Duration - target.Clip.SourceIn
			if available <= 0 {
				continue
			}
			window := math.Min(available, imageDuration)
			rate := window / imageDuration
			if rate < minPlaybackRate || rate > maxPlaybackRate {
				continue
			}
			updateImageClipTiming(plan, existingClip.ID, target.Clip.SourceIn, window, rate)
		}
	}
}

func updateImageClipTiming(plan *editPlan, clipID string, sourceIn, window, rate float64) {
	updateIndex := -1
	for index := range plan.Operations {
		operation := &plan.Operations[index]
		if operation.Type == "update_clip" && operation.ClipID == clipID {
			updateIndex = index
		}
	}
	if updateIndex >= 0 {
		operation := &plan.Operations[updateIndex]
		operation.InPoint = floatPtr(sourceIn)
		operation.OutPoint = floatPtr(sourceIn + window)
		operation.PlaybackRate = floatPtr(rate)
		return
	}
	plan.Operations = append(plan.Operations, editOperation{
		Type:         "update_clip",
		ClipID:       clipID,
		InPoint:      floatPtr(sourceIn),
		OutPoint:     floatPtr(sourceIn + window),
		PlaybackRate: floatPtr(rate),
	})
}

func normalizeImageTransitionDurations(plan *editPlan, imageClipIDs map[string]struct{}, duration float64) {
	for index := range plan.Operations {
		operation := &plan.Operations[index]
		_, leftIsImage := imageClipIDs[operation.LeftClipID]
		_, rightIsImage := imageClipIDs[operation.RightClipID]
		if oneOf(operation.Type, "add_transition", "update_transition") && leftIsImage && rightIsImage {
			operation.Duration = floatPtr(duration)
		}
	}
}

func ensureAllImageTransitions(instruction string, plan *editPlan, project project) {
	duration, requested := requestedTransitionDuration(instruction)
	if !requestsEveryImage(instruction) || !requested {
		return
	}
	finalClips := finalClipTargets(*plan, project)
	plannedJunctions := make(map[string]struct{})
	transitionPreset := "cross-dissolve"
	for _, operation := range plan.Operations {
		if operation.Type != "add_transition" && operation.Type != "update_transition" {
			continue
		}
		plannedJunctions[junctionKey(operation.LeftClipID, operation.RightClipID)] = struct{}{}
		transitionPreset = operation.EffectID
	}
	existingTransitionsByJunction := make(map[string]transition)
	for _, transition := range project.Transitions {
		existingTransitionsByJunction[junctionKey(transition.LeftClipID, transition.RightClipID)] = transition
	}
	for _, track := range project.Tracks {
		ordered := sortedTrackClips(finalClips, track.ID)
		for index := 0; index < len(ordered)-1; index++ {
			left, right := ordered[index], ordered[index+1]
			if strings.HasPrefix(left.Clip.ID, "__delete_fragment_") || strings.HasPrefix(right.Clip.ID, "__delete_fragment_") {
				continue
			}
			leftSource, leftOK := sourceForClip(project, left.Clip)
			rightSource, rightOK := sourceForClip(project, right.Clip)
			if !leftOK || !rightOK || leftSource.Kind != mediaKindImage || rightSource.Kind != mediaKindImage {
				continue
			}
			key := junctionKey(left.Clip.ID, right.Clip.ID)
			if _, planned := plannedJunctions[key]; planned {
				continue
			}
			operationType := "add_transition"
			effectID := transitionPreset
			if transition, ok := existingTransitionsByJunction[key]; ok {
				operationType = "update_transition"
				effectID = transition.Preset
			}
			plan.Operations = append(plan.Operations, editOperation{
				Type:        operationType,
				ChannelID:   track.ID,
				LeftClipID:  left.Clip.ID,
				RightClipID: right.Clip.ID,
				EffectID:    effectID,
				Duration:    floatPtr(duration),
			})
		}
	}
}

func normalizeImageTransitionOrder(instruction string, plan *editPlan, project project) {
	if !requestsEveryImage(instruction) {
		return
	}

	imageClipIDs := make(map[string]struct{})

	for id, target := range finalClipTargets(*plan, project) {
		if clipMediaKind(project, target.Clip) == mediaKindImage {
			imageClipIDs[id] = struct{}{}
		}
	}

	operations := make([]editOperation, 0, len(plan.Operations))
	transitions := make([]editOperation, 0)

	for _, operation := range plan.Operations {
		_, leftIsImage := imageClipIDs[operation.LeftClipID]
		_, rightIsImage := imageClipIDs[operation.RightClipID]
		if oneOf(operation.Type, "add_transition", "update_transition") && leftIsImage && rightIsImage {
			transitions = append(transitions, operation)
			continue
		}
		operations = append(operations, operation)
	}
	plan.Operations = append(operations, transitions...)
}

func normalizeTransitionJunctions(plan *editPlan, project project) {
	clipsByID, addedOperationIndexByClipID := transitionClipTargets(*plan, project)
	applyPlannedClipTiming(clipsByID, plan.Operations)
	alignAddedClipsToTransitions(plan, clipsByID, addedOperationIndexByClipID)
}

func transitionClipTargets(plan editPlan, project project) (map[string]clipTarget, map[string]int) {
	clipsByID := clipsAfterDeleteRanges(plan, project)
	addedOperationIndexByClipID := make(map[string]int)

	for index, operation := range plan.Operations {
		if operation.Type != "add_media" || operation.Start == nil || operation.SourceIn == nil || operation.SourceOut == nil {
			continue
		}
		rate := valueOr(operation.PlaybackRate, 1)
		track, trackOK := trackByID(project.Tracks, operation.ChannelID)
		if rate <= 0 || !trackOK {
			continue
		}
		duration := (*operation.SourceOut - *operation.SourceIn) / rate
		clipsByID[operation.ResultID] = clipTarget{
			Track: track,
			Clip: clip{
				ID:    operation.ResultID,
				Start: *operation.Start,
				End:   *operation.Start + duration,
			},
		}
		addedOperationIndexByClipID[operation.ResultID] = index
	}

	return clipsByID, addedOperationIndexByClipID
}

func applyPlannedClipTiming(clipsByID map[string]clipTarget, operations []editOperation) {
	for _, operation := range operations {
		switch operation.Type {
		case "move_clip":
			target, ok := clipsByID[operation.ClipID]
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
			target.Clip.Start = start
			target.Clip.End = start + duration
			clipsByID[operation.ClipID] = target
		case "update_clip":
			target, ok := clipsByID[operation.ClipID]
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
			clipsByID[operation.ClipID] = target
		}
	}
}

func alignAddedClipsToTransitions(plan *editPlan, clipsByID map[string]clipTarget, addedOperationIndexByClipID map[string]int) {
	for _, operation := range plan.Operations {
		if !oneOf(operation.Type, "add_transition", "update_transition") || operation.Duration == nil {
			continue
		}

		left, leftOK := clipsByID[operation.LeftClipID]
		right, rightOK := clipsByID[operation.RightClipID]
		rightOperationIndex, rightWasAdded := addedOperationIndexByClipID[operation.RightClipID]
		if !leftOK || !rightOK || !rightWasAdded {
			continue
		}
		if left.Track.ID != operation.ChannelID || right.Track.ID != operation.ChannelID {
			continue
		}

		desiredStart := left.Clip.End - *operation.Duration
		if desiredStart < 0 || math.Abs(right.Clip.Start-desiredStart) <= timingEpsilon {
			continue
		}

		rightDuration := right.Clip.End - right.Clip.Start
		plan.Operations[rightOperationIndex].Start = &desiredStart
		right.Clip.Start = desiredStart
		right.Clip.End = desiredStart + rightDuration
		clipsByID[operation.RightClipID] = right
	}
}

func standaloneUndoInstruction(instruction string) (int, bool) {
	normalized := strings.ToLower(strings.TrimSpace(instruction))
	normalized = strings.ReplaceAll(normalized, " ", "")
	if oneOf(strings.Trim(normalized, ".!"), "ctrl+z", "control+z") {
		return 1, true
	}

	words := normalizedInstructionWords(instruction)
	if len(words) == 0 || !isUndoCommand(words[0]) {
		return 0, false
	}

	count := 1
	allowedWords := map[string]struct{}{
		"undo":     {},
		"rollback": {},
		"anuleaza": {},
		"anulează": {},
		"last":     {},
		"the":      {},
		"edit":     {},
		"edits":    {},
		"change":   {},
		"changes":  {},
		"ultima":   {},
		"ultimele": {},
		"editare":  {},
		"editari":  {},
		"editări":  {},
	}
	for _, word := range words[1:] {
		if value, err := strconv.Atoi(word); err == nil {
			if value < 1 || value > 100 {
				return 0, false
			}
			count = value
			continue
		}
		if _, allowed := allowedWords[word]; !allowed {
			return 0, false
		}
	}
	return count, true
}

func startsWithUndoCommand(instruction string) bool {
	words := normalizedInstructionWords(instruction)
	if len(words) == 0 {
		return false
	}
	return isUndoCommand(words[0])
}

func normalizedInstructionWords(instruction string) []string {
	words := strings.Fields(strings.ToLower(strings.TrimSpace(instruction)))
	for index := range words {
		words[index] = strings.Trim(words[index], ".,!?:;")
	}
	return words
}

func isUndoCommand(word string) bool {
	return oneOf(word, "undo", "rollback", "anuleaza", "anulează")
}
