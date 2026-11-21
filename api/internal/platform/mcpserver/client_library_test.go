package mcpserver

import (
	"io/fs"
	"os"
	"strings"
	"testing"
)

func TestAuthoringLibraryIsNotEmbeddedInTheAPIServer(t *testing.T) {
	err := fs.WalkDir(os.DirFS("."), ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() && path == "testdata" {
			return fs.SkipDir
		}
		if strings.HasSuffix(path, ".svelte") || strings.Contains(path, "hyperframes-library/") ||
			strings.Contains(path, "film-library/") || strings.Contains(path, "animation-skills/") ||
			strings.HasSuffix(path, ".yaml") || strings.HasSuffix(path, ".json") || strings.HasSuffix(path, ".md") {
			t.Errorf("client authoring source embedded in API: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	entries := referenceFixture(t)
	for _, category := range []string{"sceneTemplates", "hyperframesComponents", "hyperframesSkills", "hyperframesFiles", "animationSkills", "filmStyles", "filmTechniques", "styles", "examples"} {
		if len(entries[category]) != 0 {
			t.Errorf("client catalog loaded by API: %s", category)
		}
	}
}
