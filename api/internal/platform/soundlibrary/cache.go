package soundlibrary

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// CuratedEntry describes a verified CC0 Freesound preview pre-indexed for
// instant common SFX lookups (whoosh, hit, riser, crowd, whistle, etc.).
type CuratedEntry struct {
	Tags  []string       `json:"tags"`
	Sound openverseSound `json:"sound"`
}

type curatedRecord struct {
	tags  []string
	sound Sound
}

type diskSearchEntry struct {
	Until  time.Time    `json:"until"`
	Result SearchResult `json:"result"`
}

type diskLookupEntry struct {
	Until time.Time `json:"until"`
	Sound Sound     `json:"sound"`
}

// WithCacheDir enables persistent on-volume caching of search metadata, lookup
// metadata and verified Freesound preview audio bytes, and loads an optional
// curated.json CC0 index inside dir when present.
func WithCacheDir(dir string) Option {
	return func(c *Client) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			return
		}
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return
		}
		c.cacheDir = dir
		_ = c.LoadCuratedFile(filepath.Join(dir, "curated.json"))
	}
}

// WithCuratedEntries registers validated CC0 Freesound entries for instant
// local tag-based search and lookup without hitting Openverse.
func WithCuratedEntries(entries []CuratedEntry) Option {
	return func(c *Client) {
		for _, entry := range entries {
			_ = c.RegisterCurated(entry.Tags, entry.Sound)
		}
	}
}

// RegisterCurated validates and registers one CC0 Freesound sound under normalized tags.
func (c *Client) RegisterCurated(tags []string, raw openverseSound) error {
	sound, err := raw.sound()
	if err != nil {
		return err
	}
	if sound.License != "cc0" || !sound.Importable {
		return errors.New("Curated sounds must be importable CC0 Freesound previews.")
	}
	normalized := normalizeTags(tags, sound.Title)
	if len(normalized) == 0 {
		return errors.New("Curated sound requires at least one searchable tag.")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := range c.curated {
		if c.curated[i].sound.ID == sound.ID {
			c.curated[i] = curatedRecord{tags: normalized, sound: sound}
			c.lookupCache[sound.ID] = lookupCacheEntry{sound: sound, until: c.now().Add(cacheLifetime)}
			return nil
		}
	}
	c.curated = append(c.curated, curatedRecord{tags: normalized, sound: sound})
	c.lookupCache[sound.ID] = lookupCacheEntry{sound: sound, until: c.now().Add(cacheLifetime)}
	return nil
}

// LoadCuratedFile loads a JSON array of CuratedEntry records, skipping any
// entries that fail CC0 Freesound provenance validation.
func (c *Client) LoadCuratedFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(data) > maxMetadataBytes {
		return errors.New("Curated sound index exceeds size limit.")
	}
	var entries []CuratedEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return err
	}
	for _, entry := range entries {
		_ = c.RegisterCurated(entry.Tags, entry.Sound)
	}
	return nil
}

func normalizeTags(tags []string, title string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(tags)+4)
	add := func(token string) {
		token = strings.ToLower(strings.Trim(token, " ,.;:!?-_()[]\"'"))
		if len(token) < 2 || seen[token] {
			return
		}
		seen[token] = true
		out = append(out, token)
	}
	for _, tag := range tags {
		for _, part := range strings.Fields(tag) {
			add(part)
		}
	}
	for _, part := range strings.Fields(title) {
		add(part)
	}
	return out
}

func (c *Client) searchCurated(input Search) (SearchResult, bool) {
	if input.License != "cc0" || input.Page != 1 {
		return SearchResult{}, false
	}
	tokens := normalizeTags([]string{input.Query}, "")
	if len(tokens) == 0 {
		return SearchResult{}, false
	}
	c.mu.Lock()
	records := append([]curatedRecord(nil), c.curated...)
	c.mu.Unlock()
	if len(records) == 0 {
		return SearchResult{}, false
	}
	matches := make([]Sound, 0, input.Limit)
	for _, record := range records {
		if matchesAllTokens(record.tags, tokens) {
			matches = append(matches, record.sound)
			if len(matches) == input.Limit {
				break
			}
		}
	}
	if len(matches) == 0 {
		return SearchResult{}, false
	}
	return SearchResult{
		MaxImportBytes: MaxAudioBytes,
		Sounds:         matches,
		Page:           1,
		PageCount:      1,
		Cached:         true,
	}, true
}

func matchesAllTokens(tags, tokens []string) bool {
	for _, token := range tokens {
		found := false
		for _, tag := range tags {
			if tag == token {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func (c *Client) storeSearchCache(key string, result SearchResult) {
	now := c.now()
	until := now.Add(cacheLifetime)
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.cache[key]; !exists && len(c.cache) >= maxCacheEntries {
		evictSearchCache(c.cache, now)
	}
	c.cache[key] = cacheEntry{result: result, until: until}
	for _, sound := range result.Sounds {
		if _, exists := c.lookupCache[sound.ID]; !exists && len(c.lookupCache) >= maxCacheEntries {
			evictLookupCache(c.lookupCache, now)
		}
		c.lookupCache[sound.ID] = lookupCacheEntry{sound: sound, until: until}
	}
}

func (c *Client) storeLookupCache(sound Sound) {
	now := c.now()
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.lookupCache[sound.ID]; !exists && len(c.lookupCache) >= maxCacheEntries {
		evictLookupCache(c.lookupCache, now)
	}
	c.lookupCache[sound.ID] = lookupCacheEntry{sound: sound, until: now.Add(cacheLifetime)}
}

func evictSearchCache(entries map[string]cacheEntry, now time.Time) {
	var oldestKey string
	var oldestUntil time.Time
	for k, e := range entries {
		if !now.Before(e.until) {
			delete(entries, k)
			continue
		}
		if oldestKey == "" || e.until.Before(oldestUntil) {
			oldestKey = k
			oldestUntil = e.until
		}
	}
	if len(entries) >= maxCacheEntries && oldestKey != "" {
		delete(entries, oldestKey)
	}
}

func evictLookupCache(entries map[string]lookupCacheEntry, now time.Time) {
	var oldestKey string
	var oldestUntil time.Time
	for k, e := range entries {
		if !now.Before(e.until) {
			delete(entries, k)
			continue
		}
		if oldestKey == "" || e.until.Before(oldestUntil) {
			oldestKey = k
			oldestUntil = e.until
		}
	}
	if len(entries) >= maxCacheEntries && oldestKey != "" {
		delete(entries, oldestKey)
	}
}

func hashHex(value string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(value)))
}

func (c *Client) searchDiskPath(key string) string {
	return filepath.Join(c.cacheDir, "search_"+hashHex(key)+".json")
}

func (c *Client) lookupDiskPath(id string) string {
	return filepath.Join(c.cacheDir, "lookup_"+id+".json")
}

func (c *Client) audioDiskPath(sound Sound) string {
	return filepath.Join(c.cacheDir, fmt.Sprintf("audio_%s_%s.%s", sound.ID, hashHex(sound.SourceVersion), sound.Filetype))
}

func (c *Client) readDiskSearch(key string) (SearchResult, bool) {
	if c.cacheDir == "" {
		return SearchResult{}, false
	}
	data, err := os.ReadFile(c.searchDiskPath(key))
	if err != nil || len(data) > maxMetadataBytes {
		return SearchResult{}, false
	}
	var entry diskSearchEntry
	if err := json.Unmarshal(data, &entry); err != nil || !c.now().Before(entry.Until) {
		return SearchResult{}, false
	}
	return entry.Result, true
}

func (c *Client) writeDiskSearch(key string, result SearchResult) {
	if c.cacheDir == "" {
		return
	}
	payload, err := json.Marshal(diskSearchEntry{Until: c.now().Add(cacheLifetime), Result: result})
	if err != nil || len(payload) > maxMetadataBytes {
		return
	}
	_ = writeAtomicFile(c.searchDiskPath(key), payload)
	for _, sound := range result.Sounds {
		c.writeDiskLookup(sound)
	}
}

func (c *Client) readDiskLookup(id string) (Sound, bool) {
	if c.cacheDir == "" || !ValidID(id) {
		return Sound{}, false
	}
	data, err := os.ReadFile(c.lookupDiskPath(id))
	if err != nil || len(data) > maxMetadataBytes {
		return Sound{}, false
	}
	var entry diskLookupEntry
	if err := json.Unmarshal(data, &entry); err != nil || !c.now().Before(entry.Until) || entry.Sound.ID != id {
		return Sound{}, false
	}
	return entry.Sound, true
}

func (c *Client) writeDiskLookup(sound Sound) {
	if c.cacheDir == "" || !ValidID(sound.ID) {
		return
	}
	payload, err := json.Marshal(diskLookupEntry{Until: c.now().Add(cacheLifetime), Sound: sound})
	if err != nil || len(payload) > maxMetadataBytes {
		return
	}
	_ = writeAtomicFile(c.lookupDiskPath(sound.ID), payload)
}

func (c *Client) readDiskAudio(sound Sound) ([]byte, bool) {
	if c.cacheDir == "" || !ValidID(sound.ID) || sound.SourceVersion == "" {
		return nil, false
	}
	body, err := os.ReadFile(c.audioDiskPath(sound))
	if err != nil || len(body) == 0 || int64(len(body)) > MaxAudioBytes || !audioSignature(body, sound.Filetype) {
		return nil, false
	}
	return body, true
}

func (c *Client) writeDiskAudio(sound Sound, body []byte) {
	if c.cacheDir == "" || !ValidID(sound.ID) || sound.SourceVersion == "" || len(body) == 0 || int64(len(body)) > MaxAudioBytes {
		return
	}
	_ = writeAtomicFile(c.audioDiskPath(sound), body)
}

func writeAtomicFile(destination string, payload []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(destination), ".soundcache-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(payload); err != nil {
		_ = tmp.Close()
		_ = os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Rename(name, destination); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}
