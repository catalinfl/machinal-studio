package mcpserver

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/compositions"
)

const maxCaptionTextEdits = 32

type captionTextEdit struct {
	From      string `json:"from"`
	To        string `json:"to"`
	CaptionID string `json:"captionId,omitempty" jsonschema:"Exact materialized caption ID for a single timed word correction; supply wordIndex too."`
	WordIndex *int   `json:"wordIndex,omitempty" jsonschema:"Zero-based timed word in captionId; from must exactly match that word including punctuation."`
}

var captionTokens = regexp.MustCompile(`\S+`)

func replaceCaptionWord(doc *document.Document, edit captionTextEdit) error {
	if edit.CaptionID == "" || edit.WordIndex == nil || *edit.WordIndex < 0 || len(strings.Fields(edit.To)) != 1 || strings.TrimSpace(edit.To) != edit.To {
		return errors.New("Scoped corrections need captionId, nonnegative wordIndex and one replacement word")
	}
	for i := range doc.Texts {
		cue := &doc.Texts[i]
		if !cue.IsCaption || cue.ID != edit.CaptionID {
			continue
		}
		index := *edit.WordIndex
		spans := captionTokens.FindAllStringIndex(cue.Text, -1)
		if index >= len(cue.Words) || len(spans) != len(cue.Words) || cue.Words[index].Text != edit.From {
			return fmt.Errorf("Cannot match timed word %d in caption %q; inspect the intact baseline's words", index, cue.ID)
		}
		span := spans[index]
		if cue.Text[span[0]:span[1]] != edit.From {
			return fmt.Errorf("Visible token and timed word %d differ in caption %q", index, cue.ID)
		}
		cue.Text = cue.Text[:span[0]] + edit.To + cue.Text[span[1]:]
		cue.Words[index].Text = edit.To
		return nil
	}
	return fmt.Errorf("Unknown baseline captionId %q", edit.CaptionID)
}

func compareCaptionBaseline(yaml, baseline string, edits []captionTextEdit, approved bool) (map[string]any, error) {
	if baseline == "" {
		if len(edits) > 0 || approved {
			return nil, errors.New("Caption text edits require an intact captionBaseline; never establish a new baseline without comparing the authorized changes.")
		}
		return nil, nil
	}
	if len(edits) > maxCaptionTextEdits || len(edits) > 0 && !approved {
		return nil, fmt.Errorf("Use at most %d explicitly approved captionTextEdits and captionEditsApproved=true", maxCaptionTextEdits)
	}
	input, _, err := compositions.ParseProject([]byte(baseline))
	if err != nil {
		return nil, fmt.Errorf("Cannot compare captions: captionBaseline is not valid resolved YAML: %w", err)
	}
	textIDs := make(map[string]bool, len(input.Document.Texts))
	for _, text := range input.Document.Texts {
		textIDs[text.ID] = true
	}
	hasResultIDs := false
	for _, jobs := range [][]document.Job{input.Document.Jobs, input.Document.Before, input.Document.After} {
		for _, job := range jobs {
			for _, id := range job.ResultTextIDs {
				hasResultIDs = true
				if !textIDs[id] {
					return nil, errors.New("Caption baseline has unresolved resultTextIds; recover the complete materialized entries before comparing, without regenerating captions")
				}
			}
		}
	}
	original := captionVersion(&input.Document)
	for _, edit := range edits {
		if edit.From == "" || edit.From == edit.To || len(edit.From) > maxContractText || len(edit.To) > maxContractText {
			return nil, errors.New("Each captionTextEdits entry needs a bounded nonempty from and a different to string")
		}
		if edit.CaptionID != "" || edit.WordIndex != nil {
			if err := replaceCaptionWord(&input.Document, edit); err != nil {
				return nil, err
			}
			continue
		}
		matched := false
		for index := range input.Document.Texts {
			text := &input.Document.Texts[index]
			if !text.IsCaption {
				continue
			}
			matched = matched || strings.Contains(text.Text, edit.From)
			text.Text = strings.ReplaceAll(text.Text, edit.From, edit.To)
			for word := range text.Words {
				matched = matched || strings.Contains(text.Words[word].Text, edit.From)
				text.Words[word].Text = strings.ReplaceAll(text.Words[word].Text, edit.From, edit.To)
			}
		}
		if !matched {
			return nil, errors.New("A captionTextEdits source string does not occur in the baseline captions")
		}
	}
	parsed, _, err := compositions.ParseProject([]byte(yaml))
	if err != nil {
		return nil, fmt.Errorf("Cannot compare caption preservation: invalid current recipe: %w", err)
	}
	current := captionVersion(&parsed.Document)
	if current == "" || current != captionVersion(&input.Document) {
		return nil, errors.New("Caption preservation failed: current complete text entries/resultTextIds differ beyond the approved exact replacements. Restore baseline timings, IDs, grouping, words, layout and styling.")
	}
	if len(input.Document.Texts) == 0 && !hasResultIDs {
		return map[string]any{"status": "not_applicable", "completeEntriesCompared": false, "reason": "Neither recipe contains text entries or caption result IDs."}, nil
	}
	return map[string]any{"status": "preserved", "baselineVersion": original, "captionVersion": current, "approvedTextEdits": len(edits), "completeEntriesCompared": true}, nil
}
