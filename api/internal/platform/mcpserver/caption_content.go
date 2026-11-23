package mcpserver

import (
	"cmp"
	"encoding/json"
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

type dialogueTimeline struct {
	Tracks []document.Track `json:"tracks"`
	Assets []document.Asset `json:"assets"`
}

func captionTimeline(plan any) dialogueTimeline {
	var timeline dialogueTimeline
	fields, _ := plan.(map[string]any)
	for key, target := range map[string]any{"tracks": &timeline.Tracks, "assets": &timeline.Assets} {
		if data, err := json.Marshal(fields[key]); err == nil {
			if json.Unmarshal(data, target) != nil {
				return dialogueTimeline{}
			}
		}
	}
	return timeline
}

func reviewCaptionContent(doc document.Document, plans ...dialogueTimeline) map[string]any {
	review := map[string]any{"status": "not_checked", "evidence": "narration-text-comparison", "audioInspection": false,
		"instructions": "Differences are review prompts, not proof of a speech error. Check names and omissions against approved narration/sources. Reuse explicit permission for unambiguous transcription fixes; ask once for unresolved wording or missing scope. For a single word, use the intact captionId, zero-based wordIndex and exact from/to in captionTextEdits. Never regenerate successful speech or change timings/grouping/styles automatically."}
	var speech, captions []document.Job
	for _, jobs := range [][]document.Job{doc.Jobs, doc.Before, doc.After} {
		for _, job := range jobs {
			if job.Type == "speech.generate" {
				if job.ResultAssetID == "" {
					review["reason"] = "Speech generation is unresolved."
					return review
				}
				if job.Text == "" {
					job.Text = job.Input
				}
				speech = append(speech, job)
			}
			if job.Type == "captions.generate" {
				if len(job.ResultTextIDs) == 0 {
					review["reason"] = "Caption generation is unresolved."
					return review
				}
				captions = append(captions, job)
			}
		}
	}
	if len(speech) == 0 || len(captions) == 0 {
		review["reason"] = "Requires resolved speech and materialized captions."
		return review
	}
	language := speech[0].Language
	assets := make(map[string]bool, len(speech))
	for _, job := range speech {
		if language == "" || language == "auto" || job.Language != language || assets[job.ResultAssetID] || strings.TrimSpace(job.Text) == "" {
			review["reason"] = "Missing, duplicate or mixed-language speech source."
			return review
		}
		assets[job.ResultAssetID] = true
	}
	if len(speech) > 1 {
		timeline := dialogueTimeline{Tracks: doc.Tracks}
		if len(plans) > 0 && len(plans[0].Tracks) > 0 {
			timeline = plans[0]
		}
		if !orderSpeechClips(speech, timeline) {
			review["reason"] = "Dialogue requires distinct audible, untrimmed speech clips with non-overlapping timeline intervals."
			return review
		}
	} else if len(speech) == 1 && len(plans) > 0 && len(plans[0].Tracks) > 0 {
		if truncatedSpeechClip(speech[0], plans[0]) {
			review["status"] = "review_required"
			review["narrationTruncated"] = true
			review["reason"] = "Speech audio clip is trimmed shorter than its measured duration; extend outPoint and video clips to cover the full narration."
			return review
		}
	}
	explicit := map[string]bool{}
	for _, job := range captions {
		if job.Language != language || job.AssetID != "" && (!assets[job.AssetID] || explicit[job.AssetID]) {
			review["reason"] = "Captions reference a different language, duplicate or unrelated audio source."
			return review
		}
		if job.AssetID != "" {
			explicit[job.AssetID] = true
		}
	}
	if len(explicit) > 0 && (len(explicit) != len(assets) || len(explicit) != len(captions)) {
		review["reason"] = "Explicit caption sources do not cover the resolved speech sequence."
		return review
	}
	texts := make(map[string]document.TextItem, len(doc.Texts))
	for _, text := range doc.Texts {
		texts[text.ID] = text
	}
	var expected, actual []captionToken
	for _, job := range speech {
		expected = append(expected, reviewTokens(job.Text, "")...)
		if len(expected) > maxCaptionReviewTokens {
			break
		}
	}
	var cues []document.TextItem
	for _, job := range captions {
		for _, id := range job.ResultTextIDs {
			text, exists := texts[id]
			if !exists || !text.IsCaption {
				review["reason"] = "A caption result ID has no materialized caption entry."
				return review
			}
			cues = append(cues, text)
			delete(texts, id)
		}
	}
	slices.SortStableFunc(cues, func(a, b document.TextItem) int { return cmp.Compare(a.Start, b.Start) })
	for _, cue := range cues {
		actual = append(actual, reviewTokens(cue.Text, cue.ID)...)
		if len(actual) > maxCaptionReviewTokens {
			break
		}
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

func truncatedSpeechClip(job document.Job, timeline dialogueTimeline) bool {
	var assetDuration document.Time
	for _, asset := range timeline.Assets {
		if asset.ID == job.ResultAssetID || asset.File == job.ResultAssetID {
			assetDuration = asset.Duration
			break
		}
	}
	if assetDuration <= 0 {
		return false
	}
	for _, track := range timeline.Tracks {
		if track.Type != "audio" || track.Muted || track.Hidden {
			continue
		}
		for _, clip := range track.Clips {
			if clip.Volume <= 0 || clip.AssetID != job.ResultAssetID {
				continue
			}
			if clip.InPoint > document.Seconds(0.15) || clip.OutPoint < assetDuration-document.Seconds(0.15) {
				return true
			}
		}
	}
	return false
}

func orderSpeechClips(speech []document.Job, timeline dialogueTimeline) bool {
	clips := make(map[string][]document.Clip)
	for _, track := range timeline.Tracks {
		if track.Type == "audio" && !track.Muted && !track.Hidden {
			for _, clip := range track.Clips {
				if clip.Volume > 0 {
					clips[clip.AssetID] = append(clips[clip.AssetID], clip)
				}
			}
		}
	}
	duration := map[string]document.Time{}
	for _, asset := range timeline.Assets {
		duration[asset.ID] = asset.Duration
	}
	for _, job := range speech {
		items := clips[job.ResultAssetID]
		if len(items) != 1 || items[0].InPoint != 0 || items[0].Duration() <= 0 || duration[job.ResultAssetID] > 0 && items[0].OutPoint != duration[job.ResultAssetID] {
			return false
		}
	}
	slices.SortFunc(speech, func(a, b document.Job) int {
		return cmp.Compare(clips[a.ResultAssetID][0].Start, clips[b.ResultAssetID][0].Start)
	})
	for i := 1; i < len(speech); i++ {
		if clips[speech[i].ResultAssetID][0].Start < clips[speech[i-1].ResultAssetID][0].End() {
			return false
		}
	}
	return true
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
