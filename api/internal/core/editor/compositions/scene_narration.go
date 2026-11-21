package compositions

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/scenes"
	"ffmpeg-go-server/internal/core/editor/subtitles"
)

func bindSceneNarration(request scenes.Request, job document.Job, doc document.Document, assets []document.Asset) (scenes.Request, error) {
	voice, found := sceneNarrationJob(doc, job.NarrationJob)
	if !found {
		return request, fmt.Errorf("scene %q has no narration job %q", job.ID, job.NarrationJob)
	}
	assetIndex := slices.IndexFunc(assets, func(asset document.Asset) bool {
		return asset.ID == voice.ResultAssetID && asset.Kind == "audio" && !asset.Local
	})
	if assetIndex < 0 {
		return request, fmt.Errorf("generate narration %q before its scene", voice.ID)
	}
	available := assets[assetIndex].Duration.Seconds() - job.NarrationFrom.Seconds()
	if request.Duration == 0 {
		request.Duration = available
	}
	if request.Duration < 1 || request.Duration > 60 || request.Duration > available+1e-6 || job.NarrationFrom < 0 {
		return request, fmt.Errorf("scene %q must fit a measured 1–60 second narration window", job.ID)
	}
	origin, err := narrationTimelineStart(doc, voice.ID, voice.ResultAssetID)
	if err != nil {
		return request, err
	}
	start := origin + job.NarrationFrom.Seconds()
	request.NarrationCues = narrationWindowCues(doc.Texts, start, request.Duration)
	wholeNarration := job.NarrationFrom == 0 && math.Abs(request.Duration-assets[assetIndex].Duration.Seconds()) < 1e-6
	if wholeNarration {
		request.NarrationText = strings.TrimSpace(voice.Text)
		if request.NarrationText == "" {
			request.NarrationText = strings.TrimSpace(voice.Input)
		}
	} else if len(request.NarrationCues) > 0 {
		text := make([]string, len(request.NarrationCues))
		for index, cue := range request.NarrationCues {
			text[index] = cue.Text
		}
		request.NarrationText = strings.Join(text, " ")
	} else {
		return request, fmt.Errorf("scene %q needs measured captions before selecting part of a narration; generate captions first or use one speech job per section", job.ID)
	}
	if request.NarrationText == "" {
		return request, fmt.Errorf("scene %q has no known narration text; restore the speech script before generating visuals", job.ID)
	}
	request.Language = voice.Language
	return request, nil
}

func sceneNarrationJob(doc document.Document, id string) (document.Job, bool) {
	for _, jobs := range [][]document.Job{doc.Before, doc.Jobs} {
		for _, job := range jobs {
			if job.ID == id && job.Type == "speech.generate" {
				return job, true
			}
		}
	}
	return document.Job{}, false
}

func narrationTimelineStart(doc document.Document, jobID, assetID string) (float64, error) {
	for _, placement := range doc.Placements {
		if placement.Job == jobID {
			return placement.Start.Seconds(), nil
		}
	}
	for _, track := range doc.Tracks {
		for _, clip := range track.Clips {
			if clip.AssetID == assetID {
				if clip.PlaybackRate != 0 && clip.PlaybackRate != 1 {
					return 0, fmt.Errorf("narration-bound scenes need a normal-speed voice track; do not guess cue mapping for retimed speech")
				}
				return clip.Start.Seconds() - clip.InPoint.Seconds(), nil
			}
		}
	}
	return 0, nil
}

func narrationWindowCues(items []document.TextItem, start, duration float64) []subtitles.Cue {
	var cues []subtitles.Cue
	for _, item := range items {
		if !item.IsCaption {
			continue
		}
		cue := subtitles.Cue{Start: duration, Words: []subtitles.CueWord{}}
		for _, word := range item.Words {
			from := item.Start.Seconds() + word.Start.Seconds() - start
			to := item.Start.Seconds() + word.End.Seconds() - start
			if to <= 0 || from >= duration {
				continue
			}
			cue.Words = append(cue.Words, subtitles.CueWord{Text: word.Text, Start: math.Max(0, from), End: math.Min(duration, to)})
			cue.Start, cue.End = math.Min(cue.Start, math.Max(0, from)), math.Max(cue.End, math.Min(duration, to))
		}
		if len(cue.Words) > 0 {
			texts := make([]string, len(cue.Words))
			for index, word := range cue.Words {
				texts[index] = word.Text
			}
			cue.Text = strings.Join(texts, " ")
			cues = append(cues, cue)
		}
	}
	slices.SortFunc(cues, func(a, b subtitles.Cue) int {
		if a.Start < b.Start {
			return -1
		}
		if a.Start > b.Start {
			return 1
		}
		return 0
	})
	return cues
}

func hasTimelineCaptions(doc document.Document) bool {
	if slices.ContainsFunc(doc.Texts, func(item document.TextItem) bool { return item.IsCaption }) {
		return true
	}
	for _, jobs := range [][]document.Job{doc.After, doc.Jobs} {
		if slices.ContainsFunc(jobs, func(job document.Job) bool { return job.Type == "captions.generate" }) {
			return true
		}
	}
	return false
}
