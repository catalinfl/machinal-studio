package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"ffmpeg-go-server/internal/integrations/typesafe"
)

const (
	familyMedia      = "media"
	familyCut        = "cut"
	familyTrim       = "trim"
	familyPreset     = "preset"
	familyTransition = "transition"
	familyText       = "text"
	familyCaption    = "caption"
	familyEffect     = "effect"
	familyTransform  = "transform"
	familyImage      = "image"
	familySpeech     = "speech"

	routerYesThreshold = 0.5
)

var errToolRouting = errors.New("AI tool routing failed")

var familyDecisions = []struct {
	family       string
	instructions string
}{
	{familyMedia, "Does this edit require adding an existing Media Bin video, audio, or image source onto the timeline? This does not include editing a clip already on the timeline or generating new media."},
	{familyCut, "Does this edit require splitting, removing, moving, or keeping only part of a timeline clip, or removing its source audio? Keeping selected highlights requires cutting away the rest."},
	{familyTrim, "Does this edit require retiming a clip, changing playback speed, or adjusting the volume of a clip already on the timeline?"},
	{familyPreset, "Does this edit require applying a color grade or a named visual look to one or more clips?"},
	{familyTransition, "Does this edit require adding or changing a transition between clips?"},
	{familyText, "Does this edit require on-screen text, titles, labels, or correcting existing caption/subtitle text (spelling, diacritics or encoding)? Creating new captions belongs to caption, but correcting existing text belongs to text."},
	{familyCaption, "Does this edit require generating new subtitles, captions, or active-word speech highlights on screen? Correcting encoding, diacritics or spelling in existing captions without new transcription belongs to text, not caption."},
	{familyEffect, "Does this edit require a visual or audio channel effect or filter, other than a clip color-grade preset?"},
	{familyTransform, "Does this edit require repositioning or animating a clip, including zoom, pan, or motion presets?"},
	{familyImage, "Does this edit require generating a new AI image or overlay, rather than placing an existing image onto the timeline?"},
	{familySpeech, "Does this edit require generating spoken narration with text-to-speech? Transcribing existing speech does not count."},
}

var allExecutorFamilies = func() []string {
	families := make([]string, 0, len(familyDecisions))
	for _, decision := range familyDecisions {
		families = append(families, decision.family)
	}
	return families
}()

const transcriptDecision = "Does planning this edit require understanding what is spoken in existing audio or video, including selecting moments based on dialogue? Generating narration alone does not require transcribing existing media."

type toolSelection struct {
	Families []string
	Analysis analysisScope
}

func compactProjectSummary(project project) []byte {
	type trackSummary struct {
		Type      string `json:"type"`
		Locked    bool   `json:"locked"`
		ClipCount int    `json:"clipCount"`
	}
	type sourceSummary struct {
		Name string    `json:"name"`
		Kind mediaKind `json:"kind"`
	}
	const maxContextItems = 24
	tracks := make([]trackSummary, 0, min(len(project.Tracks), maxContextItems))
	for _, track := range project.Tracks {
		if len(tracks) == maxContextItems {
			break
		}
		tracks = append(tracks, trackSummary{Type: track.Type, Locked: track.Locked, ClipCount: len(track.Clips)})
	}
	sources := make([]sourceSummary, 0, min(len(project.Sources), maxContextItems))
	for _, source := range project.Sources {
		if len(sources) == maxContextItems {
			break
		}
		sources = append(sources, sourceSummary{Name: source.Name, Kind: source.Kind})
	}
	summary := map[string]any{
		"duration":    project.Duration,
		"aspect":      project.Aspect,
		"playhead":    project.Focus.Playhead,
		"selected":    len(project.Focus.SelectedClipIDs),
		"trackCount":  len(project.Tracks),
		"sourceCount": len(project.Sources),
		"tracks":      tracks,
		"sources":     sources,
	}
	encoded, _ := json.Marshal(summary)
	return encoded
}

func buildJevRoutingRequest(instruction string, project project, model string) typesafe.Request {
	questions := make(map[string]typesafe.Question, len(familyDecisions)+1)
	for _, decision := range familyDecisions {
		questions["tool_"+decision.family] = typesafe.Question{Type: "noul", Instructions: decision.instructions}
	}
	questions["analysis_transcript"] = typesafe.Question{Type: "noul", Instructions: transcriptDecision}
	return typesafe.Request{
		Model: model,
		State: map[string]any{
			"instruction": instruction,
			"project":     json.RawMessage(compactProjectSummary(project)),
		},
		Questions: questions,
	}
}

func parseJevToolSelection(response typesafe.Response) (toolSelection, error) {
	decision := func(key string) (bool, error) {
		answer, ok := response.Answers[key]
		if !ok || answer.Type != "noul" || answer.Noul == nil || math.IsNaN(*answer.Noul) || *answer.Noul < 0 || *answer.Noul > 1 {
			return false, fmt.Errorf("Jev returned an invalid answer for %s", key)
		}
		return *answer.Noul >= routerYesThreshold, nil
	}
	selection := toolSelection{}
	for _, family := range allExecutorFamilies {
		selected, err := decision("tool_" + family)
		if err != nil {
			return toolSelection{}, err
		}
		if selected {
			selection.Families = append(selection.Families, family)
		}
	}
	needsTranscript, err := decision("analysis_transcript")
	if err != nil {
		return toolSelection{}, err
	}
	selection.Analysis.NeedTranscript = needsTranscript
	if oneOf(familyCaption, selection.Families...) {
		selection.Analysis.NeedTranscript = true
	}
	if len(selection.Families) == 0 {
		return toolSelection{}, fmt.Errorf("Jev selected no editing tools")
	}
	return selection, nil
}

func requestToolSelection(ctx context.Context, client typesafe.Client, model, instruction string, project project) (toolSelection, error) {
	response, err := client.Evaluate(ctx, buildJevRoutingRequest(instruction, project, model))
	if err != nil {
		return toolSelection{}, fmt.Errorf("%w: %w", errToolRouting, err)
	}
	selection, err := parseJevToolSelection(response)
	if err != nil {
		return toolSelection{}, fmt.Errorf("%w: %w", errToolRouting, err)
	}
	return allowMediaForTimelineHighlights(selection, project), nil
}

func allowMediaForTimelineHighlights(selection toolSelection, project project) toolSelection {
	if !selection.Analysis.NeedTranscript ||
		!oneOf(familyCut, selection.Families...) || !oneOf(familyTransition, selection.Families...) ||
		oneOf(familyMedia, selection.Families...) {
		return selection
	}
	clipID := ""
	switch len(project.Focus.SelectedClipIDs) {
	case 0:
		for _, track := range project.Tracks {
			if track.Type != trackTypeVideo {
				continue
			}
			for _, clip := range track.Clips {
				if clipID != "" {
					return selection
				}
				clipID = clip.ID
			}
		}
	case 1:
		clipID = project.Focus.SelectedClipIDs[0]
	default:
		return selection
	}
	target, ok := clipTargets(project)[clipID]
	if !ok || target.Track.Type != trackTypeVideo {
		return selection
	}
	source, ok := sourceForAnalysisClip(project, target.Clip)
	if ok && source.Kind == mediaKindVideo {
		selection.Families = append(selection.Families, familyMedia)
	}
	return selection
}
