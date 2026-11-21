package cli

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestCommandAndLegacyOptions(t *testing.T) {
	for _, args := range [][]string{{"render", "recipe.yaml", "--root", "media"}, {"-document", "recipe.yaml", "-root", "media", "-render"}} {
		option, err := parseOptions(args, io.Discard)
		if err != nil || !option.render || option.root != "media" || option.document != "recipe.yaml" {
			t.Fatalf("options: %+v, %v", option, err)
		}
	}
	for _, args := range [][]string{{}, {"--stdin", "--document", "recipe.yaml"}, {"render", ""}} {
		if _, err := parseOptions(args, io.Discard); err == nil {
			t.Fatalf("accepted ambiguous arguments %v", args)
		}
	}
}

func TestLegacyStdinCompilationDoesNotNeedMediaOrServices(t *testing.T) {
	var output bytes.Buffer
	err := Run([]string{"-stdin"}, bytes.NewBufferString("version: 1\nmode: assemble\ntexts:\n  - {id: title, text: Hello, start: 0, duration: 1}\n"), &output, io.Discard)
	if err != nil || !bytes.Contains(output.Bytes(), []byte(`"composition"`)) {
		t.Fatalf("compile: %s, %v", output.String(), err)
	}
}

func TestOutputNeverOverwritesExistingFile(t *testing.T) {
	root := t.TempDir()
	source, destination := filepath.Join(root, "source"), filepath.Join(root, "existing")
	if err := os.WriteFile(source, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(destination, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyOutput(source, destination); err == nil {
		t.Fatal("existing output was overwritten")
	}
	data, err := os.ReadFile(destination)
	if err != nil || string(data) != "keep" {
		t.Fatal("existing file changed")
	}
}
