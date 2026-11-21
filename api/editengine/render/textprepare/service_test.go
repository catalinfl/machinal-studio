package textprepare

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/text"
)

func TestPreparationUsesInternalTokenAndRejectsStaleImages(t *testing.T) {
	result := compiler.New().Compile(compiler.Input{Document: document.Document{Version: 1, Mode: "assemble", Texts: []document.TextItem{{ID: "title", Text: "Hello", Duration: document.Second, TextStyle: document.DefaultTextStyle()}}}})
	if result.Composition == nil {
		t.Fatal(result.Diagnostics)
	}
	stale := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/text" || r.Header.Get("Authorization") != "Bearer internal" {
			t.Error("wrong internal authentication")
		}
		key := result.Composition.TextRenderKey
		if stale {
			key = "stale"
		}
		json.NewEncoder(w).Encode(text.Prepared{Key: key, Overlays: []text.Overlay{{Start: 0, Duration: document.Second, Image: "test-png"}}})
	}))
	defer server.Close()
	t.Setenv("SCENE_SERVICE_URL", server.URL)
	t.Setenv("SCENE_SERVICE_TOKEN", "internal")
	if err := Prepare(context.Background(), result.Composition); err != nil {
		t.Fatal(err)
	}
	result.Composition.PreparedText = nil
	stale = true
	if err := Prepare(context.Background(), result.Composition); err == nil {
		t.Fatal("stale text images were accepted")
	}
}
