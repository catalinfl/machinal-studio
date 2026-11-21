package soundlibrary

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	apiOrigin        = "https://api.openverse.org/v1/audio/"
	MaxAudioBytes    = 8 << 20
	maxMetadataBytes = 1 << 20
	cacheLifetime    = 4 * time.Hour
	maxCacheEntries  = 1024
	requestTimeout   = 20 * time.Second
	audioTimeout     = 55 * time.Second
)

var ErrPreviewTooLarge = fmt.Errorf("Preview exceeds the %d-byte import limit. Choose a smaller preview.", MaxAudioBytes)

var idPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

type Doer interface {
	Do(*http.Request) (*http.Response, error)
}

type Failure struct {
	Status     int
	RetryAfter string
}

func (e *Failure) Error() string {
	return "Sound library unavailable; retry later or choose an approved existing sound."
}

type Sound struct {
	ID             string  `json:"id"`
	Title          string  `json:"title"`
	Creator        string  `json:"creator"`
	LandingURL     string  `json:"landingUrl"`
	URL            string  `json:"previewUrl"`
	License        string  `json:"license"`
	LicenseVersion string  `json:"licenseVersion"`
	LicenseURL     string  `json:"licenseUrl"`
	Attribution    string  `json:"attribution"`
	Provider       string  `json:"provider"`
	Duration       float64 `json:"duration"`
	Filetype       string  `json:"filetype"`
	SourceVersion  string  `json:"sourceVersion"`
	Importable     bool    `json:"importable"`
	SizeBytes      *int64  `json:"sizeBytes"`
	SizeStatus     string  `json:"sizeStatus"`
}

type Search struct {
	Query   string `json:"query"`
	License string `json:"license,omitempty"`
	Page    int    `json:"page,omitempty"`
	Limit   int    `json:"limit,omitempty"`
}

type SearchResult struct {
	MaxImportBytes int     `json:"maxImportBytes"`
	Sounds         []Sound `json:"sounds"`
	Page           int     `json:"page"`
	PageCount      int     `json:"pageCount"`
	Cached         bool    `json:"cached"`
	Downloaded     bool    `json:"downloaded"`
	AudioVerified  bool    `json:"audioVerified"`
}

type cacheEntry struct {
	result SearchResult
	until  time.Time
}

type lookupCacheEntry struct {
	sound Sound
	until time.Time
}

type Option func(*Client)

type Client struct {
	http        Doer
	now         func() time.Time
	mu          sync.Mutex
	cache       map[string]cacheEntry
	lookupCache map[string]lookupCacheEntry
	cacheDir    string
	curated     []curatedRecord
	gate        chan struct{}
}

func New(client Doer, opts ...Option) *Client {
	c := &Client{
		http:        client,
		now:         time.Now,
		cache:       make(map[string]cacheEntry),
		lookupCache: make(map[string]lookupCacheEntry),
		gate:        make(chan struct{}, 4),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(c)
		}
	}
	return c
}

func ValidID(id string) bool { return idPattern.MatchString(id) }

func AllowedLicense(license string) bool { return license == "cc0" || license == "by" }

func (s Search) Normalize() (Search, error) {
	s.Query = strings.TrimSpace(s.Query)
	if s.License == "" {
		s.License = "cc0"
	}
	if s.Page == 0 {
		s.Page = 1
	}
	if s.Limit == 0 {
		s.Limit = 8
	}
	if s.Query == "" || len(s.Query) > 160 || strings.ContainsAny(s.Query, "\r\n\x00") || !AllowedLicense(s.License) || s.Page < 1 || s.Page > 20 || s.Limit < 1 || s.Limit > 20 {
		return Search{}, errors.New("Use a public query of 1-160 bytes, licence cc0 or by, page 1-20 and limit 1-20.")
	}
	return s, nil
}

func (c *Client) Search(ctx context.Context, input Search) (SearchResult, error) {
	input, err := input.Normalize()
	if err != nil {
		return SearchResult{}, err
	}
	query := url.Values{"q": {input.Query}, "license": {input.License}, "source": {"freesound"}, "page": {fmt.Sprint(input.Page)}, "page_size": {fmt.Sprint(input.Limit)}, "mature": {"false"}}
	key := query.Encode()
	c.mu.Lock()
	cached, found := c.cache[key]
	c.mu.Unlock()
	if found && c.now().Before(cached.until) {
		cached.result.Cached = true
		return cached.result, nil
	}
	if disk, ok := c.readDiskSearch(key); ok {
		c.storeSearchCache(key, disk)
		disk.Cached = true
		return disk, nil
	}
	if curated, ok := c.searchCurated(input); ok {
		c.storeSearchCache(key, curated)
		return curated, nil
	}
	var response struct {
		Results   []openverseSound `json:"results"`
		PageCount int              `json:"page_count"`
	}
	if err := c.metadata(ctx, apiOrigin+"?"+key, &response); err != nil {
		return SearchResult{}, err
	}
	result := SearchResult{Sounds: []Sound{}, Page: input.Page, PageCount: response.PageCount, MaxImportBytes: MaxAudioBytes}
	for _, item := range response.Results {
		if item.License != input.License {
			continue
		}
		sound, err := item.sound()
		if err == nil {
			result.Sounds = append(result.Sounds, sound)
		}
		if len(result.Sounds) == input.Limit {
			break
		}
	}
	c.storeSearchCache(key, result)
	c.writeDiskSearch(key, result)
	return result, nil
}

func (c *Client) Lookup(ctx context.Context, id string) (Sound, error) {
	if !ValidID(id) {
		return Sound{}, errors.New("Use an exact Openverse audio ID from search_sound_effects.")
	}
	c.mu.Lock()
	cached, found := c.lookupCache[id]
	c.mu.Unlock()
	if found && c.now().Before(cached.until) {
		return cached.sound, nil
	}
	if disk, ok := c.readDiskLookup(id); ok {
		c.storeLookupCache(disk)
		return disk, nil
	}
	var item openverseSound
	if err := c.metadata(ctx, apiOrigin+id+"/", &item); err != nil {
		return Sound{}, err
	}
	if item.ID != id {
		return Sound{}, errors.New("Sound library returned a different source identity.")
	}
	sound, err := item.sound()
	if err != nil {
		return Sound{}, err
	}
	c.storeLookupCache(sound)
	c.writeDiskLookup(sound)
	return sound, nil
}

func (c *Client) metadata(ctx context.Context, address string, result any) error {
	body, err := c.get(ctx, address, maxMetadataBytes, requestTimeout)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, result); err != nil {
		return errors.New("Sound library returned invalid metadata.")
	}
	return nil
}

func (c *Client) Download(ctx context.Context, sound Sound) ([]byte, error) {
	if sound.SizeBytes != nil && *sound.SizeBytes > MaxAudioBytes {
		return nil, ErrPreviewTooLarge
	}
	if !sound.Importable || !AllowedLicense(sound.License) || !previewAllowed(sound.URL, sound.Filetype) {
		return nil, errors.New("Only approved direct Freesound CDN MP3/WAV/OGG/FLAC previews can be imported; no fallback was attempted.")
	}
	if body, ok := c.readDiskAudio(sound); ok {
		return body, nil
	}
	body, err := c.get(ctx, sound.URL, MaxAudioBytes, audioTimeout)
	if errors.Is(err, errResponseTooLarge) {
		return nil, ErrPreviewTooLarge
	}
	if err != nil {
		return nil, err
	}
	if !audioSignature(body, sound.Filetype) {
		return nil, errors.New("Preview is not a supported audio container.")
	}
	c.writeDiskAudio(sound, body)
	return body, nil
}

var errResponseTooLarge = errors.New("Sound library response exceeds the size limit.")

func (c *Client) get(ctx context.Context, address string, maximum int64, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	select {
	case c.gate <- struct{}{}:
		defer func() { <-c.gate }()
	default:
		return nil, &Failure{Status: http.StatusTooManyRequests, RetryAfter: "5"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, errors.New("Invalid sound library request.")
	}
	req.Header.Set("Accept", "application/json, audio/*")
	req.Header.Set("User-Agent", "machinal-sound-library/1.0")
	response, err := c.http.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, &Failure{Status: http.StatusGatewayTimeout}
		}
		return nil, &Failure{Status: http.StatusBadGateway}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		status := http.StatusBadGateway
		if response.StatusCode == http.StatusTooManyRequests {
			status = http.StatusTooManyRequests
		}
		retry := response.Header.Get("Retry-After")
		if len(retry) > 80 {
			retry = ""
		}
		return nil, &Failure{Status: status, RetryAfter: retry}
	}
	if response.ContentLength > maximum {
		return nil, errResponseTooLarge
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maximum+1))
	if int64(len(body)) > maximum {
		return nil, errResponseTooLarge
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return nil, &Failure{Status: http.StatusGatewayTimeout}
	}
	if err != nil || len(body) == 0 || response.ContentLength >= 0 && int64(len(body)) != response.ContentLength {
		return nil, errors.New("Sound library returned an empty or incomplete response.")
	}
	return body, nil
}
