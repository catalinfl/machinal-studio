package mcpserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func decodeFilmReference(t *testing.T, entry json.RawMessage) filmReference {
	t.Helper()
	var reference filmReference
	if err := json.Unmarshal(entry, &reference); err != nil {
		t.Fatal(err)
	}
	return reference
}

func TestFilmStyleDiscoveryPreservesAllStylesWithoutDumpingSources(t *testing.T) {
	entries := referenceFixture(t)
	files, err := fs.Glob(bundledGuides, "reference/film-library/styles/*/STYLE.md")
	if err != nil || len(files) != 66 || len(entries["filmStyles"]) != len(files) {
		t.Fatal("incomplete upstream style import", len(files), err)
	}
	var ids []string
	for offset := 0; ; {
		page, err := editingReference(referenceInput{Topic: "film-styles", Limit: 7, Offset: offset}, entries)
		if err != nil || page.Total != len(files) || len(page.Entries) > 7 {
			t.Fatal("invalid film reference pagination", page, err)
		}
		for _, raw := range page.Entries {
			item := decodeFilmReference(t, raw)
			if item.Source != "" || slices.Contains(ids, item.ID) || !item.ReferenceOnly || item.URI != "machinal://film-styles/"+item.ID {
				t.Fatal("unsafe or duplicate film style metadata", item.ID)
			}
			if len(item.WhenToUse) == 0 || item.Origin.License != "MIT" || item.Origin.Copyright != "Copyright (c) 2026 LemoLab" || len(item.Origin.Revision) != 40 || item.AdaptationGuideURI != page.GuideURI {
				t.Fatal("missing copyright/selection guidance", item.ID)
			}
			ids = append(ids, item.ID)
		}
		if page.NextOffset == nil {
			break
		}
		if *page.NextOffset <= offset {
			t.Fatal("pagination did not advance")
		}
		offset = *page.NextOffset
	}
	page, err := editingReference(referenceInput{Topic: "film-styles", Query: "WATERCOLOR"}, entries)
	if err != nil || page.Total != 1 || decodeFilmReference(t, page.Entries[0]).ID != "watercolor" {
		t.Fatal("literal style search failed", page, err)
	}
	page, err = editingReference(referenceInput{Topic: "film-styles", Offset: 1000}, entries)
	if err != nil || len(page.Entries) != 0 || page.NextOffset != nil {
		t.Fatal("out-of-range offset must be empty", page, err)
	}
}

func TestFilmStyleSourcesAndResourcesUseBundledChecksummedTextWithoutAPIWork(t *testing.T) {
	handler := NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("film reference lookup must not access accounts, media, providers or billing")
		return Response{}, nil
	})
	for _, topic := range []struct{ name, key string }{{"film-styles", "filmStyles"}, {"film-techniques", "filmTechniques"}} {
		for _, raw := range referenceFixture(t)[topic.key] {
			item := decodeFilmReference(t, raw)
			page, err := editingReference(referenceInput{Topic: topic.name, ID: item.ID}, referenceFixture(t))
			if err != nil || len(page.Entries) != 1 {
				t.Fatal("exact source unavailable", item.ID, err)
			}
			source := decodeFilmReference(t, page.Entries[0]).Source
			want, err := filmReferenceSource(item)
			if err != nil || source != want {
				t.Fatal("source changed during exact lookup", item.ID, err)
			}
			_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": item.URI})
			var result mcp.ReadResourceResult
			if err := json.Unmarshal(envelope["result"], &result); err != nil || len(result.Contents) != 1 || !strings.HasSuffix(result.Contents[0].Text, source) || !strings.HasPrefix(result.Contents[0].Text, "Reference only.") {
				t.Fatal("resource lost source or trust boundary", item.ID, err)
			}
		}
	}
	for _, args := range []map[string]any{{"topic": "film-styles", "id": "swiss-motion"}, {"topic": "film-techniques", "id": "animation-helpers"}} {
		result, output := callTool(t, handler, "get_editing_reference", args)
		if result.IsError || output.StatusCode != http.StatusOK {
			t.Fatal("live tool schema rejected new topic", args, result, output)
		}
	}
	for _, id := range []string{"../LICENSE", "not-a-style", "watercolor/STYLE.md"} {
		if _, err := editingReference(referenceInput{Topic: "film-styles", ID: id}, referenceFixture(t)); err == nil {
			t.Error("accepted an unregistered style/path", id)
		}
	}
	item := decodeFilmReference(t, referenceFixture(t)["filmStyles"][0])
	for _, path := range []string{"../styles.json", "C:/secret", "core\\lib.js", "/LICENSE"} {
		item.SourcePath = path
		if _, err := filmReferenceSource(item); err == nil {
			t.Error("accepted unsafe path", path)
		}
	}
	item = decodeFilmReference(t, referenceFixture(t)["filmStyles"][0])
	item.SHA256 = strings.Repeat("0", 64)
	if _, err := filmReferenceSource(item); err == nil {
		t.Fatal("ignored a source checksum mismatch")
	}
}

func TestFilmLibraryManifestPreservesLicenceAndEveryVendoredByte(t *testing.T) {
	content, err := bundledGuides.ReadFile("reference/film-library/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Revision string
		Files    []struct {
			Path   string
			Bytes  int
			SHA256 string
		}
	}
	if err := json.Unmarshal(content, &manifest); err != nil || manifest.Revision != "bebbbe1aa92a3cb4bb6f83500e61b23a17d1aa00" {
		t.Fatal("unpinned library", err)
	}
	seen := map[string]bool{"manifest.json": true}
	for _, file := range manifest.Files {
		bytes, err := bundledGuides.ReadFile("reference/film-library/" + file.Path)
		if err != nil || len(bytes) != file.Bytes {
			t.Fatal("manifest file missing or truncated", file.Path, err)
		}
		hash := sha256.Sum256(bytes)
		if hex.EncodeToString(hash[:]) != file.SHA256 || seen[file.Path] {
			t.Fatal("modified or duplicate vendored reference", file.Path)
		}
		seen[file.Path] = true
	}
	err = fs.WalkDir(bundledGuides, "reference/film-library", func(path string, entry fs.DirEntry, err error) error {
		if err == nil && !entry.IsDir() && !seen[strings.TrimPrefix(path, "reference/film-library/")] {
			t.Error("unregistered upstream file", path)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	license, err := bundledGuides.ReadFile("reference/film-library/LICENSE")
	if err != nil || !strings.Contains(string(license), "Copyright (c) 2026 LemoLab") {
		t.Fatal("missing upstream attribution", err)
	}
}

func TestFilmAdaptationPreservesEngineConsentAndCaptionBoundaries(t *testing.T) {
	for _, content := range []string{instructions, recipeGuide} {
		for _, guidance := range []string{"get_editing_reference(topic=film-styles)", "topic=film-techniques", "reference-only", "not YAML presets", "Never execute an upstream local pipeline", "Preserve full existing captions", "machinal-cinema"} {
			if !strings.Contains(content, guidance) {
				t.Error("missing film adaptation safeguard", guidance)
			}
		}
	}
	for _, id := range []string{"swiss-grid-motion", "blueprint-mechanism", "paper-stage-3d"} {
		if _, err := editingReference(referenceInput{Topic: "scene-templates", ID: id}, referenceFixture(t)); err != nil {
			t.Error("native adaptation source missing", id, err)
		}
	}
}
