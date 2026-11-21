package compiler

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/catalog"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/text"
)

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (s *compilation) validateCaptionJobStyle(job document.Job, path string) {
	if len(job.Style) == 0 {
		return
	}
	style := document.DefaultTextStyle()
	if err := document.DecodeJSON(job.Style, &style); err != nil {
		s.fail(path+".style", "invalid_caption_style", "caption style must contain only supported TextStyle fields")
		return
	}
	style.IsCaption = true
	probe := document.TextItem{Text: "Caption", Duration: document.Second, TextStyle: style}
	if style.HighlightMode == "word" {
		probe.Words = []document.Word{{Text: probe.Text, End: document.Second}}
	}
	s.verifyText(probe, path+".style")
}

func (s *compilation) verifyTextEncoding(item document.TextItem, path string) {
	if err := text.ValidateEncoding(item.Text); err != nil {
		s.fail(path+".text", "invalid_text_encoding", err.Error())
	}
	for index, word := range item.Words {
		if err := text.ValidateEncoding(word.Text); err != nil {
			s.fail(fmt.Sprintf("%s.words[%d].text", path, index), "invalid_text_encoding", err.Error())
		}
	}
}

func (s *compilation) validateTextEncodings() {
	replaced := make(map[string]bool)
	for index, item := range s.input.Document.Texts {
		replaced[item.ID] = true
		s.verifyTextEncoding(item, fmt.Sprintf("texts[%d]", index))
	}
	if s.input.Document.Mode != "modify" || s.input.Snapshot == nil {
		return
	}
	for index, item := range s.input.Snapshot.TextItems {
		if !replaced[item.ID] {
			s.verifyTextEncoding(item, fmt.Sprintf("snapshot.textItems[%d]", index))
		}
	}
}

func (s *compilation) verifyText(item document.TextItem, path string) {
	s.verifyTextEncoding(item, path)
	if strings.TrimSpace(item.Text) == "" || len(item.Text) > 10000 {
		s.fail(path+".text", "invalid_text", "text must be nonempty and at most 10000 bytes")
	}
	if item.Start < 0 || item.Duration <= 0 {
		s.fail(path, "text_interval", "text requires nonnegative start and positive duration")
	}
	if item.SourceClipID != "" {
		_, owner := s.findClip(item.SourceClipID)
		if owner == nil || item.Start < owner.Start || item.Start+item.Duration > owner.End() {
			s.fail(path+".sourceClipId", "text_anchor", "anchored text must fit its owner clip")
		}
	}
	if !slices.ContainsFunc(s.compiler.Catalog.Fonts, func(font struct {
		ID string `json:"id"`
	}) bool {
		return font.ID == item.FontFamily
	}) {
		s.fail(path+".fontFamily", "unknown_font", "unknown font family")
	}
	for name, value := range map[string]struct {
		value   string
		allowed []string
	}{
		"align":              {item.Align, []string{"left", "center", "right", "justify"}},
		"anchor":             {item.Anchor, []string{"", "left", "center", "right"}},
		"bannerStyle":        {item.BannerStyle, []string{"none", "rail", "block", "underline"}},
		"animation":          {item.Animation, []string{"none", "slide-left", "slide-right", "rise", "pop", "drop", "bounce", "shake", "float"}},
		"highlightMode":      {item.HighlightMode, []string{"none", "word"}},
		"highlightAnimation": {item.HighlightAnimation, []string{"none", "pop", "bounce", "slide-up", "glow"}},
	} {
		if !slices.Contains(value.allowed, value.value) {
			s.fail(path+"."+name, "invalid_style", "unsupported "+name)
		}
	}
	for name, value := range map[string]float64{"opacity": item.Opacity, "backgroundOpacity": item.BackgroundOpacity, "highlightBackgroundOpacity": item.HighlightBackgroundOpacity} {
		if !catalog.FiniteRange(value, 0, 1) {
			s.fail(path+"."+name, "invalid_style", "opacity must be 0–1")
		}
	}
	for name, value := range map[string]float64{"strokeWidth": item.StrokeWidth, "backgroundPadding": item.BackgroundPadding, "backgroundRadius": item.BackgroundRadius} {
		if !catalog.FiniteRange(value, 0, 200) {
			s.fail(path+"."+name, "invalid_style", "value must be 0–200")
		}
	}
	if !catalog.FiniteRange(item.FontSize, 8, 600) || item.FontWeight != 400 && item.FontWeight != 700 {
		s.fail(path, "invalid_font", "font size must be 8–600 and weight 400 or 700")
	}
	if !catalog.FiniteRange(item.X, -3840, 7680) || !catalog.FiniteRange(item.Y, -3840, 7680) || !catalog.FiniteRange(item.Rotation, -180, 180) || item.AnimationDuration < 0 {
		s.fail(path, "invalid_text_geometry", "invalid text position, rotation or animation duration")
	}
	for name, value := range map[string]string{"color": item.Color, "strokeColor": item.StrokeColor, "backgroundColor": item.BackgroundColor,
		"accentColor": item.AccentColor, "highlightColor": item.HighlightColor, "highlightBackgroundColor": item.HighlightBackgroundColor} {
		if !colorPattern.MatchString(value) {
			s.fail(path+"."+name, "invalid_color", "color must be #RRGGBB")
		}
	}
	lastEnd := document.Time(0)
	for index, word := range item.Words {
		if word.Start < lastEnd || word.End <= word.Start || word.End > item.Duration || strings.TrimSpace(word.Text) == "" {
			s.fail(fmt.Sprintf("%s.words[%d]", path, index), "word_timing", "word timings must be ordered, nonoverlapping and within the cue")
		}
		lastEnd = word.End
		if item.HighlightMode == "word" && len(strings.Fields(word.Text)) != 1 {
			s.fail(fmt.Sprintf("%s.words[%d].text", path, index), "word_token", "word highlighting requires one token per measured interval; use phrase highlighting for combined words")
		}
	}
	if item.HighlightMode == "word" {
		if !item.IsCaption || len(item.Words) == 0 {
			s.fail(path+".words", "missing_words", "active-word captions require materialized word timings")
		}
		words := make([]string, len(item.Words))
		for index, word := range item.Words {
			words[index] = word.Text
		}
		if strings.Join(strings.Fields(item.Text), " ") != strings.Join(words, " ") {
			s.fail(path+".words", "word_text", "caption text must match its materialized words")
		}
	}
}

func MaterializeCaptions(doc document.Document, jobID string, words []document.Word, maxWords int, style document.TextStyle) (document.Document, error) {
	return materializeCaptions(doc, jobID, words, maxWords, style, true)
}

func MaterializePhraseCaptions(doc document.Document, jobID string, phrases []document.Word, style document.TextStyle) (document.Document, error) {
	return materializeCaptions(doc, jobID, phrases, 1, style, false)
}

func materializeCaptions(doc document.Document, jobID string, words []document.Word, maxWords int, style document.TextStyle, timedWords bool) (document.Document, error) {
	if maxWords < 1 || maxWords > 50 {
		return doc, fmt.Errorf("maxWords must be 1–50")
	}
	jobIndex := slices.IndexFunc(doc.Jobs, func(job document.Job) bool { return job.ID == jobID && job.Type == "captions.generate" })
	staged := false
	if jobIndex < 0 {
		jobIndex = slices.IndexFunc(doc.After, func(job document.Job) bool { return job.ID == jobID && job.Type == "captions.generate" })
		staged = true
	}
	if jobIndex < 0 {
		return doc, fmt.Errorf("caption job %q is missing", jobID)
	}
	var job *document.Job
	if staged {
		job = &doc.After[jobIndex]
	} else {
		job = &doc.Jobs[jobIndex]
	}
	if len(job.ResultTextIDs) > 0 {
		return doc, nil
	}
	if len(words) == 0 {
		return doc, fmt.Errorf("transcript has no timed words")
	}
	if len(job.Style) > 0 {
		if err := json.Unmarshal(job.Style, &style); err != nil {
			return doc, fmt.Errorf("caption style for %q: %w", jobID, err)
		}
	}
	style.IsCaption = true
	if !timedWords {
		style.HighlightMode = "none"
	}
	words = slices.Clone(words)
	last := document.Time(0)
	for index := range words {
		word := &words[index]
		word.Text = text.RepairEncoding(word.Text)
		if err := text.ValidateEncoding(word.Text); err != nil {
			return doc, fmt.Errorf("transcript word %d: %w", index, err)
		}
		if word.Start < last || word.End <= word.Start {
			return doc, fmt.Errorf("transcript timings are invalid")
		}
		last = word.End
	}
	doc.Texts = slices.Clone(doc.Texts)
	doc.Jobs = slices.Clone(doc.Jobs)
	doc.After = slices.Clone(doc.After)
	if staged {
		job = &doc.After[jobIndex]
	} else {
		job = &doc.Jobs[jobIndex]
	}
	for index, source := range captionWordGroups(words, maxWords) {
		group := slices.Clone(source)
		start, end := group[0].Start, group[len(group)-1].End
		text := make([]string, len(group))
		for index := range group {
			text[index] = group[index].Text
			group[index].Start -= start
			group[index].End -= start
		}
		id := fmt.Sprintf("%s/caption/%d", jobID, index)
		cueWords := group
		if !timedWords {
			cueWords = []document.Word{}
		}
		doc.Texts = append(doc.Texts, document.TextItem{ID: id, Start: start, Duration: end - start, Text: strings.Join(text, " "), TextStyle: style, Words: cueWords})
		job.ResultTextIDs = append(job.ResultTextIDs, id)
	}
	doc.Revision = ""
	return doc, nil
}

func repairCaptionEncoding(item *document.TextItem) {
	if !item.IsCaption && item.HighlightMode != "word" {
		return
	}
	item.Text = text.RepairEncoding(item.Text)
	for index := range item.Words {
		item.Words[index].Text = text.RepairEncoding(item.Words[index].Text)
	}
}

const captionGroupingPause document.Time = 600_000

func captionWordGroups(words []document.Word, maxWords int) [][]document.Word {
	var groups [][]document.Word
	for _, word := range words {
		if len(groups) == 0 || len(groups[len(groups)-1]) == maxWords ||
			word.Start-groups[len(groups)-1][len(groups[len(groups)-1])-1].End > captionGroupingPause ||
			captionSentenceEnd(groups[len(groups)-1][len(groups[len(groups)-1])-1].Text) {
			groups = append(groups, nil)
		}
		index := len(groups) - 1
		groups[index] = append(groups[index], word)
	}
	for index := 1; index < len(groups); index++ {
		previous, current := groups[index-1], groups[index]
		if len(current) != 1 || len(previous) < 3 || current[0].End-current[0].Start >= document.Seconds(0.65) {
			continue
		}
		last := previous[len(previous)-1]
		if current[0].Start-last.End > captionGroupingPause || captionSentenceEnd(last.Text) {
			continue
		}
		groups[index-1] = previous[:len(previous)-1]
		groups[index] = append([]document.Word{last}, current...)
	}
	return groups
}

func captionSentenceEnd(word string) bool {
	return strings.HasSuffix(word, ".") || strings.HasSuffix(word, "!") || strings.HasSuffix(word, "?")
}
