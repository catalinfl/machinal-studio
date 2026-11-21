package scenes

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func embeddedModelFixture() []byte {
	metadata := `{"asset":{"version":"2.0"},"buffers":[{"byteLength":4}]}`
	metadata += strings.Repeat(" ", (4-len(metadata)%4)%4)
	data := make([]byte, 32+len(metadata))
	for offset, value := range map[int]uint32{0: 0x46546c67, 4: 2, 8: uint32(len(data)), 12: uint32(len(metadata)), 16: 0x4e4f534a, 20 + len(metadata): 4, 24 + len(metadata): 0x004e4942} {
		binary.LittleEndian.PutUint32(data[offset:offset+4], value)
	}
	copy(data[20:], metadata)
	return data
}

func TestCompileEmbedsApprovedGLBAndRetainsItOnParameterEdits(t *testing.T) {
	root := t.TempDir()
	bytes := embeddedModelFixture()
	if err := os.WriteFile(filepath.Join(root, "subject.glb"), bytes, 0600); err != nil {
		t.Fatal(err)
	}
	input := clientSceneRequest()
	input.Models = []SceneModel{{ID: "model_1", File: "subject.glb", Name: "Approved subject"}}
	input.Parameters = SceneParameters{"subject": {X: floatParameter(0)}}
	runner := NewRunner()
	runner.compile = func(_ context.Context, _ string, _ Config, media compilationMedia) (string, error) {
		if media.Models["model_1"] != modelDataPrefix+base64.StdEncoding.EncodeToString(bytes) {
			t.Fatal("embedded GLB bytes changed")
		}
		return "model-bundle", nil
	}
	scene, err := runner.compileSource(context.Background(), "", root, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "subject.glb"), []byte("replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	patch := CompileRequest{SourceFile: scene.Asset.File, SourceVersion: scene.Asset.Version, ParameterPatch: SceneParameters{"subject": {X: floatParameter(1)}}}
	if _, err := runner.compileSource(context.Background(), "", root, patch); err != nil {
		t.Fatal("saved scene did not own original model", err)
	}
	input.SourceFile, input.Models = scene.Asset.File, nil
	input.Component = "<p>Revised subject</p>"
	if _, err := runner.compileSource(context.Background(), "", root, input); err != nil {
		t.Fatal("sourceFile edit lost embedded model", err)
	}
}

func TestModelAttachmentRejectsPathsAndUntrustedSources(t *testing.T) {
	for _, file := range []string{"../subject.glb", "https://example.invalid/a.glb", "-flags.glb", "subject.gltf"} {
		if validateModelInputs([]SceneModel{{ID: "model_1", File: file, Name: "subject"}}) == nil {
			t.Fatal("unsafe model file accepted", file)
		}
	}
	if validateModelSources(map[string]string{"model_1": "https://example.invalid/a.glb"}) == nil {
		t.Fatal("external model source accepted")
	}
}
