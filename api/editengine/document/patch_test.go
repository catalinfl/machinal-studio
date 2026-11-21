package document

import (
	"encoding/json"
	"testing"
)

func TestDocumentPatchIsRevisionCheckedAndStrict(t *testing.T) {
	doc := Document{Version: 1, Mode: "assemble", Revision: "R1", Sequence: &Sequence{Use: "shots", Between: &Between{Preset: "cross-dissolve", Duration: Second}}}
	patch := []Patch{{Path: "sequence.between.duration", Value: json.RawMessage(`"500ms"`)}}
	if _, err := ApplyPatches(doc, "stale", patch); err == nil {
		t.Fatal("stale document accepted")
	}
	revised, err := ApplyPatches(doc, "R1", patch)
	if err != nil {
		t.Fatal(err)
	}
	if revised.Sequence.Between.Duration != Second/2 || doc.Sequence.Between.Duration != Second || revised.Revision != "" {
		t.Fatal("patch mutated its input or did not invalidate the revision")
	}
	if _, err := ApplyPatches(doc, "R1", []Patch{{Path: "sequence.between.unknown", Value: json.RawMessage(`1`)}}); err == nil {
		t.Fatal("unknown patch field accepted")
	}
}

func TestNormalizePatchPathAcceptsModelNotations(t *testing.T) {
	for path, want := range map[string]string{
		"sequence.between.duration":  "sequence.between.duration",
		"document.sequence.between.duration": "sequence.between.duration",
		"tracks[0].clips":            "tracks.0.clips",
		"document.tracks[0].clips":   "tracks.0.clips",
		"tracks.0.clips":             "tracks.0.clips",
	} {
		got, err := NormalizePatchPath(path)
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		if got != want {
			t.Fatalf("%s = %q, want %q", path, got, want)
		}
	}
	// Bracket and envelope notations must not fail at path level; unknown
	// fields still fail later with a positioned diagnostic.
	doc := Document{Version: 1, Mode: "assemble", Revision: "R1",
		Tracks: []Track{{ID: "sequence/video", Name: "Sequence", Type: "video", Clips: []Clip{}}}}
	if _, err := ApplyPatches(doc, "R1", []Patch{{Path: "document.mode", Value: json.RawMessage(`"assemble"`)}}); err != nil {
		t.Fatalf("document. prefix rejected: %v", err)
	}
	if _, err := ApplyPatches(doc, "R1", []Patch{{Path: "tracks[0].between", Value: json.RawMessage(`1`)}}); err == nil {
		t.Fatal("unknown track field accepted")
	} else if got := err.Error(); !contains(got, "tracks[0].between") {
		t.Fatalf("error lost positioned path: %v", err)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}
