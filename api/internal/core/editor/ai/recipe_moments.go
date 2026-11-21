package ai

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/subtitles"
)

const (
	minSpokenMoment    = 4.2
	targetSpokenMoment = 15.0
	maxSpokenMoment    = 24.0
	maxSpokenPause     = 2.5
)

func groupRecipeMoments(clipID string, segments []subtitles.TranscriptSegment, offset int) []recipeMoment {
	var moments []recipeMoment
	var group []subtitles.TranscriptSegment
	flush := func() {
		if len(group) == 0 {
			return
		}
		start, end := group[0].Start, group[len(group)-1].End
		if end-start >= minSpokenMoment && offset+len(moments) < compiler.MaxMontageRanges {
			var words []string
			for _, segment := range group {
				words = append(words, strings.TrimSpace(segment.Text))
			}
			text := strings.Join(words, " ")
			if len(text) > 160 {
				text = string([]rune(text)[:min(len([]rune(text)), 160)])
			}
			moments = append(moments, recipeMoment{
				ID: fmt.Sprintf("m%03d", offset+len(moments)+1), ClipID: clipID,
				From: document.Seconds(start), To: document.Seconds(end), Text: text,
			})
		}
		group = nil
	}
	for _, segment := range segments {
		if segment.End <= segment.Start || isTranscriptFiller(segment.Text) {
			continue
		}
		if len(group) > 0 {
			previous := group[len(group)-1]
			if segment.Start < previous.End {
				continue
			}
			if segment.Start-previous.End > maxSpokenPause || segment.End-group[0].Start > maxSpokenMoment && previous.End-group[0].Start >= minSpokenMoment {
				flush()
			}
		}
		group = append(group, segment)
		if segment.End-group[0].Start >= targetSpokenMoment {
			flush()
		}
	}
	flush()
	return moments
}

func isTranscriptFiller(text string) bool {
	normalized := strings.ToLower(strings.Trim(strings.TrimSpace(text), " .,!*-\"'"))
	switch normalized {
	case "", "thank you", "bye", "ok", "okay", "mm-hmm", "uh", "um", "sigh", "laughs", "da", "pa", "mersi", "mulțumesc":
		return true
	}
	return false
}

var finalMinutesPattern = regexp.MustCompile(`(?i)(\d+(?:[.,]\d+)?)\s*(?:minutes?|mins?|minut(?:e|ă|a)?|min)\b`)
var finalSecondsPattern = regexp.MustCompile(`(?i)(\d+(?:[.,]\d+)?)\s*(?:seconds?|secs?|secund(?:e|ă|a)?|s)\b`)
var transitionSecondsPattern = regexp.MustCompile(`(?i)(\d+(?:[.,]\d+)?)\s*(?:seconds?|secs?|secund(?:e|ă|a)?|s)\s+(?:random\s+|aleatorii\s+)?(?:transitions?|tranzi(?:ții|tii|ție|tie))\b`)
var explicitSourceRangePattern = regexp.MustCompile(`(?i)\b(?:from|de\s+la)\s+\d+(?:[.,]\d+)?\s*(?:s|seconds?|secunde)?\s+(?:to|p(?:â|a)n(?:ă|a)\s+la)\s+\d+(?:[.,]\d+)?`)

func requestedFinalDuration(instruction string) (document.Time, bool) {
	if matches := finalMinutesPattern.FindAllStringSubmatch(instruction, -1); len(matches) == 1 {
		value, err := strconv.ParseFloat(strings.ReplaceAll(matches[0][1], ",", "."), 64)
		if err == nil && value > 0 {
			return document.Seconds(value * 60), true
		}
	}
	folded := normalizeIntentText(instruction)
	if !strings.Contains(folded, "final") && !strings.Contains(folded, "around") && !strings.Contains(folded, "aproximativ") && !strings.Contains(folded, "duration") {
		return 0, false
	}
	for _, match := range finalSecondsPattern.FindAllStringSubmatchIndex(instruction, -1) {
		before := normalizeIntentText(instruction[max(0, match[0]-70):match[0]])
		if !strings.Contains(before, "final") && !strings.Contains(before, "around") && !strings.Contains(before, "aproximativ") && !strings.Contains(before, "duration") {
			continue
		}
		value, err := strconv.ParseFloat(strings.ReplaceAll(instruction[match[2]:match[3]], ",", "."), 64)
		if err == nil && value > 0 {
			return document.Seconds(value), true
		}
	}
	return 0, false
}

func requestedMontageTransition(instruction string) (document.Time, bool) {
	if value, ok := requestedTransitionDuration(instruction); ok {
		return document.Seconds(value), true
	}
	matches := transitionSecondsPattern.FindStringSubmatch(instruction)
	if len(matches) < 2 {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.ReplaceAll(matches[1], ",", "."), 64)
	if err != nil || value <= 0 {
		return 0, false
	}
	return document.Seconds(value), true
}

func hasExplicitSourceRanges(instruction string) bool {
	return explicitSourceRangePattern.MatchString(instruction)
}

func resolveRecipeMontage(m *document.Montage, picks []recipeMomentChoice, analysis recipeAnalysis, instruction string, project project) error {
	ids := recipeTargetIDs(project, instruction)
	if len(ids) == 0 {
		return fmt.Errorf("no unlocked video clip can be targeted by this montage")
	}
	m.Target = document.Selector{Kind: "video", IDs: ids}
	if duration, ok := requestedFinalDuration(instruction); ok {
		m.TargetDuration = duration
		m.Tolerance = 0
		if strings.Contains(normalizeIntentText(instruction), "around") || strings.Contains(normalizeIntentText(instruction), "aproximativ") || strings.Contains(normalizeIntentText(instruction), "about") {
			m.Tolerance = 5 * document.Second
		}
	} else if m.TargetDuration > 0 && m.TargetDuration < document.Second {
		return fmt.Errorf("final video duration must be expressed in seconds, not milliseconds")
	}
	if duration, ok := requestedMontageTransition(instruction); ok {
		if m.Between == nil {
			m.Between = &document.MontageBetween{}
		}
		m.Between.Duration = duration
		m.Between.Policy = "error"
		if strings.Contains(normalizeIntentText(instruction), "random transition") || strings.Contains(normalizeIntentText(instruction), "tranzit aleator") {
			m.Between.PresetChoice = document.PresetChoice{Random: true}
		}
	}
	if normalized := normalizeIntentText(instruction); strings.Contains(normalized, "random zoom") || strings.Contains(normalized, "zoom aleator") {
		m.Motion = &document.PresetChoice{Random: true, Family: "zoom"}
	}
	if !analysis.Requested || hasExplicitSourceRanges(instruction) {
		return nil
	}
	if len(picks) == 0 {
		return fmt.Errorf("choose at least one analyzed moment ID for a content-based edit")
	}
	if len(analysis.Moments) == 0 {
		return fmt.Errorf("no complete spoken moments are available for a content-based edit")
	}
	priorities := make(map[string]int, len(picks))
	for _, pick := range picks {
		if pick.Score < 0 || pick.Score > 100 {
			return fmt.Errorf("moment %q has a score outside 0–100", pick.ID)
		}
		priorities[pick.ID] = max(priorities[pick.ID], max(50, pick.Score))
	}
	m.Ranges = nil
	m.Candidates = make([]document.MontageRange, 0, len(analysis.Moments))
	for _, moment := range analysis.Moments {
		m.Candidates = append(m.Candidates, document.MontageRange{
			ClipID: moment.ClipID, From: moment.From, To: moment.To, Score: max(1, priorities[moment.ID]),
		})
	}
	return nil
}

func ensureRecipeFamilies(selection toolSelection, instruction string) toolSelection {
	normalized := normalizeIntentText(instruction)
	add := func(family string) {
		if !oneOf(family, selection.Families...) {
			selection.Families = append(selection.Families, family)
		}
	}
	for _, term := range []string{"important parts", "best moments", "highlights", "partile importante", "momentele importante"} {
		if strings.Contains(normalized, term) {
			add(familyCut)
			selection.Analysis.NeedTranscript = true
			break
		}
	}
	if strings.Contains(normalized, "transition") || strings.Contains(normalized, "tranzit") {
		add(familyTransition)
	}
	if strings.Contains(normalized, "zoom") {
		add(familyTransform)
	}
	if strings.Contains(normalized, "caption") || strings.Contains(normalized, "subtit") {
		if requestsCaptionEncodingRepair(instruction) {
			add(familyText)
		} else {
			add(familyCaption)
		}
	}
	return selection
}

func ensureRecipeCaptions(doc *document.Document, instruction string) {
	if requestsCaptionEncodingRepair(instruction) {
		return
	}
	normalized := normalizeIntentText(instruction)
	if !strings.Contains(normalized, "caption") && !strings.Contains(normalized, "subtit") {
		return
	}
	language := "auto"
	if strings.Contains(normalized, "romanian") || strings.Contains(normalized, "romana") {
		language = "ro"
	}
	for index := range doc.After {
		if doc.After[index].Type != "captions.generate" {
			continue
		}
		doc.After[index].Language = language
		if doc.Montage != nil {
			doc.After[index].Input = "montage"
		}
		return
	}
	job := document.Job{ID: "ai-captions", Type: "captions.generate", Language: language, MaxWords: 4}
	if doc.Montage != nil {
		job.Input = "montage"
	}
	doc.After = append(doc.After, job)
}
