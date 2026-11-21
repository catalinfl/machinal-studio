// Package objectstore is the S3 source of truth for media.
//
// Layout: media lives under "<user>/<name>", final renders under
// "<user>/renders/<name>", and live scenes under "<user>/scenes/<name>".
// The local volume ("/data/{user}") holds API-uploaded sources without a cloud
// copy, and caches existing cloud media. Browser uploads still publish in the
// background. Reads use EnsureLocal when editing needs a cloud original.
// Lightweight previews can instead use version-pinned range reads without
// downloading the original into the volume.
//
// The client is stdlib-only SigV4 over HTTP and works with any S3-compatible
// endpoint (AWS S3, Tigris, MinIO, R2 with an S3 API).
package objectstore

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"ffmpeg-go-server/internal/platform/storage"
)

// Config wires the bucket. All values come from the environment:
//
//	S3_ENDPOINT          e.g. https://t3.storageapi.dev
//	S3_INTERNAL_ENDPOINT optional private endpoint for server transfers; same bucket
//	S3_REGION            e.g. auto (default)
//	S3_BUCKET            bucket name
//	S3_ACCESS_KEY_ID     (or S3_ACCESS_KEY)
//	S3_SECRET_ACCESS_KEY (or S3_SECRET_KEY)
type Config struct {
	Endpoint       string
	PublicEndpoint string
	Region         string
	Bucket         string
	AccessKey      string
	SecretKey      string
}

// FromEnv reads the S3 configuration from the environment.
func FromEnv() Config {
	access := strings.TrimSpace(os.Getenv("S3_ACCESS_KEY_ID"))
	if access == "" {
		access = strings.TrimSpace(os.Getenv("S3_ACCESS_KEY"))
	}
	secret := strings.TrimSpace(os.Getenv("S3_SECRET_ACCESS_KEY"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("S3_SECRET_KEY"))
	}
	region := strings.TrimSpace(os.Getenv("S3_REGION"))
	if region == "" {
		region = "auto"
	}
	publicEndpoint := strings.TrimRight(strings.TrimSpace(os.Getenv("S3_ENDPOINT")), "/")
	endpoint := strings.TrimRight(strings.TrimSpace(os.Getenv("S3_INTERNAL_ENDPOINT")), "/")
	if endpoint == "" {
		endpoint = publicEndpoint
	}
	return Config{
		Endpoint:       endpoint,
		PublicEndpoint: publicEndpoint,
		Region:         region,
		Bucket:         strings.TrimSpace(os.Getenv("S3_BUCKET")),
		AccessKey:      access,
		SecretKey:      secret,
	}
}

// Enabled reports whether uploads/downloads can run.
func (c Config) Enabled() bool {
	return c.Endpoint != "" && c.Bucket != "" && c.AccessKey != "" && c.SecretKey != ""
}

// Key maps a user file to its object name.
func Key(user, name string) string { return user + "/" + name }

// RenderKey maps a final render to its object name.
func RenderKey(user, name string) string { return user + "/renders/" + name }

func SceneKey(user, name string) string { return user + "/scenes/" + name }

// Scene sources used to be stored at the owner root. Keep those readable.
func SessionKeys(user, name string) []string {
	if storage.IsSceneSource(name) {
		return []string{SceneKey(user, name), Key(user, name)}
	}
	return []string{Key(user, name), RenderKey(user, name)}
}

// Object is one S3 listing entry.
type Object struct {
	Key  string
	Size int64
	ETag string
}

var ErrObjectChanged = errors.New("s3 object changed during reading")

// Client is a minimal S3-compatible client. HTTP may be replaced in tests.
type Client struct {
	Config Config
	HTTP   *http.Client
}

const (
	// httpTimeout bounds slow S3 transfers (notably multi-GB uploads).
	httpTimeout = 10 * time.Minute
	// drainLimit caps response bodies kept only to reuse connections.
	drainLimit = 4 << 10
	// listLimit caps a single ListBucket XML page; 8 MiB fits 1000 entries.
	listLimit = 8 << 20
	// listMaxKeys is the S3 page size for List.
	listMaxKeys = "1000"
	// maxPresignTTL is the SigV4 ceiling for presigned URLs (7 days).
	maxPresignTTL = 7 * 24 * time.Hour
	// backgroundPutTimeout bounds async render uploads.
	backgroundPutTimeout = 30 * time.Minute
	// fetchFilePerm keeps S3-hydrated session files private (was 0644
	// world-readable). Uploads via CreateTemp are 0600; keep the same.
	fetchFilePerm = 0600
)

// New builds a client from config.
func New(config Config) *Client {
	return &Client{Config: config, HTTP: &http.Client{Timeout: httpTimeout, CheckRedirect: rejectRedirect}}
}

func rejectRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

var fallbackHTTPClient = &http.Client{Timeout: httpTimeout, CheckRedirect: rejectRedirect}

var (
	sharedOnce   sync.Once
	sharedClient *Client
)

// Shared returns the process-wide client built from the environment.
func Shared() *Client {
	// Standalone builds never consume inherited S3 credentials or cloud endpoints.
	sharedOnce.Do(func() { sharedClient = New(Config{}) })
	return sharedClient
}

// Enabled reports whether S3 is configured.
func Enabled() bool { return Shared().Config.Enabled() }

func (c *Client) Enabled() bool { return c.Config.Enabled() }

func (c *Client) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return fallbackHTTPClient
}

func (c *Client) objectURL(key string) string {
	return c.Config.Endpoint + "/" + c.Config.Bucket + "/" + escapeKey(key)
}

func escapeKey(key string) string {
	segments := strings.Split(key, "/")
	for i, segment := range segments {
		segments[i] = encodeSegment(segment)
	}
	return strings.Join(segments, "/")
}

// encodeSegment percent-encodes one path segment with the exact SigV4
// alphabet: only unreserved [A-Za-z0-9-_.~] stay literal, "/" stays the
// separator. Notably url.PathEscape is WRONG here: it leaves sub-delims like
// "+" and "=" literal, while S3 canonicalizes them as %2B/%3D — the signature
// then mismatches and every such key 403s.
func encodeSegment(segment string) string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
	var builder strings.Builder
	builder.Grow(len(segment))
	for i := 0; i < len(segment); i++ {
		char := segment[i]
		if strings.IndexByte(unreserved, char) >= 0 {
			builder.WriteByte(char)
			continue
		}
		const hexDigits = "0123456789ABCDEF"
		builder.WriteByte('%')
		builder.WriteByte(hexDigits[char>>4])
		builder.WriteByte(hexDigits[char&0x0f])
	}
	return builder.String()
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	// Infallible: hash.Hash.Write only fails on a nil receiver.
	_, _ = mac.Write([]byte(data))
	return mac.Sum(nil)
}

func (c *Client) signingKey(date string) []byte {
	key := hmacSHA256([]byte("AWS4"+c.Config.SecretKey), date)
	key = hmacSHA256(key, c.Config.Region)
	key = hmacSHA256(key, "s3")
	return hmacSHA256(key, "aws4_request")
}

// rfc3986 encodes a query component the way SigV4 requires: unreserved
// [A-Za-z0-9-_.~] stay literal, space is %20 (never "+"), and the sub-delims
// url.QueryEscape leaves behind ("*", "(", ")") are encoded too — all three
// are legal in file names ("clip (1).mp4") and flow into list prefixes.
func rfc3986(value string) string {
	encoded := url.QueryEscape(value)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	encoded = strings.ReplaceAll(encoded, "*", "%2A")
	encoded = strings.ReplaceAll(encoded, "(", "%28")
	encoded = strings.ReplaceAll(encoded, ")", "%29")
	return encoded
}

func canonicalQuery(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	for i, key := range keys {
		if i > 0 {
			builder.WriteByte('&')
		}
		builder.WriteString(rfc3986(key))
		builder.WriteByte('=')
		builder.WriteString(rfc3986(params[key]))
	}
	return builder.String()
}

// sign attaches SigV4 authorization to req. bodyHash is the hex sha256 of the
// payload ("UNSIGNED-PAYLOAD" for presigned/empty bodies is handled by callers
// passing the literal they also send in x-amz-content-sha256).
func (c *Client) sign(req *http.Request, bodyHash string) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	shortDate := now.Format("20060102")
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", bodyHash)

	host := req.URL.Host
	canonicalHeaders := "host:" + host + "\n" + "x-amz-content-sha256:" + bodyHash + "\n" + "x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"

	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		req.URL.RawQuery,
		canonicalHeaders,
		signedHeaders,
		bodyHash,
	}, "\n")

	scope := shortDate + "/" + c.Config.Region + "/s3/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + sha256Hex([]byte(canonicalRequest))
	signature := hex.EncodeToString(hmacSHA256(c.signingKey(shortDate), stringToSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+c.Config.AccessKey+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
}

// Put uploads one object.
func (c *Client) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	if !c.Config.Enabled() {
		return fmt.Errorf("s3 is not configured")
	}
	if size < 0 {
		return fmt.Errorf("s3 put %q: negative size", key)
	}
	if contentType == "" {
		contentType = contentTypeFor(key)
	}
	// Fast path: seekable bodies (notably the *os.File handles passed by
	// BackgroundPut) are hashed by streaming and then rewound, so even a
	// 2GB upload never sits fully in RAM. Without this, concurrent uploads
	// would OOM the server.
	if seeker, ok := body.(io.ReadSeeker); ok {
		hash := sha256.New()
		if _, err := io.Copy(hash, seeker); err != nil {
			return fmt.Errorf("s3 put %q: hash body: %w", key, err)
		}
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return fmt.Errorf("s3 put %q: rewind body: %w", key, err)
		}
		bodyHash := hex.EncodeToString(hash.Sum(nil))
		return c.putStream(ctx, key, seeker, size, contentType, bodyHash)
	}
	data, err := io.ReadAll(io.LimitReader(body, size+1))
	if err != nil {
		return fmt.Errorf("s3 put %q: buffer body: %w", key, err)
	}
	if int64(len(data)) != size {
		return fmt.Errorf("s3 put %q: short body", key)
	}
	return c.putStream(ctx, key, bytes.NewReader(data), size, contentType, sha256Hex(data))
}

func (c *Client) putStream(ctx context.Context, key string, body io.Reader, size int64, contentType, bodyHash string) error {
	_, err := c.putStreamVersion(ctx, key, body, size, contentType, bodyHash)
	return err
}

func (c *Client) putStreamVersion(ctx context.Context, key string, body io.Reader, size int64, contentType, bodyHash string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, c.objectURL(key), body)
	if err != nil {
		return "", fmt.Errorf("s3 put %q: build request: %w", key, err)
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = size
	c.sign(req, bodyHash)
	response, err := c.http().Do(req)
	if err != nil {
		return "", fmt.Errorf("s3 put %q: %w", key, err)
	}
	defer response.Body.Close()
	// Best-effort: draining enables connection reuse; a failure just closes it.
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, drainLimit))
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusNoContent {
		return "", fmt.Errorf("s3 put %q: status %s", key, response.Status)
	}
	return strings.Trim(response.Header.Get("ETag"), `"`), nil
}

// Get downloads one object. The caller closes Body. os.ErrNotExist is
// returned for missing keys.
func (c *Client) Get(ctx context.Context, key string) (body io.ReadCloser, size int64, etag string, err error) {
	return c.get(ctx, key, "", "")
}

func (c *Client) GetRange(ctx context.Context, key, byteRange, etag string) (io.ReadCloser, int64, string, error) {
	return c.get(ctx, key, byteRange, etag)
}

func (c *Client) get(ctx context.Context, key, byteRange, etag string) (body io.ReadCloser, size int64, version string, err error) {
	if !c.Config.Enabled() {
		return nil, 0, "", fmt.Errorf("s3 is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.objectURL(key), nil)
	if err != nil {
		return nil, 0, "", fmt.Errorf("s3 get %q: build request: %w", key, err)
	}
	if byteRange != "" {
		req.Header.Set("Range", byteRange)
	}
	if etag != "" {
		req.Header.Set("If-Match", `"`+etag+`"`)
	}
	c.sign(req, sha256Hex(nil))
	response, err := c.http().Do(req)
	if err != nil {
		return nil, 0, "", fmt.Errorf("s3 get %q: %w", key, err)
	}
	if response.StatusCode == http.StatusNotFound {
		response.Body.Close()
		return nil, 0, "", fmt.Errorf("s3 get %q: %w", key, os.ErrNotExist)
	}
	if response.StatusCode == http.StatusPreconditionFailed {
		response.Body.Close()
		return nil, 0, "", fmt.Errorf("s3 get %q: %w", key, ErrObjectChanged)
	}
	wantStatus := http.StatusOK
	if byteRange != "" {
		wantStatus = http.StatusPartialContent
	}
	if response.StatusCode != wantStatus {
		response.Body.Close()
		return nil, 0, "", fmt.Errorf("s3 get %q: status %s", key, response.Status)
	}
	return response.Body, response.ContentLength, strings.Trim(response.Header.Get("ETag"), `"`), nil
}

func (c *Client) Head(ctx context.Context, key string) (Object, error) {
	if !c.Config.Enabled() {
		return Object{}, fmt.Errorf("s3 is not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, c.objectURL(key), nil)
	if err != nil {
		return Object{}, fmt.Errorf("s3 head %q: build request: %w", key, err)
	}
	c.sign(req, sha256Hex(nil))
	response, err := c.http().Do(req)
	if err != nil {
		return Object{}, fmt.Errorf("s3 head %q: %w", key, err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return Object{}, fmt.Errorf("s3 head %q: %w", key, os.ErrNotExist)
	}
	if response.StatusCode != http.StatusOK {
		return Object{}, fmt.Errorf("s3 head %q: status %s", key, response.Status)
	}
	etag := strings.Trim(response.Header.Get("ETag"), `"`)
	if response.ContentLength <= 0 || etag == "" {
		return Object{}, fmt.Errorf("s3 head %q: invalid size or etag", key)
	}
	return Object{Key: key, Size: response.ContentLength, ETag: etag}, nil
}

// Delete removes one object; missing keys are not an error.
func (c *Client) Delete(ctx context.Context, key string) error {
	if !c.Config.Enabled() {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.objectURL(key), nil)
	if err != nil {
		return fmt.Errorf("s3 delete %q: build request: %w", key, err)
	}
	c.sign(req, sha256Hex(nil))
	response, err := c.http().Do(req)
	if err != nil {
		return fmt.Errorf("s3 delete %q: %w", key, err)
	}
	defer response.Body.Close()
	// Best-effort: draining enables connection reuse; a failure just closes it.
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, drainLimit))
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusNoContent && response.StatusCode != http.StatusNotFound {
		return fmt.Errorf("s3 delete %q: status %s", key, response.Status)
	}
	return nil
}

type listBucketResult struct {
	XMLName               xml.Name `xml:"ListBucketResult"`
	IsTruncated           bool     `xml:"IsTruncated"`
	NextContinuationToken string   `xml:"NextContinuationToken"`
	Contents              []struct {
		Key  string `xml:"Key"`
		Size int64  `xml:"Size"`
		ETag string `xml:"ETag"`
	} `xml:"Contents"`
}

// List returns all objects under prefix, following continuation tokens.
func (c *Client) List(ctx context.Context, prefix string) ([]Object, error) {
	if !c.Config.Enabled() {
		return nil, fmt.Errorf("s3 is not configured")
	}
	var out []Object
	token := ""
	for {
		params := map[string]string{"list-type": "2", "prefix": prefix, "max-keys": listMaxKeys}
		if token != "" {
			params["continuation-token"] = token
		}
		rawURL := c.Config.Endpoint + "/" + c.Config.Bucket + "?" + canonicalQuery(params)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
		if err != nil {
			return nil, fmt.Errorf("s3 list %q: build request: %w", prefix, err)
		}
		c.sign(req, sha256Hex(nil))
		response, err := c.http().Do(req)
		if err != nil {
			return nil, fmt.Errorf("s3 list %q: %w", prefix, err)
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, listLimit))
		response.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("s3 list %q: read response: %w", prefix, err)
		}
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("s3 list %q: status %s", prefix, response.Status)
		}
		var result listBucketResult
		if err := xml.Unmarshal(data, &result); err != nil {
			return nil, fmt.Errorf("s3 list %q: %w", prefix, err)
		}
		for _, item := range result.Contents {
			out = append(out, Object{Key: item.Key, Size: item.Size, ETag: strings.Trim(item.ETag, `"`)})
		}
		if !result.IsTruncated {
			return out, nil
		}
		token = result.NextContinuationToken
		if token == "" {
			return out, nil
		}
	}
}

// PresignGet returns a time-limited download URL for sharing finals later.
func (c *Client) PresignGet(key string, ttl time.Duration) (string, error) {
	return c.presignGet(c.Config.Endpoint, key, ttl)
}

// PresignDownload signs the public host directly; rewriting a signed internal URL invalidates its signature.
func (c *Client) PresignDownload(key string, ttl time.Duration) (string, error) {
	endpoint := c.Config.PublicEndpoint
	if endpoint == "" {
		endpoint = c.Config.Endpoint
	}
	return c.presignGet(endpoint, key, ttl)
}

func (c *Client) presignGet(base, key string, ttl time.Duration) (string, error) {
	if !c.Config.Enabled() {
		return "", fmt.Errorf("s3 is not configured")
	}
	if ttl <= 0 || ttl > maxPresignTTL {
		ttl = time.Hour
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	shortDate := now.Format("20060102")
	scope := shortDate + "/" + c.Config.Region + "/s3/aws4_request"
	params := map[string]string{
		"X-Amz-Algorithm":     "AWS4-HMAC-SHA256",
		"X-Amz-Credential":    c.Config.AccessKey + "/" + scope,
		"X-Amz-Date":          amzDate,
		"X-Amz-Expires":       strconv.Itoa(int(ttl.Seconds())),
		"X-Amz-SignedHeaders": "host",
	}
	endpoint, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("s3 presign: parse endpoint: %w", err)
	}
	canonicalURI := "/" + c.Config.Bucket + "/" + escapeKey(key)
	canonicalRequest := strings.Join([]string{
		http.MethodGet,
		canonicalURI,
		canonicalQuery(params),
		"host:" + endpoint.Host + "\n",
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + sha256Hex([]byte(canonicalRequest))
	signature := hex.EncodeToString(hmacSHA256(c.signingKey(shortDate), stringToSign))
	return base + canonicalURI + "?" + canonicalQuery(params) + "&X-Amz-Signature=" + signature, nil
}

var fetchMu sync.Mutex
var inFlight = map[string]chan struct{}{}

// maxFetchBytes caps a single S3 fetch into the volume. It matches the 2GB
// upload limit so no cache fill can exceed what an upload could store.
// A var (not const) so tests can shrink it.
var maxFetchBytes = int64(2 << 30)

// EnsureLocal guarantees name exists under root, fetching "<user>/<name>"
// from S3 on a cache miss via tmp + atomic rename. Concurrent callers for
// the same key wait on one flight instead of stampeding S3. Without S3 it
// just stats the local file. It returns the local path.
func (c *Client) EnsureLocal(ctx context.Context, user, root, name string) (string, error) {
	// Defense in depth: every caller validates already, but a flat name here
	// is what keeps the Join below inside the session volume.
	if !validLocalName(name) {
		return "", fmt.Errorf("invalid name")
	}
	local := filepath.Join(root, name)
	if info, err := os.Lstat(local); err == nil {
		if info.Mode().IsRegular() {
			return local, nil
		}
		return "", fmt.Errorf("invalid cached file: %s", name)
	}
	if !c.Config.Enabled() {
		return "", os.ErrNotExist
	}
	flightKey := user + "\x00" + name
	fetchMu.Lock()
	wait, ok := inFlight[flightKey]
	if !ok {
		wait = make(chan struct{})
		inFlight[flightKey] = wait
		fetchMu.Unlock()

		err := c.fetchToLocal(ctx, user, root, name, local)

		fetchMu.Lock()
		delete(inFlight, flightKey)
		close(wait)
		fetchMu.Unlock()
		if err != nil {
			return "", err
		}
		return local, nil
	}
	fetchMu.Unlock()

	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-wait:
	}
	if info, err := os.Lstat(local); err == nil && info.Mode().IsRegular() {
		return local, nil
	}
	return "", os.ErrNotExist
}

func (c *Client) fetchToLocal(ctx context.Context, user, root, name, local string) error {
	return c.fetchKeyToLocal(ctx, Key(user, name), root, local)
}

func (c *Client) fetchKeyToLocal(ctx context.Context, key, root, local string) error {
	body, size, etag, err := c.Get(ctx, key)
	if err != nil {
		return fmt.Errorf("fetch %q: %w", key, err)
	}
	defer body.Close()
	tmp, err := os.CreateTemp(root, ".fetch-*")
	if err != nil {
		return fmt.Errorf("fetch %q: create temp: %w", key, err)
	}
	tmpName := tmp.Name()
	committed := false
	defer func() {
		if !committed {
			// Best-effort: temp cleanup must not mask the fetch error.
			_ = tmp.Close()
			_ = os.Remove(tmpName)
		}
	}()
	hash := sha256.New()
	written, err := io.CopyN(io.MultiWriter(tmp, hash), body, maxFetchBytes+1)
	if err != nil && err != io.EOF {
		return fmt.Errorf("fetch %q: download: %w", key, err)
	}
	if written == 0 {
		return fmt.Errorf("s3 object %q is empty", key)
	}
	if written > maxFetchBytes {
		return fmt.Errorf("s3 object %q exceeds the %d byte volume limit", key, maxFetchBytes)
	}
	if size >= 0 && written != size {
		return fmt.Errorf("s3 object %q is truncated", key)
	}
	if err := tmp.Chmod(fetchFilePerm); err != nil {
		return fmt.Errorf("fetch %q: chmod temp: %w", key, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("fetch %q: close temp: %w", key, err)
	}
	if err := os.Rename(tmpName, local); err != nil {
		return fmt.Errorf("fetch %q: publish: %w", key, err)
	}
	committed = true
	if err := rememberCloudCopy(local, key, etag, hex.EncodeToString(hash.Sum(nil))); err != nil {
		log.Printf("s3: retain untracked cache file: %v", err)
	}
	return nil
}

// ensureKeyLocal is the flight-coalesced fetch for an explicit S3 key into
// root/name. Final exports live under "<user>/renders/<name>" while sources
// live under "<user>/<name>"; both hydrate to the same flat volume path.
func (c *Client) ensureKeyLocal(ctx context.Context, flightSuffix, key, root, name, local string) error {
	fetchMu.Lock()
	wait, ok := inFlight[flightSuffix]
	if !ok {
		wait = make(chan struct{})
		inFlight[flightSuffix] = wait
		fetchMu.Unlock()

		err := c.fetchKeyToLocal(ctx, key, root, local)

		fetchMu.Lock()
		delete(inFlight, flightSuffix)
		close(wait)
		fetchMu.Unlock()
		return err
	}
	fetchMu.Unlock()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-wait:
	}
	if info, err := os.Lstat(local); err == nil && info.Mode().IsRegular() {
		return nil
	}
	return os.ErrNotExist
}

// EnsureRenderLocal guarantees a final export exists under root, fetching
// "<user>/renders/<name>" from S3 on a cache miss. Without S3 it just stats
// the local file.
func (c *Client) EnsureRenderLocal(ctx context.Context, user, root, name string) (string, error) {
	if !validLocalName(name) {
		return "", fmt.Errorf("invalid name")
	}
	local := filepath.Join(root, name)
	if info, err := os.Lstat(local); err == nil {
		if info.Mode().IsRegular() {
			return local, nil
		}
		return "", fmt.Errorf("invalid cached file: %s", name)
	}
	if !c.Config.Enabled() {
		return "", os.ErrNotExist
	}
	if err := c.ensureKeyLocal(ctx, "render\x00"+user+"\x00"+name, RenderKey(user, name), root, name, local); err != nil {
		return "", err
	}
	return local, nil
}

// EnsureSessionFile hydrates media, renders, or live scenes into the flat
// session cache, including scene sources stored under the old owner-root key.
func (c *Client) EnsureSessionFile(ctx context.Context, user, root, name string) (string, error) {
	if !validLocalName(name) {
		return "", fmt.Errorf("invalid name")
	}
	if storage.IsSceneSource(name) {
		local := filepath.Join(root, name)
		if info, err := os.Lstat(local); err == nil {
			if info.Mode().IsRegular() {
				return local, nil
			}
			return "", fmt.Errorf("invalid cached file: %s", name)
		}
		if !c.Enabled() {
			return "", os.ErrNotExist
		}
		for _, key := range SessionKeys(user, name) {
			err := c.ensureKeyLocal(ctx, key+"\x00"+root, key, root, name, local)
			if err == nil {
				return local, nil
			}
			if !errors.Is(err, os.ErrNotExist) {
				return "", err
			}
		}
		return "", os.ErrNotExist
	}
	if local, err := c.EnsureLocal(ctx, user, root, name); err == nil {
		return local, nil
	} else if !os.IsNotExist(err) && err != context.Canceled && err != context.DeadlineExceeded {
		// A local hit or a hard error (invalid name, bad cache) is final;
		// only a cache miss falls through to the renders/ prefix. S3
		// transport errors surface as wrapped os.ErrNotExist from fetch, so
		// retry the render key before giving up.
		if _, statErr := os.Lstat(filepath.Join(root, name)); statErr == nil {
			return filepath.Join(root, name), nil
		}
	}
	return c.EnsureRenderLocal(ctx, user, root, name)
}

// validLocalName mirrors the storage traversal rules without importing the
// storage package: flat, non-hidden names only.
func validLocalName(name string) bool {
	if name == "" || strings.HasPrefix(name, ".") {
		return false
	}
	if strings.ContainsAny(name, "/\\") {
		return false
	}
	for _, char := range name {
		if char < 0x20 || char == 0x7f {
			return false
		}
	}
	clean := path.Clean(name)
	return clean != "." && clean != ".." && clean == name
}

// EnsureLocal is the shared-client shortcut. user/root/name map to
// "<user>/<name>" in S3 and root/name on disk. An empty user disables the S3
// leg and only stats the local file.
func EnsureLocal(ctx context.Context, user, root, name string) (string, error) {
	if !validLocalName(name) {
		return "", fmt.Errorf("invalid name")
	}
	if user == "" {
		local := filepath.Join(root, name)
		if info, err := os.Lstat(local); err == nil && info.Mode().IsRegular() {
			return local, nil
		}
		return "", os.ErrNotExist
	}
	return Shared().EnsureLocal(ctx, user, root, name)
}

// EnsureRenderLocal is the shared-client shortcut for final exports stored
// as "<user>/renders/<name>" in S3.
func EnsureRenderLocal(ctx context.Context, user, root, name string) (string, error) {
	if !validLocalName(name) {
		return "", fmt.Errorf("invalid name")
	}
	if user == "" {
		local := filepath.Join(root, name)
		if info, err := os.Lstat(local); err == nil && info.Mode().IsRegular() {
			return local, nil
		}
		return "", os.ErrNotExist
	}
	return Shared().EnsureRenderLocal(ctx, user, root, name)
}

// EnsureSessionFile is the shared-client shortcut that hydrates either a
// source ("<user>/<name>") or a final export ("<user>/renders/<name>").
func EnsureSessionFile(ctx context.Context, user, root, name string) (string, error) {
	if !validLocalName(name) {
		return "", fmt.Errorf("invalid name")
	}
	if user == "" {
		local := filepath.Join(root, name)
		if info, err := os.Lstat(local); err == nil && info.Mode().IsRegular() {
			return local, nil
		}
		return "", os.ErrNotExist
	}
	return Shared().EnsureSessionFile(ctx, user, root, name)
}

// backgroundPutSlots bounds concurrent async uploads so a burst of uploads or
// renders cannot exhaust FDs/goroutines (was unbounded go func per request).
var backgroundPutSlots = make(chan struct{}, 8)

func PublishFile(ctx context.Context, localPath, key string) error {
	return Shared().PublishFile(ctx, localPath, key)
}

func (client *Client) PublishFile(ctx context.Context, localPath, key string) error {
	if !client.Config.Enabled() {
		return nil
	}
	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open storage upload: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat storage upload: %w", err)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("hash storage upload: %w", err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewind storage upload: %w", err)
	}
	checksum := hex.EncodeToString(hash.Sum(nil))
	etag, err := client.putStreamVersion(ctx, key, file, info.Size(), contentTypeFor(key), checksum)
	if err != nil {
		return fmt.Errorf("publish storage object: %w", err)
	}
	current, err := os.Lstat(localPath)
	if err == nil && os.SameFile(info, current) && info.Size() == current.Size() && info.ModTime() == current.ModTime() {
		if err := rememberCloudCopy(localPath, key, etag, checksum); err != nil {
			log.Printf("s3: retain untracked published file: %v", err)
		}
	}
	return nil
}

// BackgroundPut uploads a local file without blocking the response path.
// Failures are logged; the local file stays the source of truth for the
// immediate download.
func BackgroundPut(user, localPath, key string) {
	if user == "" || !Enabled() {
		return
	}
	select {
	case backgroundPutSlots <- struct{}{}:
	default:
		log.Printf("s3: background upload shed (busy): %s", key)
		return
	}
	go func() {
		defer func() { <-backgroundPutSlots }()
		ctx, cancel := context.WithTimeout(context.Background(), backgroundPutTimeout)
		defer cancel()
		if err := Shared().PublishFile(ctx, localPath, key); err != nil {
			log.Printf("s3: put %s: %v", key, err)
			return
		}
		log.Printf("s3: stored %s", key)
	}()
}

func contentTypeFor(key string) string {
	switch strings.ToLower(path.Ext(key)) {
	case ".mp4", ".m4v", ".mov":
		return "video/mp4"
	case ".avi":
		return "video/x-msvideo"
	case ".mkv":
		return "video/x-matroska"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg", ".oga":
		return "audio/ogg"
	case ".m4a", ".aac":
		return "audio/mp4"
	case ".flac":
		return "audio/flac"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	default:
		return "application/octet-stream"
	}
}
