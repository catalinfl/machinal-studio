package scenes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestHandoffUsesApprovedFrameStateAndPreservesIncomingSourceTimingAndMedia(t *testing.T) {
	root := t.TempDir()
	outgoingFile := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	incomingFile := "ai_scene_abcdef0123456789abcdef0123456789_01.scene.json"
	outgoing := LiveSource{Version: 1, Component: "<p>Outgoing</p>", JavaScript: "outgoing-bundle", Config: Config{Width: 320, Height: 180, FPS: 30, Frames: 60}}
	incoming := LiveSource{Version: 1, Component: "<p>Exact incoming șț</p>", JavaScript: "incoming-bundle", Config: outgoing.Config,
		Parameters: SceneParameters{"receiver": {X: floatParameter(0), Y: floatParameter(20), Delay: floatParameter(1), Duration: floatParameter(0.5)}},
		Images:     map[string]string{"image_1": "data:image/png;base64,AAAA"}, Audio: &Narration{File: "voice.wav", Start: 2, Duration: 2}}
	for name, source := range map[string]LiveSource{outgoingFile: outgoing, incomingFile: incoming} {
		if err := saveJSON(filepath.Join(root, name), source); err != nil {
			t.Fatal(err)
		}
	}
	_, outVersion, err := readSourceVersion(root, outgoingFile)
	if err != nil {
		t.Fatal(err)
	}
	_, inVersion, err := readSourceVersion(root, incomingFile)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(root, incomingFile))
	if err != nil {
		t.Fatal(err)
	}
	inspections := 0
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inspections++
		if r.URL.Path != "/inspect" || r.Header.Get("Authorization") != "Bearer private-inspector" {
			t.Error("wrong inspection operation/credential")
		}
		var input struct {
			Component string `json:"component"`
			Frames    []int  `json:"frames"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if input.Component != outgoing.Component || !reflect.DeepEqual(input.Frames, []int{59}) {
			t.Error("wrong outgoing frame", input)
		}
		w.Write([]byte(`{"frames":[{"frame":59,"states":{"signal":{"x":240,"y":80,"opacity":1,"delay":59,"duration":0}}}]}`))
	}))
	defer service.Close()
	t.Setenv("SCENE_SERVICE_URL", service.URL)
	t.Setenv("SCENE_SERVICE_TOKEN", "private-inspector")
	handoff := SceneHandoff{SourceFile: outgoingFile, SourceVersion: outVersion, Frame: 59, Objects: map[string]string{"receiver": "signal"}}
	input := CompileRequest{SourceFile: incomingFile, SourceVersion: inVersion, Handoff: &handoff}
	if err := input.validate(); err != nil {
		t.Fatal(err)
	}
	runner := NewRunner()
	runner.compile = func(_ context.Context, component string, config Config, media compilationMedia) (string, error) {
		object := media.Parameters["receiver"]
		if component != incoming.Component || config != incoming.Config || *object.X != 240 || *object.Y != 80 || *object.Delay != 1 || *object.Duration != 0.5 || !reflect.DeepEqual(media.Images, incoming.Images) {
			t.Fatal("handoff modified source/timing/media", component, config, media)
		}
		return "new-incoming-bundle", nil
	}
	result, err := runner.compileSource(context.Background(), "", root, input)
	if err != nil {
		t.Fatal(err)
	}
	if inspections != 1 || result.Asset.File == incomingFile || !reflect.DeepEqual(result.Source.Audio, incoming.Audio) || result.Source.Handoff == nil {
		t.Fatal("handoff lost immutable provenance or audio", result, inspections)
	}
	after, err := os.ReadFile(filepath.Join(root, incomingFile))
	if err != nil || string(after) != string(before) {
		t.Fatal("incoming original overwritten", err)
	}
	handoff.SourceVersion = "sha256:" + strings.Repeat("a", 64)
	_, err = runner.compileSource(context.Background(), "", root, input)
	var status *fiber.Error
	if !errors.As(err, &status) || status.Code != 409 || inspections != 1 {
		t.Fatal("stale outgoing source inspected", err, inspections)
	}
}

func TestHandoffRejectsMissingOrInvalidSemanticState(t *testing.T) {
	if _, err := mappedHandoffStates(SceneParameters{}, map[string]string{"receiver": "missing"}); err == nil {
		t.Fatal("unregistered state inferred")
	}
	if _, err := mappedHandoffStates(SceneParameters{"source": {Delay: floatParameter(1)}}, map[string]string{"receiver": "source"}); err == nil {
		t.Fatal("timing-only state transferred as a pose")
	}
	if err := (SceneHandoff{SourceFile: "../../private.scene.json"}).Validate(); err == nil {
		t.Fatal("unsafe source path accepted")
	}
}

func TestHandoffRejectsStaleTargetsMissingObjectsAndCoordinateMismatchBeforeInspection(t *testing.T) {
	root := t.TempDir()
	file := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	source := LiveSource{Version: 1, Component: "<p>Signal</p>", JavaScript: "bundle", VisualMode: "2d", Config: Config{Width: 320, Height: 180, FPS: 30, Frames: 60}, Parameters: SceneParameters{"receiver": {X: floatParameter(0)}}}
	if err := saveJSON(filepath.Join(root, file), source); err != nil {
		t.Fatal(err)
	}
	_, version, err := readSourceVersion(root, file)
	if err != nil {
		t.Fatal(err)
	}
	handoff := SceneHandoff{SourceFile: file, SourceVersion: version, Frame: 59, Objects: map[string]string{"receiver": "signal"}}
	service := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("invalid handoff reached inspector") }))
	defer service.Close()
	t.Setenv("SCENE_SERVICE_URL", service.URL)
	stale := CompileRequest{SourceFile: file, SourceVersion: "sha256:" + strings.Repeat("b", 64), Handoff: &handoff}
	_, err = parameterEditSource(context.Background(), "", root, stale)
	var status *fiber.Error
	if !errors.As(err, &status) || status.Code != 409 {
		t.Fatal("stale incoming scene accepted", err)
	}
	for _, test := range []struct {
		name    string
		target  LiveSource
		handoff SceneHandoff
	}{
		{"unexposed object", LiveSource{Config: source.Config}, handoff},
		{"different width", LiveSource{Config: Config{Width: 640, Height: 180}, Parameters: source.Parameters, VisualMode: "2d"}, handoff},
		{"different mode", LiveSource{Config: source.Config, Parameters: source.Parameters, VisualMode: "3d"}, handoff},
		{"outside source", source, SceneHandoff{SourceFile: file, SourceVersion: version, Frame: 60, Objects: handoff.Objects}},
		{"not in this project", source, SceneHandoff{SourceFile: "ai_scene_abcdef0123456789abcdef0123456789_01.scene.json", SourceVersion: version, Frame: 0, Objects: handoff.Objects}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := stateHandoffPatch(context.Background(), "", root, test.target, test.handoff); err == nil {
				t.Fatal("invalid source accepted")
			}
		})
	}
}

func TestHandoffDoesNotInferStateFromAbsentOrMalformedInspectorEvidence(t *testing.T) {
	root := t.TempDir()
	file := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	source := LiveSource{Version: 1, Component: "<p>Signal</p>", JavaScript: "bundle", Config: Config{Width: 320, Height: 180, FPS: 30, Frames: 60}, Parameters: SceneParameters{"receiver": {X: floatParameter(0)}}}
	if err := saveJSON(filepath.Join(root, file), source); err != nil {
		t.Fatal(err)
	}
	_, version, err := readSourceVersion(root, file)
	if err != nil {
		t.Fatal(err)
	}
	handoff := SceneHandoff{SourceFile: file, SourceVersion: version, Frame: 59, Objects: map[string]string{"receiver": "signal"}}
	for _, evidence := range []string{
		`{"frames":[{"frame":59,"states":{}}]}`,
		`{"frames":[{"frame":58,"states":{"signal":{"x":10}}}]}`,
		`{"frames":[{"frame":59,"states":{"signal":{"x":999999999}}}]}`,
		`{"frames":[{"frame":59,"states":{"signal":{"delay":2}}}]}`,
	} {
		service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(evidence)) }))
		t.Setenv("SCENE_SERVICE_URL", service.URL)
		_, err := stateHandoffPatch(context.Background(), "", root, source, handoff)
		service.Close()
		if err == nil {
			t.Fatal("invalid semantic state accepted", evidence)
		}
	}
}
