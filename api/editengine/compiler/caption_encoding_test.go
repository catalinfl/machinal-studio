package compiler

import (
	"errors"
	"reflect"
	"slices"
	"testing"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/text"
)

func TestMaterializeCaptionsRepairsEncodingWithoutChangingWordTimes(t *testing.T) {
	doc := document.Document{After: []document.Job{{ID: "caps", Type: "captions.generate"}}}
	words := []document.Word{
		{Text: "È˜tiinÈ›Äƒ", Start: document.Second, End: 2 * document.Second},
		{Text: "È™i", Start: 2 * document.Second, End: 3 * document.Second},
	}
	original := slices.Clone(words)
	style := document.DefaultTextStyle()
	style.HighlightMode = "word"
	got, err := MaterializeCaptions(doc, "caps", words, 4, style)
	if err != nil {
		t.Fatal(err)
	}
	item := got.Texts[0]
	if item.Text != "Știință și" || item.Words[0].Text != "Știință" || item.Words[1].Text != "și" {
		t.Fatalf("caption text/words were not repaired together: %+v", item)
	}
	if item.Start != document.Second || item.Duration != 2*document.Second || item.Words[1].Start != document.Second || item.Words[1].End != 2*document.Second {
		t.Fatalf("measured timing changed: %+v", item)
	}
	if !reflect.DeepEqual(words, original) {
		t.Fatal("materialization mutated the source transcript")
	}
}

func TestMaterializeCaptionsRejectsLostCharacters(t *testing.T) {
	doc := document.Document{After: []document.Job{{ID: "caps", Type: "captions.generate"}}}
	for _, materialize := range []func() (document.Document, error){
		func() (document.Document, error) {
			return MaterializeCaptions(doc, "caps", []document.Word{{Text: "Rom�nia", End: document.Second}}, 4, document.DefaultTextStyle())
		},
		func() (document.Document, error) {
			return MaterializePhraseCaptions(doc, "caps", []document.Word{{Text: "Rom�nia și țara", End: document.Second}}, document.DefaultTextStyle())
		},
	} {
		if _, err := materialize(); !errors.Is(err, text.ErrInvalidEncoding) {
			t.Fatalf("lost characters passed caption materialization: %v", err)
		}
	}
}

func TestMaterializePhraseCaptionRepairsEncodingWithoutInventingWordTimes(t *testing.T) {
	doc := document.Document{After: []document.Job{{ID: "caps", Type: "captions.generate"}}}
	result, err := MaterializePhraseCaptions(doc, "caps", []document.Word{{
		Text: "RomÃ¢nia È™i È›ara", Start: document.Second, End: 3 * document.Second,
	}}, document.DefaultTextStyle())
	if err != nil {
		t.Fatal(err)
	}
	item := result.Texts[0]
	if item.Text != "România și țara" || item.Start != document.Second || item.Duration != 2*document.Second || len(item.Words) != 0 {
		t.Fatalf("phrase caption repair changed its measured boundary: %+v", item)
	}
}

func TestCompileRepairsExistingCaptionTextAndWords(t *testing.T) {
	input := reelInput(t)
	input.Document = document.Document{Version: 2, Mode: "modify"}
	input.Bindings = nil
	style := document.DefaultTextStyle()
	style.IsCaption, style.HighlightMode = true, "word"
	input.Snapshot = &composition.Snapshot{Revision: "r1", TextItems: []document.TextItem{{
		ID: "caps/0", Text: "È™i", Start: document.Second, Duration: document.Second,
		TextStyle: style, Words: []document.Word{{Text: "È™i", End: document.Second}},
	}}}
	result := New().Compile(input)
	if result.Composition == nil {
		t.Fatalf("compile failed: %+v", result.Diagnostics)
	}
	item := result.Composition.TextItems[0]
	if item.ID != "caps/0" || item.Text != "și" || item.Words[0].Text != "și" || item.Start != document.Second || item.Duration != document.Second {
		t.Fatalf("existing caption not repaired in place: %+v", item)
	}
	if input.Snapshot.TextItems[0].Text != "È™i" || input.Snapshot.TextItems[0].Words[0].Text != "È™i" {
		t.Fatal("compiler mutated the captured snapshot")
	}
}

func TestCompileRejectsIrrecoverableCaptionEncoding(t *testing.T) {
	for _, damagedWord := range []bool{false, true} {
		input := reelInput(t)
		style := document.DefaultTextStyle()
		style.IsCaption = true
		item := document.TextItem{ID: "caps/0", Text: "Rom�nia", Duration: document.Second, TextStyle: style}
		if damagedWord {
			item.Text = "România"
			item.Words = []document.Word{{Text: "Rom�nia", End: document.Second}}
		}
		input.Document.Texts = []document.TextItem{item}
		result := New().Compile(input)
		if result.Composition != nil || !slices.ContainsFunc(result.Diagnostics, func(d document.Diagnostic) bool {
			return d.Code == "invalid_text_encoding" && d.Severity == "error"
		}) {
			t.Fatalf("damaged caption reached a renderable composition: %+v", result)
		}
	}
}

func TestPreflightRejectsLostCaptionCharactersBeforePendingGeneration(t *testing.T) {
	for _, inSnapshot := range []bool{false, true} {
		input := Input{Document: document.Document{Version: 2, Mode: "assemble", Before: []document.Job{{
			ID: "cover", Type: "image.generate", Model: "test-model", Prompt: "Landscape",
		}}}}
		style := document.DefaultTextStyle()
		style.IsCaption = true
		item := document.TextItem{ID: "caps/0", Text: "Rom�nia", Duration: document.Second, TextStyle: style}
		if inSnapshot {
			input.Document.Mode = "modify"
			input.Snapshot = &composition.Snapshot{Revision: "r1", TextItems: []document.TextItem{item}}
		} else {
			input.Document.Texts = []document.TextItem{item}
		}
		result := New().Preflight(input)
		if !slices.ContainsFunc(result.Diagnostics, func(d document.Diagnostic) bool { return d.Code == "invalid_text_encoding" }) {
			t.Fatalf("pending generation hid damaged captions: %+v", result)
		}
	}
}
