package compositions

import (
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/scenes"
)

func TestSceneNarrationUsesMeasuredVoiceDurationAndTheActualScript(t *testing.T) {
	doc := document.Document{Before: []document.Job{{ID: "voice", Type: "speech.generate", Text: "Copilăria la Ipotești.", Language: "ro", ResultAssetID: "voice.mp3"}}}
	assets := []document.Asset{{ID: "voice.mp3", Kind: "audio", Duration: document.Seconds(8.4)}}
	request, err := bindSceneNarration(scenes.Request{}, document.Job{ID: "childhood", NarrationJob: "voice"}, doc, assets)
	if err != nil || request.Duration != 8.4 || request.NarrationText != doc.Before[0].Text || request.Language != "ro" {
		t.Fatalf("scene lost its real narration: %+v, %v", request, err)
	}
}

func TestPartialNarrationRequiresMeasuredCuesInsteadOfInventedTimings(t *testing.T) {
	doc := document.Document{Before: []document.Job{{ID: "voice", Type: "speech.generate", ResultAssetID: "voice.mp3"}}, Placements: []document.Placement{{Job: "voice", Start: document.Seconds(0.8)}}}
	assets := []document.Asset{{ID: "voice.mp3", Kind: "audio", Duration: 30 * document.Second}}
	job := document.Job{ID: "poetry", NarrationJob: "voice", NarrationFrom: 10 * document.Second}
	if _, err := bindSceneNarration(scenes.Request{Duration: 5}, job, doc, assets); err == nil {
		t.Fatal("accepted an invented narration excerpt")
	}
	doc.Texts = []document.TextItem{{Text: "Luceafărul", Start: document.Seconds(11.3), Duration: document.Second, TextStyle: document.TextStyle{IsCaption: true}, Words: []document.Word{{Text: "Luceafărul", End: document.Second}}}}
	request, err := bindSceneNarration(scenes.Request{Duration: 5}, job, doc, assets)
	if err != nil || !strings.Contains(request.NarrationText, "Luceafărul") || len(request.NarrationCues) != 1 || request.NarrationCues[0].Start != 0.5 {
		t.Fatalf("scene-local cue mapping: %+v, %v", request, err)
	}
}

func TestSceneNarrationReusesMaterializedLegacyJobsAfterAnEarlierStage(t *testing.T) {
	doc := document.Document{Jobs: []document.Job{{ID: "voice", Type: "speech.generate", ResultAssetID: "voice.mp3", Text: "Poezia și natura.", Language: "ro"}}}
	assets := []document.Asset{{ID: "voice.mp3", Kind: "audio", Duration: 4 * document.Second}}
	request, err := bindSceneNarration(scenes.Request{}, document.Job{ID: "scene", NarrationJob: "voice"}, doc, assets)
	if err != nil || request.NarrationText != "Poezia și natura." || request.Duration != 4 {
		t.Fatal(request, err)
	}
}
