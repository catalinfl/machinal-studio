package compositions

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"github.com/gofiber/fiber/v2"
)

func TestHTTPCompileAndRecompileMaterializedDocument(t *testing.T) {
	app := fiber.New()
	app.Post("/compositions/compile", Compile)
	request := []byte(`{"document":"version: 1\nmode: assemble\ninputs:\n  shots: {kind: image, multiple: true}\nsequence:\n  use: shots\n  each:\n    take: {from: 0s, duration: 5s}\n  between: {preset: cross-dissolve, duration: 1s}\ntexts:\n  - {id: title, text: Hello, start: 0s, duration: 2s, preset: title}\n", "bindings":{"shots":["a","b","c"]}, "assets":[{"id":"a","file":"a.png","kind":"image","version":"v1"},{"id":"b","file":"b.png","kind":"image","version":"v1"},{"id":"c","file":"c.png","kind":"image","version":"v1"}]}`)
	first := httpCompile(t, app, request)
	if first.Composition.Duration.Seconds() != 13 {
		t.Fatal("HTTP compiler produced wrong duration")
	}
	var input Request
	if err := json.Unmarshal(request, &input); err != nil {
		t.Fatal(err)
	}
	var err error
	input.Document, err = json.Marshal(first.Document)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	second := httpCompile(t, app, encoded)
	if first.Composition.ID != second.Composition.ID {
		t.Fatal("saved document did not recompile identically")
	}
}

func TestHTTPCompileEmptyTimelineOnlyAsEditorDraft(t *testing.T) {
	app := fiber.New()
	app.Post("/compositions/compile", Compile)
	body := []byte(`{"document":{"version":1,"mode":"assemble","tracks":[{"id":"v1","type":"video","clips":[]}]},"bindings":{},"assets":[]}`)
	for _, test := range []struct {
		route  string
		status int
	}{
		{route: "/compositions/compile?draft=true", status: fiber.StatusOK},
		{route: "/compositions/compile", status: fiber.StatusUnprocessableEntity},
	} {
		t.Run(test.route, func(t *testing.T) {
			request := httptest.NewRequest("POST", test.route, bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			var result composition.Result
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != test.status {
				t.Fatalf("status = %d, want %d: %+v", response.StatusCode, test.status, result)
			}
			if test.status == fiber.StatusOK && (result.Composition == nil || result.Composition.Duration != 0 || len(result.Diagnostics) != 0) {
				t.Fatalf("empty editor draft failed to compile: %+v", result)
			}
		})
	}
}

func TestSavedYAMLIncludesPreparedTextAndCompilesWithoutBrowser(t *testing.T) {
	source := []byte(`document:
  version: 1
  mode: assemble
  texts:
    - {id: title, text: "Salut: lume!", start: 1s, duration: 2s, color: "#ff0000"}
bindings: {}
assets: []
preparedText:
  key: saved-key
  overlays:
    - {start: 1, duration: 2, x: 100, y: 200, image: saved-png}
`)
	input, _, err := ParseProject(source)
	if err != nil {
		t.Fatal(err)
	}
	result := compiler.New().Compile(input)
	if result.Composition == nil {
		t.Fatalf("compile: %+v", result)
	}
	if result.Composition.TextItems[0].Text != "Salut: lume!" || result.Composition.TextItems[0].Color != "#ff0000" {
		t.Fatal("editable text or style was lost")
	}
	if result.Composition.PreparedText.Overlays[0].Image != "saved-png" {
		t.Fatal("saved text image was lost")
	}
	if _, _, err := ParseProject(bytes.Replace(source, []byte("key: saved-key"), []byte("key: saved-key\n  key: duplicate"), 1)); err == nil {
		t.Fatal("duplicate project fields were accepted")
	}
	if _, _, err := ParseProject(bytes.Replace(source, []byte("bindings: {}"), []byte("unknown: {}"), 1)); err == nil {
		t.Fatal("unknown project fields were accepted")
	}
}

func TestParseProjectAcceptsPreparedTextLargerThanEightMiB(t *testing.T) {
	image := strings.Repeat("A", 8<<20)
	source := []byte("document:\n  version: 1\n  mode: assemble\nbindings: {}\nassets: []\npreparedText:\n  key: saved-key\n  overlays:\n    - image: " + image + "\n")
	if len(source) <= 8<<20 || len(source) > document.MaxProjectBytes {
		t.Fatalf("unexpected project size: %d", len(source))
	}
	input, _, err := ParseProject(source)
	if err != nil {
		t.Fatal(err)
	}
	if input.PreparedText == nil || len(input.PreparedText.Overlays) != 1 || len(input.PreparedText.Overlays[0].Image) != len(image) {
		t.Fatal("prepared text was not preserved")
	}
}

func httpCompile(t *testing.T, app *fiber.App, body []byte) composition.Result {
	t.Helper()
	request := httptest.NewRequest("POST", "/compositions/compile", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("compile returned %d: %s", response.StatusCode, data)
	}
	var result composition.Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result.Composition == nil {
		t.Fatalf("compile requirements: %s", data)
	}
	return result
}
