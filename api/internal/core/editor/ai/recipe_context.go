package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"slices"
	"strings"
	"time"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/subtitles"
)

const maxRecipeContextBytes = 64 << 10
const maxRecipeAnalysisClips = 24

type recipeAnalysis struct {
	Requested bool           `json:"requested"`
	Moments   []recipeMoment `json:"moments,omitempty"`
	segments  map[string][]subtitles.TranscriptSegment
}

type recipeMoment struct {
	ID     string        `json:"id"`
	ClipID string        `json:"clipId"`
	From   document.Time `json:"from"`
	To     document.Time `json:"to"`
	Text   string        `json:"text"`
}

var analyzeRecipeWindow = subtitles.AnalyzeWindow

func recipeProject(input compiler.Input, playhead float64) project {
	p := project{FPS: input.Document.Output.FPS, Aspect: input.Document.Output.Aspect, Focus: focus{Playhead: playhead}}
	assets := make(map[string]document.Asset)
	for _, asset := range input.Assets {
		assets[asset.ID] = asset
		mode := "proxy"
		if asset.Local {
			mode = "wasm"
		}
		p.Sources = append(p.Sources, mediaSource{ID: asset.ID, Name: asset.File, Kind: mediaKind(asset.Kind), SourceMode: mode, Duration: asset.Duration.Seconds()})
	}
	if input.Snapshot == nil {
		return p
	}
	for _, t := range input.Snapshot.Tracks {
		item := track{ID: t.ID, Name: t.Name, Type: t.Type, Locked: t.Locked, Muted: t.Muted, Hidden: t.Hidden}
		for _, c := range t.Clips {
			asset := assets[c.AssetID]
			kind := mediaKind(asset.Kind)
			if t.Type == "audio" {
				kind = mediaKindAudio
			}
			item.Clips = append(item.Clips, clip{ID: c.ID, Name: asset.File, SourceID: c.AssetID, SourceDuration: asset.Duration.Seconds(), MediaKind: kind, Start: c.Start.Seconds(), End: c.End().Seconds(), SourceIn: c.InPoint.Seconds(), SourceOut: c.OutPoint.Seconds(), Rate: c.PlaybackRate, LinkedID: c.LinkedClipID, MotionPreset: c.Motion})
			p.Duration = max(p.Duration, c.End().Seconds())
			if slices.Contains(input.Snapshot.SelectedIDs, c.ID) {
				p.Focus.SelectedClipIDs = append(p.Focus.SelectedClipIDs, c.ID)
			}
			for i := range p.Sources {
				if p.Sources[i].ID == c.AssetID {
					p.Sources[i].TimelineClipIDs = append(p.Sources[i].TimelineClipIDs, c.ID)
				}
			}
		}
		p.Tracks = append(p.Tracks, item)
	}
	return p
}

func recipeTargetIDs(p project, instruction string) []string {
	mentioned := specificallyMentionedSourceIDs(instruction, p.Sources)
	var all, selected, named, under []string
	for _, track := range p.Tracks {
		if track.Locked || track.Type != "video" {
			continue
		}
		for _, clip := range track.Clips {
			all = append(all, clip.ID)
			if mentioned[clip.SourceID] || strings.Contains(instruction, clip.ID) {
				named = append(named, clip.ID)
			}
			if slices.Contains(p.Focus.SelectedClipIDs, clip.ID) {
				selected = append(selected, clip.ID)
			}
			if clip.Start <= p.Focus.Playhead && clip.End > p.Focus.Playhead {
				under = append(under, clip.ID)
			}
		}
	}
	if len(named) > 0 {
		return named
	}
	normalized := normalizeIntentText(instruction)
	for _, word := range []string{"all clips", "every clip", "all videos", "entire timeline", "toate clipurile", "toate video", "intregul timeline"} {
		if strings.Contains(normalized, word) {
			return all
		}
	}
	if len(selected) > 0 {
		return selected
	}
	if len(under) == 1 {
		return under
	}
	return all
}

func analyzeRecipe(ctx context.Context, input compiler.Input, p project, selection toolSelection, instruction, root, session string) (recipeAnalysis, error) {
	analysis := recipeAnalysis{segments: make(map[string][]subtitles.TranscriptSegment)}
	if !selection.Analysis.NeedTranscript || !oneOf(familyCut, selection.Families...) {
		return analysis, nil
	}
	analysis.Requested = true
	ids := recipeTargetIDs(p, instruction)
	if len(ids) == 0 || len(ids) > maxRecipeAnalysisClips {
		return analysis, fmt.Errorf("content editing requires between 1 and %d targeted video clips", maxRecipeAnalysisClips)
	}
	started := time.Now()
	language := ""
	normalized := normalizeIntentText(instruction)
	if strings.Contains(normalized, "romanian") || strings.Contains(normalized, "romana") {
		language = "ro"
	}
	ctx, cancel := context.WithTimeout(ctx, analysisRequestTimeout)
	defer cancel()
	for _, id := range ids {
		var target document.Clip
		for _, track := range input.Snapshot.Tracks {
			for _, clip := range track.Clips {
				if clip.ID == id {
					target = clip
				}
			}
		}
		assetIndex := slices.IndexFunc(input.Assets, func(a document.Asset) bool { return a.ID == target.AssetID })
		if assetIndex < 0 {
			return analysis, fmt.Errorf("analysis source missing for %s", id)
		}
		asset := input.Assets[assetIndex]
		if asset.Local {
			return analysis, fmt.Errorf("content analysis requires server media: %s", asset.File)
		}
		subtitles.WarmFile(ctx, session, root, asset.File)
		segments, err := analyzeRecipeWindow(ctx, root, asset.File, target.InPoint.Seconds(), (target.OutPoint - target.InPoint).Seconds(), language)
		if err != nil {
			return analysis, fmt.Errorf("analyze %s: %w", asset.File, err)
		}
		if len(segments) == 0 {
			return analysis, fmt.Errorf("no timestamped speech available for %s; transcript-based highlights cannot be selected", asset.File)
		}
		analysis.segments[id] = segments
		analysis.Moments = append(analysis.Moments, groupRecipeMoments(id, segments, len(analysis.Moments))...)
	}
	if len(analysis.Moments) == 0 {
		return analysis, fmt.Errorf("analysis contains no usable complete spoken moments for the requested edit")
	}
	log.Printf("[AI TIMING] stage=analysis elapsed=%s clips=%d coverage=complete", time.Since(started), len(ids))
	return analysis, nil
}

func validateRecipeEvidence(m document.Montage, analysis recipeAnalysis, explicitRanges bool) error {
	if !analysis.Requested {
		return nil
	}
	if explicitRanges && len(m.Ranges) > 0 {
		return nil
	}
	ranges := append(slices.Clone(m.Ranges), m.Candidates...)
	if len(ranges) == 0 {
		return fmt.Errorf("content-based montage must select complete analyzed moments")
	}
	for index, r := range ranges {
		segments := analysis.segments[r.ClipID]
		from, to := false, false
		for _, segment := range segments {
			from = from || math.Abs(segment.Start-r.From.Seconds()) <= 0.001
			to = to || math.Abs(segment.End-r.To.Seconds()) <= 0.001
		}
		if !from || !to {
			return fmt.Errorf("montage range %d must begin/end on supplied transcript boundaries for %s", index, r.ClipID)
		}
	}
	return nil
}

func recipeContext(input compiler.Input, p project, selection toolSelection, analysis recipeAnalysis, instruction string) ([]byte, error) {
	ids := recipeTargetIDs(p, instruction)
	include := make(map[string]bool)
	for _, id := range ids {
		include[id] = true
	}
	for _, id := range input.Snapshot.SelectedIDs {
		include[id] = true
	}
	for _, track := range p.Tracks {
		for index, clip := range track.Clips {
			if !slices.Contains(ids, clip.ID) {
				continue
			}
			include[clip.LinkedID] = true
			if index > 0 {
				include[track.Clips[index-1].ID] = true
			}
			if index+1 < len(track.Clips) {
				include[track.Clips[index+1].ID] = true
			}
		}
	}
	used := make(map[string]bool)
	var tracks []any
	for _, track := range input.Snapshot.Tracks {
		var clips []any
		for _, clip := range track.Clips {
			if len(include) > 0 && !include[clip.ID] && !include[track.ID] {
				continue
			}
			used[clip.AssetID] = true
			item := map[string]any{"id": clip.ID, "assetId": clip.AssetID, "start": clip.Start, "inPoint": clip.InPoint, "outPoint": clip.OutPoint, "rate": clip.PlaybackRate}
			if clip.LinkedClipID != "" {
				item["linkedClipId"] = clip.LinkedClipID
			}
			if oneOf(familyTransform, selection.Families...) {
				item["transform"] = clip.Transform
				item["motion"] = clip.Motion
			}
			if oneOf(familyTrim, selection.Families...) {
				item["volume"] = clip.Volume
			}
			clips = append(clips, item)
		}
		tracks = append(tracks, map[string]any{"id": track.ID, "type": track.Type, "locked": track.Locked, "clipCount": len(track.Clips), "clips": clips})
	}
	var assets []any
	for _, asset := range input.Assets {
		if !used[asset.ID] && !oneOf(familyMedia, selection.Families...) {
			continue
		}
		assets = append(assets, map[string]any{"id": asset.ID, "name": asset.File, "kind": asset.Kind, "duration": asset.Duration, "hasAudio": asset.HasAudio})
	}
	context := map[string]any{"targets": ids, "selectedIds": input.Snapshot.SelectedIDs, "playhead": p.Focus.Playhead, "tracks": tracks, "assets": assets, "duration": p.Duration, "output": input.Document.Output}
	if analysis.Requested {
		context["analysis"] = analysis
		context["transcriptFormat"] = "moments have complete source-time boundaries; select moment IDs, never copy timestamps; no visual analysis"
	}
	if oneOf(familyTransition, selection.Families...) {
		context["transitions"] = input.Snapshot.Transitions
	}
	if oneOf(familyEffect, selection.Families...) {
		context["effects"] = input.Snapshot.Effects
	}
	if oneOf(familyText, selection.Families...) {
		var texts []any
		for _, item := range input.Snapshot.TextItems {
			if !item.IsCaption {
				texts = append(texts, map[string]any{"id": item.ID, "text": item.Text, "start": item.Start, "duration": item.Duration})
			}
		}
		context["titles"] = texts
	}
	encoded, err := json.Marshal(context)
	if err != nil {
		return nil, fmt.Errorf("encode planner context: %w", err)
	}
	if len(encoded) > maxRecipeContextBytes {
		return nil, fmt.Errorf("relevant context exceeds %d bytes; select a smaller editing scope", maxRecipeContextBytes)
	}
	return encoded, nil
}
