package projects

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

type editorState struct {
	SchemaVersion            int              `json:"schemaVersion"`
	PreparedCompositionID    string           `json:"preparedCompositionId,omitempty"`
	PreparedStateFingerprint string           `json:"preparedStateFingerprint,omitempty"`
	Timeline                 json.RawMessage  `json:"timeline"`
	Media                    []map[string]any `json:"media"`
}

type editorClip struct {
	ID                 string               `json:"id"`
	FileName           string               `json:"fileName"`
	SourceID           string               `json:"sourceId"`
	SourceMode         string               `json:"sourceMode"`
	MediaKind          string               `json:"mediaKind"`
	SourceDuration     document.Time        `json:"sourceDuration"`
	ScrubBlobURL       *string              `json:"scrubBlobUrl"`
	Start              document.Time        `json:"start"`
	InPoint            document.Time        `json:"inPoint"`
	OutPoint           document.Time        `json:"outPoint"`
	PlaybackRate       float64              `json:"playbackRate"`
	Volume             float64              `json:"volume"`
	LinkedClipID       string               `json:"linkedClipId,omitempty"`
	Transform          document.Transform   `json:"transform"`
	TransformKeyframes []document.Keyframe  `json:"transformKeyframes"`
	MotionPreset       string               `json:"motionPreset,omitempty"`
	LayerEntrance      string               `json:"layerEntrance,omitempty"`
	LayerExit          string               `json:"layerExit,omitempty"`
	Opacity            float64              `json:"opacity"`
	FadeIn             document.Time        `json:"fadeIn"`
	FadeOut            document.Time        `json:"fadeOut"`
	Provenance         *document.Provenance `json:"provenance,omitempty"`
}

func sourceMode(asset document.Asset) string {
	if asset.Local {
		return "wasm"
	}
	return "proxy"
}

func projectClip(clip document.Clip, asset document.Asset, trackType string) editorClip {
	kind := asset.Kind
	if trackType == "audio" {
		kind = "audio"
	}
	keyframes := append([]document.Keyframe{}, clip.TransformKeyframes...)
	return editorClip{ID: clip.ID, FileName: asset.File, SourceID: asset.ID, SourceMode: sourceMode(asset),
		MediaKind: kind, SourceDuration: asset.Duration, Start: clip.Start, InPoint: clip.InPoint, OutPoint: clip.OutPoint,
		PlaybackRate: clip.PlaybackRate, Volume: clip.Volume, LinkedClipID: clip.LinkedClipID,
		Transform: clip.Transform, TransformKeyframes: keyframes, MotionPreset: clip.Motion,
		LayerEntrance: clip.LayerEntrance, LayerExit: clip.LayerExit, Opacity: clip.Opacity,
		FadeIn: clip.FadeIn, FadeOut: clip.FadeOut, Provenance: clip.Provenance}
}

func projectChannels(compiled *composition.Composition) ([]map[string]any, error) {
	assets := make(map[string]document.Asset, len(compiled.Assets))
	for _, asset := range compiled.Assets {
		assets[asset.ID] = asset
	}
	channels := make([]map[string]any, 0, len(compiled.Tracks))
	for _, track := range compiled.Tracks {
		clips := make([]editorClip, 0, len(track.Clips))
		for _, clip := range track.Clips {
			asset, found := assets[clip.AssetID]
			if !found {
				return nil, fmt.Errorf("prepare project clip %q: unknown asset %q", clip.ID, clip.AssetID)
			}
			clips = append(clips, projectClip(clip, asset, track.Type))
		}
		channels = append(channels, map[string]any{"id": track.ID, "name": track.Name, "type": track.Type,
			"muted": track.Muted, "hidden": track.Hidden, "locked": track.Locked, "clips": clips})
	}
	return channels, nil
}

func projectEffects(blocks []document.EffectBlock) []map[string]any {
	effects := make([]map[string]any, 0, len(blocks))
	for _, effect := range blocks {
		block := map[string]any{"id": effect.ID, "channelId": effect.TrackID, "effectId": effect.Preset,
			"start": effect.Start, "duration": effect.Duration, "params": effect.Params, "ramp": effect.Ramp, "nodeId": nil}
		if effect.OwnerClipID != "" {
			block["ownerClipId"] = effect.OwnerClipID
		}
		if effect.Provenance != nil {
			block["provenance"] = effect.Provenance
			if strings.HasPrefix(effect.Provenance.Rule, "look:") {
				block["clipLookId"] = strings.TrimPrefix(effect.Provenance.Rule, "look:")
			}
		}
		effects = append(effects, block)
	}
	return effects
}

func projectTransitions(junctions []document.Transition) []map[string]any {
	transitions := make([]map[string]any, 0, len(junctions))
	for _, transition := range junctions {
		transitions = append(transitions, map[string]any{"id": transition.ID, "channelId": transition.TrackID,
			"leftClipId": transition.LeftClipID, "rightClipId": transition.RightClipID, "effectId": transition.Preset})
	}
	return transitions
}

func preparedEditorState(prepared PreparedComposition, previous editorState) (json.RawMessage, error) {
	compiled := prepared.Composition
	channels, err := projectChannels(compiled)
	if err != nil {
		return nil, err
	}
	fit := compiled.Output.Fit
	if fit == "" {
		fit = "contain"
	}
	bindings := prepared.Bindings
	if bindings == nil {
		bindings = document.Bindings{}
	}
	session := map[string]any{"kind": "ready", "document": prepared.Document, "bindings": bindings,
		"assets": compiled.Assets, "composition": compiled, "preparedText": compiled.PreparedText}
	if prepared.PreparedTextRef != nil {
		delete(session, "preparedText")
		session["preparedTextRef"] = prepared.PreparedTextRef
		session["composition"] = struct {
			*composition.Composition
			PreparedTextRef *textAssetReference `json:"preparedTextRef"`
		}{compiled, prepared.PreparedTextRef}
	}
	timeline, err := json.Marshal(map[string]any{
		"channels": channels, "effectBlocks": projectEffects(compiled.Effects), "transitions": projectTransitions(compiled.Transitions),
		"textItems": append([]document.TextItem{}, compiled.TextItems...),
		"fps":       compiled.Output.FPS, "resolution": compiled.Output.Resolution, "projectAspect": compiled.Output.Aspect, "videoFit": fit,
		"currentTime": 0, "selectedClipIds": []string{}, "selectedEffectBlockIds": []string{}, "selectedTextItemIds": []string{},
		"documentSession": session,
	})
	if err != nil {
		return nil, fmt.Errorf("encode prepared timeline: %w", err)
	}
	state := editorState{SchemaVersion: 1, PreparedCompositionID: compiled.ID, Timeline: timeline,
		Media: projectMedia(compiled.Assets, previous.Media)}
	data, err := json.Marshal(state)
	if err != nil {
		return nil, fmt.Errorf("encode prepared project: %w", err)
	}
	state.PreparedStateFingerprint, err = editorStateFingerprint(data, true)
	if err != nil {
		return nil, err
	}
	data, err = json.Marshal(state)
	if err != nil {
		return nil, fmt.Errorf("encode fingerprinted project: %w", err)
	}
	return data, nil
}

func projectMedia(assets []document.Asset, previous []map[string]any) []map[string]any {
	media := make([]map[string]any, 0, len(assets)+len(previous))
	byFile := make(map[string]map[string]any, len(previous))
	for _, source := range previous {
		name, _ := source["name"].(string)
		byFile[strings.ToLower(name)] = source
	}
	used := make(map[string]bool, len(assets))
	for _, asset := range assets {
		key := strings.ToLower(asset.File)
		if used[key] {
			continue
		}
		used[key] = true
		source := map[string]any{}
		for field, value := range byFile[key] {
			source[field] = value
		}
		source["id"], source["sourceId"], source["sourceRevision"] = asset.ID, asset.ID, asset.Version
		source["name"], source["kind"], source["duration"] = asset.File, asset.Kind, asset.Duration
		source["width"], source["height"], source["sourceMode"] = asset.Width, asset.Height, sourceMode(asset)
		source["scrubBlobUrl"], source["previewUrl"], source["thumbnailUrl"] = nil, nil, nil
		media = append(media, source)
	}
	for _, source := range previous {
		name, _ := source["name"].(string)
		if !used[strings.ToLower(name)] {
			media = append(media, source)
		}
	}
	return media
}

func canPrepareEditorState(data json.RawMessage) (editorState, bool) {
	if len(data) == 0 || bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return editorState{}, true
	}
	var state editorState
	if json.Unmarshal(data, &state) != nil || state.SchemaVersion != 1 || state.Media == nil {
		return state, false
	}
	var timeline struct {
		Channels []struct {
			Clips []json.RawMessage `json:"clips"`
		} `json:"channels"`
		TextItems       []json.RawMessage `json:"textItems"`
		Effects         []json.RawMessage `json:"effectBlocks"`
		Transitions     []json.RawMessage `json:"transitions"`
		DocumentSession *struct {
			Kind        string `json:"kind"`
			Composition struct {
				ID string `json:"id"`
			} `json:"composition"`
		} `json:"documentSession"`
	}
	if json.Unmarshal(state.Timeline, &timeline) != nil || timeline.Channels == nil {
		return state, false
	}
	if state.PreparedCompositionID != "" {
		fingerprint, err := editorStateFingerprint(data, strings.HasPrefix(state.PreparedStateFingerprint, "v2:"))
		return state, err == nil && fingerprint == state.PreparedStateFingerprint && timeline.DocumentSession != nil &&
			timeline.DocumentSession.Kind == "ready" && timeline.DocumentSession.Composition.ID == state.PreparedCompositionID
	}
	if timeline.DocumentSession != nil || len(timeline.TextItems)+len(timeline.Effects)+len(timeline.Transitions) > 0 {
		return state, false
	}
	for _, channel := range timeline.Channels {
		if len(channel.Clips) > 0 {
			return state, false
		}
	}
	return state, true
}
