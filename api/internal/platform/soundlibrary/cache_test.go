package soundlibrary

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAggressiveCacheTTLAndSearchSeedsLookupCache(t *testing.T) {
	if cacheLifetime < time.Hour || maxCacheEntries < 1024 {
		t.Fatalf("cache limits too small: ttl=%v max=%d", cacheLifetime, maxCacheEntries)
	}
	httpCalls := 0
	client := New(doerFunc(func(req *http.Request) (*http.Response, error) {
		httpCalls++
		return jsonResponse(t, map[string]any{"results": []openverseSound{sampleSound()}, "page_count": 1}), nil
	}))
	res, err := client.Search(context.Background(), Search{Query: "mouse click"})
	if err != nil || len(res.Sounds) != 1 || httpCalls != 1 {
		t.Fatalf("initial search failed: %+v %v calls=%d", res, err, httpCalls)
	}
	// Follow-up Lookup during import_sound_effect should hit the lookup cache seeded by Search!
	sound, err := client.Lookup(context.Background(), res.Sounds[0].ID)
	if err != nil || sound.SourceVersion != res.Sounds[0].SourceVersion || httpCalls != 1 {
		t.Fatalf("Lookup did not use search-seeded cache: %+v %v calls=%d", sound, err, httpCalls)
	}
	// Still cached after 2 hours (< 4h TTL).
	client.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	if _, err := client.Search(context.Background(), Search{Query: "mouse click"}); err != nil || httpCalls != 1 {
		t.Fatalf("cache expired prematurely after 2h: err=%v calls=%d", err, httpCalls)
	}
}

func TestDiskCachePersistsSearchLookupAndAudioAcrossRestarts(t *testing.T) {
	cacheDir := t.TempDir()
	payload := "ID3cached-freesound-preview!"
	httpCalls := 0
	transport := doerFunc(func(req *http.Request) (*http.Response, error) {
		httpCalls++
		if req.URL.Host == "cdn.freesound.org" {
			return &http.Response{StatusCode: 200, ContentLength: int64(len(payload)), Body: io.NopCloser(strings.NewReader(payload))}, nil
		}
		return jsonResponse(t, map[string]any{"results": []openverseSound{sampleSound()}, "page_count": 1}), nil
	})

	first := New(transport, WithCacheDir(cacheDir))
	res, err := first.Search(context.Background(), Search{Query: "cinematic whoosh"})
	if err != nil || len(res.Sounds) != 1 {
		t.Fatalf("first search: %v", err)
	}
	body, err := first.Download(context.Background(), res.Sounds[0])
	if err != nil || string(body) != payload {
		t.Fatalf("first download: %q %v", body, err)
	}
	if httpCalls != 2 {
		t.Fatalf("expected 2 live HTTP calls (search+download), got %d", httpCalls)
	}

	// Fresh Client instance (simulating server restart) with failing network must serve Search, Lookup and Download from volume cache!
	second := New(doerFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("network called despite warm volume cache")
		return nil, nil
	}), WithCacheDir(cacheDir))

	res2, err := second.Search(context.Background(), Search{Query: "cinematic whoosh"})
	if err != nil || !res2.Cached || len(res2.Sounds) != 1 {
		t.Fatalf("disk search cache miss: %+v %v", res2, err)
	}
	lookedUp, err := second.Lookup(context.Background(), res.Sounds[0].ID)
	if err != nil || lookedUp.SourceVersion != res.Sounds[0].SourceVersion {
		t.Fatalf("disk lookup cache miss: %+v %v", lookedUp, err)
	}
	body2, err := second.Download(context.Background(), lookedUp)
	if err != nil || string(body2) != payload {
		t.Fatalf("disk audio cache miss: %q %v", body2, err)
	}
}

func TestCuratedCC0IndexServesCommonSFXWithoutOpenverseAndRejectsNonCC0(t *testing.T) {
	cacheDir := t.TempDir()
	whoosh := sampleSound()
	whoosh.Title = "Fast Transition Whoosh"
	nonCC0 := sampleSound()
	nonCC0.ID = "4849018d-0ac8-4f6b-b44d-5ec26a4b32af"
	nonCC0.License = "by"
	nonCC0.LicenseVersion = "4.0"
	nonCC0.LicenseURL = "https://creativecommons.org/licenses/by/4.0/"

	raw, err := json.Marshal([]CuratedEntry{
		{Tags: []string{"whoosh", "swoosh", "transition"}, Sound: whoosh},
		{Tags: []string{"riser"}, Sound: nonCC0},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "curated.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	client := New(doerFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("curated CC0 search must not call Openverse")
		return nil, nil
	}), WithCacheDir(cacheDir))

	result, err := client.Search(context.Background(), Search{Query: "transition whoosh"})
	if err != nil || !result.Cached || len(result.Sounds) != 1 || result.Sounds[0].ID != whoosh.ID {
		t.Fatalf("curated search failed: %+v %v", result, err)
	}
	// Lookup is immediately warm for curated sounds too.
	lookedUp, err := client.Lookup(context.Background(), whoosh.ID)
	if err != nil || lookedUp.SourceVersion != result.Sounds[0].SourceVersion {
		t.Fatalf("curated lookup failed: %+v %v", lookedUp, err)
	}
	// Non-CC0 entry was skipped by RegisterCurated.
	if err := client.RegisterCurated([]string{"riser"}, nonCC0); err == nil {
		t.Fatal("non-CC0 curated entry was accepted")
	}
}
