package text

import (
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestPreparedTextRejectsMissingOrStaleImages(t *testing.T) {
	items := []document.TextItem{{ID: "title", Text: "Hello", Start: 0, Duration: document.Seconds(2), TextStyle: document.DefaultTextStyle(), Words: []document.Word{}}}
	output := document.Output{Aspect: "landscape", Resolution: "720p", Format: "mp4"}
	key, err := SourceKey(items, output)
	if err != nil {
		t.Fatal(err)
	}
	prepared := &Prepared{Key: key, Overlays: []Overlay{{Image: "saved-image"}}}
	if _, err := prepared.Resolve(items, output); err != nil {
		t.Fatal(err)
	}
	var missing *Prepared
	if _, err := missing.Resolve(items, output); err == nil {
		t.Fatal("text without prepared images was accepted")
	}
	for _, change := range []struct {
		name string
		edit func(*document.TextItem, *document.Output)
	}{
		{"text", func(item *document.TextItem, _ *document.Output) { item.Text = "Changed" }},
		{"font", func(item *document.TextItem, _ *document.Output) { item.FontFamily = "montserrat" }},
		{"position", func(item *document.TextItem, _ *document.Output) { item.X++ }},
		{"timing", func(item *document.TextItem, _ *document.Output) { item.Start++ }},
		{"words", func(item *document.TextItem, _ *document.Output) {
			item.Words = []document.Word{{Text: "Hello", End: document.Seconds(1)}}
		}},
		{"resolution", func(_ *document.TextItem, output *document.Output) { output.Resolution = "1080p" }},
		{"aspect", func(_ *document.TextItem, output *document.Output) { output.Aspect = "portrait" }},
	} {
		t.Run(change.name, func(t *testing.T) {
			item, changedOutput := items[0], output
			change.edit(&item, &changedOutput)
			if _, err := prepared.Resolve([]document.TextItem{item}, changedOutput); err == nil {
				t.Fatal("stale text images were accepted")
			}
		})
	}
	output.Format, output.Quality, output.FPS = "avi", "high", 60
	if _, err := prepared.Resolve(items, output); err != nil {
		t.Fatalf("encoding-only settings invalidated text: %v", err)
	}
	output.Format = "mp3"
	if overlays, err := missing.Resolve(items, output); err != nil || len(overlays) != 0 {
		t.Fatalf("audio-only export required images: %v", err)
	}
}
