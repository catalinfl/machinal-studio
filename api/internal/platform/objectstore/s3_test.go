package objectstore

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeS3 is an auth-ignoring in-memory S3 used to exercise Put/Get/List/
// Delete/EnsureLocal end to end.
type fakeS3 struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func newFakeS3() (*fakeS3, *httptest.Server) {
	fake := &fakeS3{objects: map[string][]byte{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trimmed := strings.TrimPrefix(r.URL.Path, "/")
		_, key, _ := strings.Cut(trimmed, "/")
		fake.mu.Lock()
		defer fake.mu.Unlock()
		switch {
		case r.Method == http.MethodPut:
			data, _ := io.ReadAll(r.Body)
			fake.objects[key] = data
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodGet && r.URL.Query().Get("list-type") == "2":
			prefix := r.URL.Query().Get("prefix")
			var builder strings.Builder
			builder.WriteString(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">`)
			for name, data := range fake.objects {
				if !strings.HasPrefix(name, prefix) {
					continue
				}
				builder.WriteString(`<Contents><Key>` + name + `</Key><Size>` + itoa(len(data)) + `</Size><ETag>"abc"</ETag></Contents>`)
			}
			builder.WriteString(`<IsTruncated>false</IsTruncated></ListBucketResult>`)
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(builder.String()))
		case r.Method == http.MethodGet:
			data, ok := fake.objects[key]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			// Real S3 always answers GET with an explicit Content-Length.
			w.Header().Set("ETag", `"abc"`)
			w.Header().Set("Content-Length", itoa(len(data)))
			_, _ = w.Write(data)
		case r.Method == http.MethodDelete:
			delete(fake.objects, key)
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	return fake, server
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

func testClient(t *testing.T, fake *fakeS3, server *httptest.Server) *Client {
	t.Helper()
	return New(Config{
		Endpoint:  server.URL,
		Region:    "auto",
		Bucket:    "test-bucket",
		AccessKey: "test-key",
		SecretKey: "test-secret",
	})
}

func TestPutGetDeleteRoundTrip(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	// Rebuild client against the live server URL.
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	ctx := context.Background()
	payload := []byte("hello media")
	if err := client.Put(ctx, "user-1/clip.mp4", bytes.NewReader(payload), int64(len(payload)), ""); err != nil {
		t.Fatal(err)
	}
	body, size, etag, err := client.Get(ctx, "user-1/clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	data, _ := io.ReadAll(body)
	if !bytes.Equal(data, payload) || size != int64(len(payload)) || etag == "" {
		t.Fatalf("get = %d bytes etag %q, want %d bytes", size, etag, len(payload))
	}
	if _, _, _, err := client.Get(ctx, "user-1/missing.mp4"); !isNotExist(err) {
		t.Fatalf("missing get err = %v, want not-exist", err)
	}
	if err := client.Delete(ctx, "user-1/clip.mp4"); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := client.Get(ctx, "user-1/clip.mp4"); !isNotExist(err) {
		t.Fatalf("deleted get err = %v, want not-exist", err)
	}
}

func TestSceneRehydratesFromCanonicalAndLegacyPaths(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	name := "ai_scene_" + strings.Repeat("a", 32) + "_01.scene.json"
	for _, key := range []string{SceneKey("owner", name), Key("legacy", name)} {
		payload := []byte(`{"component":"<p>Saved scene</p>"}`)
		if err := client.Put(context.Background(), key, bytes.NewReader(payload), int64(len(payload)), "application/json"); err != nil {
			t.Fatal(err)
		}
		user := strings.Split(key, "/")[0]
		local, err := client.EnsureSessionFile(context.Background(), user, t.TempDir(), name)
		if err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(local)
		if err != nil || !bytes.Equal(data, payload) {
			t.Fatalf("restored scene: %s, %v", data, err)
		}
	}
}

func isNotExist(err error) bool {
	return err != nil && strings.Contains(err.Error(), "not exist")
}

func TestListPrefix(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	ctx := context.Background()
	for _, key := range []string{"user-1/a.mp4", "user-1/b.mp4", "user-2/c.mp4"} {
		payload := []byte("x")
		if err := client.Put(ctx, key, bytes.NewReader(payload), 1, ""); err != nil {
			t.Fatal(err)
		}
	}
	objects, err := client.List(ctx, "user-1/")
	if err != nil {
		t.Fatal(err)
	}
	if len(objects) != 2 {
		t.Fatalf("list = %d objects, want 2", len(objects))
	}
	for _, object := range objects {
		if !strings.HasPrefix(object.Key, "user-1/") || object.Size != 1 || object.ETag != "abc" {
			t.Fatalf("object = %+v, unexpected", object)
		}
	}
}

func TestEnsureLocalFetchesOnMiss(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	ctx := context.Background()
	payload := []byte("remote bytes")
	if err := client.Put(ctx, "user-9/clip.mp4", bytes.NewReader(payload), int64(len(payload)), ""); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	got, err := client.EnsureLocal(ctx, "user-9", root, "clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Join(root, "clip.mp4") {
		t.Fatalf("EnsureLocal = %q", got)
	}
	data, err := os.ReadFile(got)
	if err != nil || !bytes.Equal(data, payload) {
		t.Fatal("fetched bytes mismatch")
	}
	// Second call is a cache hit and must not touch the network.
	got2, err := client.EnsureLocal(ctx, "user-9", root, "clip.mp4")
	if err != nil || got2 != got {
		t.Fatalf("cache hit = %q, %v", got2, err)
	}
}

func TestEnsureLocalConcurrentStampede(t *testing.T) {

	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	ctx := context.Background()
	payload := []byte("stampede")
	if err := client.Put(ctx, "user-7/clip.mp4", bytes.NewReader(payload), int64(len(payload)), ""); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	done := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func() {
			_, err := client.EnsureLocal(ctx, "user-7", root, "clip.mp4")
			done <- err
		}()
	}
	for i := 0; i < 8; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
}

func TestPresignGetShape(t *testing.T) {
	client := New(Config{Endpoint: "https://t3.example.dev", Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	signed, err := client.PresignGet("user-1/render_ab12.mp4", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"X-Amz-Algorithm=AWS4-HMAC-SHA256", "X-Amz-Credential=", "X-Amz-Date=", "X-Amz-Expires=3600", "X-Amz-Signature="} {
		if !strings.Contains(signed, want) {
			t.Fatalf("presigned url missing %q: %s", want, signed)
		}
	}
	signature := signed[strings.LastIndex(signed, "=")+1:]
	if len(signature) != 64 {
		t.Fatalf("signature length = %d, want 64", len(signature))
	}
}
func TestSigV4PathEncodingIsStrict(t *testing.T) {
	// Regression: url.PathEscape leaves "+" and "=" literal while S3
	// canonicalizes them as %2B/%3D — every such key 403'd. Only unreserved
	// [A-Za-z0-9-_.~] may stay literal.
	for _, test := range []struct{ in, want string }{
		{"abcXYZ0189-_.~", "abcXYZ0189-_.~"},
		{"clip test.mp4", "clip%20test.mp4"},
		{"100%.mp4", "100%25.mp4"},
		{"a+b=c.mp4", "a%2Bb%3Dc.mp4"},
		{"clip (1).mp4", "clip%20%281%29.mp4"},
		{"star*name.mp4", "star%2Aname.mp4"},
		{"a&b#tag.mp4", "a%26b%23tag.mp4"},
		{"\u0219edin\u021ba.mp4", "%C8%99edin%C8%9Ba.mp4"},
		{"a/b", "a%2Fb"},
	} {
		if got := encodeSegment(test.in); got != test.want {
			t.Fatalf("encodeSegment(%q) = %q, want %q", test.in, got, test.want)
		}
	}
	for _, test := range []struct{ in, want string }{
		{"a b", "a%20b"},
		{"a+b", "a%2Bb"},
		{"~tilde", "~tilde"},
		{"*(1)", "%2A%281%29"},
		{"a=b&c", "a%3Db%26c"},
	} {
		if got := rfc3986(test.in); got != test.want {
			t.Fatalf("rfc3986(%q) = %q, want %q", test.in, got, test.want)
		}
	}
	if got := escapeKey("user-1/a+b.mp4"); got != "user-1/a%2Bb.mp4" {
		t.Fatalf("escapeKey keeps / separators: %q", got)
	}
}

func TestConfigFromEnvDisabled(t *testing.T) {
	t.Setenv("S3_ENDPOINT", "")
	t.Setenv("S3_BUCKET", "")
	if FromEnv().Enabled() {
		t.Fatal("empty env should disable S3")
	}
	if Key("user-1", "clip.mp4") != "user-1/clip.mp4" {
		t.Fatal("bad object key")
	}
	if RenderKey("user-1", "render_ab.mp4") != "user-1/renders/render_ab.mp4" {
		t.Fatal("bad render key")
	}
}

func TestPutStreamsSeekableBodies(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	ctx := context.Background()
	// *os.File exercises the streaming fast path (hash + rewind, no full
	// in-RAM copy). bytes.Reader is also a ReadSeeker.
	path := filepath.Join(t.TempDir(), "big.bin")
	payload := bytes.Repeat([]byte("0123456789abcdef"), 64<<10)
	if err := os.WriteFile(path, payload, 0600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, _ := file.Stat()
	if err := client.Put(ctx, "user-1/big.bin", file, info.Size(), ""); err != nil {
		t.Fatal(err)
	}
	body, size, _, err := client.Get(ctx, "user-1/big.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	data, _ := io.ReadAll(body)
	if !bytes.Equal(data, payload) || size != int64(len(payload)) {
		t.Fatal("streamed upload round trip mismatch")
	}
	// Non-seekable readers keep working through the buffering path.
	if err := client.Put(ctx, "user-1/small.bin", struct{ io.Reader }{bytes.NewReader([]byte("xyz"))}, 3, ""); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureLocalRejectsTraversal(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	ctx := context.Background()
	root := t.TempDir()
	for _, name := range []string{"../evil.mp4", "a/b.mp4", ".hidden.mp4", "", "ok.mp4\x00"} {
		if _, err := client.EnsureLocal(ctx, "user-1", root, name); err == nil {
			t.Fatalf("EnsureLocal(%q) accepted a malicious name", name)
		}
	}
}

func TestFetchToLocalEnforcesCap(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	ctx := context.Background()
	oldCap := maxFetchBytes
	maxFetchBytes = 16
	defer func() { maxFetchBytes = oldCap }()
	payload := bytes.Repeat([]byte("x"), 32)
	if err := client.Put(ctx, "user-1/huge.mp4", bytes.NewReader(payload), int64(len(payload)), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := client.EnsureLocal(ctx, "user-1", t.TempDir(), "huge.mp4"); err == nil {
		t.Fatal("oversized fetch was not rejected")
	}
}

func TestEnsureRenderLocalHydratesRendersPrefix(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	ctx := context.Background()
	payload := []byte("final export")
	if err := client.Put(ctx, RenderKey("user-1", "render_abc123.mp4"), bytes.NewReader(payload), int64(len(payload)), ""); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	got, err := client.EnsureRenderLocal(ctx, "user-1", root, "render_abc123.mp4")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(got)
	if err != nil || !bytes.Equal(data, payload) {
		t.Fatal("render fetch bytes mismatch")
	}
}

func TestEnsureSessionFileFallsBackToRenders(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, Region: "auto", Bucket: "b", AccessKey: "k", SecretKey: "s"})
	ctx := context.Background()
	payload := []byte("evicted render")
	if err := client.Put(ctx, RenderKey("user-2", "render_def456.mp4"), bytes.NewReader(payload), int64(len(payload)), ""); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	// No top-level object exists; only the renders/ copy remains after GC eviction.
	got, err := client.EnsureSessionFile(ctx, "user-2", root, "render_def456.mp4")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(got)
	if err != nil || !bytes.Equal(data, payload) {
		t.Fatal("session file fallback bytes mismatch")
	}
	// Sources still resolve via the top-level key.
	src := []byte("source")
	if err := client.Put(ctx, Key("user-2", "clip.mp4"), bytes.NewReader(src), int64(len(src)), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := client.EnsureSessionFile(ctx, "user-2", root, "clip.mp4"); err != nil {
		t.Fatal(err)
	}
}
