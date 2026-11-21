package mcpserver

import (
	"regexp"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/compositions"
)

const maxCaptionReviewTokens = 2048
const maxCaptionDifferences = 32

var captionTokenPattern = regexp.MustCompile(`[\p{L}\p{M}\p{N}]+`)

type captionToken struct {
	text string
	id   string
}

func captionContentReview(yaml string) map[string]any {
	input, _, err := compositions.ParseProject([]byte(yaml))
	if err != nil {
		return map[string]any{"status": "not_checked", "reason": "Recipe parsing failed.", "audioInspection": false}
	}
	return reviewCaptionContent(input.Document)
}

func reviewCaptionContent(doc document.Document) map[string]any {
	review := map[string]any{"status": "not_checked", "evidence": "narration-text-comparison", "audioInspection": false,
		"instructions": "Differences are review prompts, not proof of a speech error. Check names and omissions against approved narration/sources. Reuse explicit permission for unambiguous transcription fixes; ask once for unresolved wording or missing scope. For a single word, use the intact captionId, zero-based wordIndex and exact from/to in captionTextEdits. Never regenerate successful speech or change timings/grouping/styles automatically."}
	var speech, captions []document.Job
	for _, jobs := range [][]document.Job{doc.Jobs, doc.Before, doc.After} {
		for _, job := range jobs {
			if job.Type == "speech.generate" && job.ResultAssetID != "" {
				speech = append(speech, job)
			}
			if job.Type == "captions.generate" && len(job.ResultTextIDs) > 0 {
				captions = append(captions, job)
			}
		}
	}
	if len(speech) != 1 || len(captions) != 1 || speech[0].Language == "" || speech[0].Language == "auto" || speech[0].Language != captions[0].Language {
		review["reason"] = "Requires one resolved narration and one materialized caption job in the same language; no alignment was guessed."
		return review
	}
	if captions[0].AssetID != "" && captions[0].AssetID != speech[0].ResultAssetID {
		review["reason"] = "Captions explicitly reference a different audio asset; no narration alignment was guessed."
		return review
	}
	texts := make(map[string]document.TextItem, len(doc.Texts))
	for _, text := range doc.Texts {
		texts[text.ID] = text
	}
	expected := reviewTokens(speech[0].Text, "")
	actual := []captionToken{}
	for _, id := range captions[0].ResultTextIDs {
		text, exists := texts[id]
		if !exists || !text.IsCaption {
			review["reason"] = "A caption result ID has no materialized caption entry."
			return review
		}
		actual = append(actual, reviewTokens(text.Text, id)...)
	}
	if len(expected) == 0 || len(actual) == 0 || len(expected) > maxCaptionReviewTokens || len(actual) > maxCaptionReviewTokens {
		review["reason"] = "Empty transcript or token comparison limit exceeded; no successful comparison is claimed."
		return review
	}
	differences := compareCaptionTokens(expected, actual)
	review["status"] = "matched"
	if len(differences) > 0 {
		review["status"] = "review_required"
	}
	review["totalDifferences"] = len(differences)
	review["truncated"] = len(differences) > maxCaptionDifferences
	review["differences"] = differences[:min(len(differences), maxCaptionDifferences)]
	return review
}

func reviewTokens(text, id string) []captionToken {
	matches := captionTokenPattern.FindAllString(text, maxCaptionReviewTokens+1)
	tokens := make([]captionToken, len(matches))
	for index, match := range matches {
		tokens[index] = captionToken{text: strings.ToLower(match), id: id}
	}
	return tokens
}

func compareCaptionTokens(expected, actual []captionToken) []map[string]string {
	width := len(actual) + 1
	cost := make([]uint16, (len(expected)+1)*width)
	for index := range len(expected) + 1 {
		cost[index*width] = uint16(index)
	}
	for index := range width {
		cost[index] = uint16(index)
	}
	for i := 1; i <= len(expected); i++ {
		for j := 1; j <= len(actual); j++ {
			change := uint16(0)
			if expected[i-1].text != actual[j-1].text {
				change = 1
			}
			cost[i*width+j] = min(cost[(i-1)*width+j-1]+change, cost[(i-1)*width+j]+1, cost[i*width+j-1]+1)
		}
	}
	differences := []map[string]string{}
	for i, j := len(expected), len(actual); i > 0 || j > 0; {
		if i > 0 && j > 0 && expected[i-1].text == actual[j-1].text {
			i--
			j--
			continue
		}
		difference := map[string]string{}
		switch {
		case i > 0 && j > 0 && cost[i*width+j] == cost[(i-1)*width+j-1]+1:
			difference["expected"], difference["actual"], difference["captionId"] = expected[i-1].text, actual[j-1].text, actual[j-1].id
			i--
			j--
		case i > 0 && cost[i*width+j] == cost[(i-1)*width+j]+1:
			difference["expected"], difference["actual"] = expected[i-1].text, ""
			if j < len(actual) {
				difference["captionId"] = actual[j].id
			}
			i--
		default:
			difference["expected"], difference["actual"], difference["captionId"] = "", actual[j-1].text, actual[j-1].id
			j--
		}
		for _, key := range []string{"expected", "actual"} {
			runes := []rune(difference[key])
			if len(runes) > 120 {
				difference[key] = string(runes[:120]) + "…"
			}
		}
		differences = append(differences, difference)
	}
	slices.Reverse(differences)
	return differences
}
