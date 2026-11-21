package compiler

import (
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestPhraseCaptionsDoNotInventMeasuredWordTimes(t *testing.T) {
	doc := document.Document{Version: 2, Mode: "assemble", After: []document.Job{{ID: "captions", Type: "captions.generate", Style: []byte(`{"highlightMode":"word"}`)}}}
	result, err := MaterializePhraseCaptions(doc, "captions", []document.Word{{Text: "Știință și creație", Start: document.Second, End: 3 * document.Second}}, document.DefaultTextStyle())
	if err != nil || len(result.Texts) != 1 {
		t.Fatal(result, err)
	}
	item := result.Texts[0]
	if item.HighlightMode != "none" || len(item.Words) != 0 || item.Start != document.Second || item.Duration != 2*document.Second {
		t.Fatal("phrase was presented as individually aligned words", item)
	}
}

func TestCaptionGroupsRespectSentencesAndBalanceFlashingSingletons(t *testing.T) {
	words := []document.Word{}
	for index, text := range []string{"distanța", "dintre", "cele", "două", "lumi.", "Urmează"} {
		words = append(words, document.Word{Text: text, Start: document.Seconds(float64(index) * 0.3), End: document.Seconds(float64(index+1) * 0.3)})
	}
	groups := captionWordGroups(words, 4)
	if len(groups) != 3 || len(groups[0]) != 3 || len(groups[1]) != 2 || groups[2][0].Text != "Urmează" {
		t.Fatalf("bad phrase grouping: %+v", groups)
	}
}
