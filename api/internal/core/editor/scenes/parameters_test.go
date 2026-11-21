package scenes

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func floatParameter(value float64) *float64 { return &value }

func TestParameterEditPreservesExactComponentConfigMediaAndOriginalBytes(t *testing.T) {
	root := t.TempDir()
	file := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	base := LiveSource{Version: 1, Title: "Signal receiver", Component: "<p>Exact source: șț</p>", JavaScript: "old-bundle", Explanation: "Original explanation", Text: "Exact copy",
		Config: Config{Width: 320, Height: 180, FPS: 30, Frames: 90, Transparent: true, CaptionSafeBottom: 0.24},
		Images: map[string]string{"image_1": "data:image/png;base64,AAAA"}, Audio: &Narration{File: "voice.wav", Start: 7, Duration: 3},
		Parameters: SceneParameters{"receiver": {X: floatParameter(100), Y: floatParameter(80), Opacity: floatParameter(1)}},
	}
	if err := saveJSON(filepath.Join(root, file), base); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(root, file))
	if err != nil {
		t.Fatal(err)
	}
	_, version, err := readSourceVersion(root, file)
	if err != nil {
		t.Fatal(err)
	}
	runner := NewRunner()
	calls := 0
	runner.compile = func(_ context.Context, component string, config Config, media compilationMedia) (string, error) {
		calls++
		if component != base.Component || config != base.Config || *media.Parameters["receiver"].X != 220 || *media.Parameters["receiver"].Y != 80 || !reflect.DeepEqual(media.Images, base.Images) {
			t.Fatal("parameter edit lost source/layout/attachments", component, config, media)
		}
		return "new-bundle", nil
	}
	input := CompileRequest{SourceFile: file, SourceVersion: version, ParameterPatch: SceneParameters{"receiver": {X: floatParameter(220)}}}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeCompileRequest(encoded); err != nil {
		t.Fatal(err)
	}
	edited, err := runner.compileSource(context.Background(), "", root, input)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || edited.Asset.File == file || edited.Source.Component != base.Component || edited.Source.Text != base.Text || edited.Source.Explanation != base.Explanation || !reflect.DeepEqual(edited.Source.Audio, base.Audio) {
		t.Fatal("edit replaced content or narration", edited)
	}
	if edited.Source.Title != base.Title || edited.Title != base.Title {
		t.Fatal("parameter edit lost the scene title", edited)
	}
	after, err := os.ReadFile(filepath.Join(root, file))
	if err != nil || string(after) != string(before) {
		t.Fatal("original scene was overwritten", err)
	}
	input.SourceVersion = "sha256:" + strings.Repeat("a", 64)
	_, err = runner.compileSource(context.Background(), "", root, input)
	var status *fiber.Error
	if !errors.As(err, &status) || status.Code != 409 || calls != 1 {
		t.Fatal("stale version was compiled", err, calls)
	}
}

func TestParameterPatchRejectsUnexposedObjectsUnknownFieldsNullsAndUnsafeValues(t *testing.T) {
	if _, err := applyParameterPatch(SceneParameters{"known": {}}, SceneParameters{"unknown": {X: floatParameter(1)}}); err == nil {
		t.Fatal("unexposed object accepted")
	}
	for _, raw := range []string{`{"x":null}`, `null`, `{"script":"alert(1)"}`, `{"color":"url(http://example.com)"}`, `{"opacity":2}`, `{"duration":61}`, `{"x":1e100}`} {
		var object ObjectParameters
		err := json.Unmarshal([]byte(raw), &object)
		if err == nil {
			err = object.validate()
		}
		if err == nil {
			t.Fatal("unsafe object accepted", raw)
		}
	}
	input := CompileRequest{SourceFile: "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json", SourceVersion: "sha256:" + strings.Repeat("a", 64), Component: "replacement", ParameterPatch: SceneParameters{"known": {X: floatParameter(1)}}}
	if input.validate() == nil {
		t.Fatal("parameter edit silently accepted replacement Svelte")
	}
}
