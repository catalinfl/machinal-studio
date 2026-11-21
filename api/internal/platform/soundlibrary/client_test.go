package soundlibrary

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"testing"
	"time"
)

const testID = "3849018d-0ac8-4f6b-b44d-5ec26a4b32af"

type doerFunc func(*http.Request) (*http.Response, error)

func (f doerFunc) Do(r *http.Request) (*http.Response, error) { return f(r) }

func sampleSound() openverseSound {
	return openverseSound{ID: testID, Title: "Mouse click", Creator: "Creator", LandingURL: "https://freesound.org/people/test/sounds/1/", URL: "https://cdn.freesound.org/previews/1/1-hq.mp3", License: "cc0", LicenseVersion: "1.0", LicenseURL: "https://creativecommons.org/publicdomain/zero/1.0/", Provider: "freesound", Filetype: "mp3", Duration: 2310}
}

func jsonResponse(t *testing.T, value any) *http.Response {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Response{StatusCode: 200, Header: make(http.Header), ContentLength: int64(len(data)), Body: io.NopCloser(bytes.NewReader(data))}
}

func TestSearchUsesFixedOriginDefaultsCacheAndSeconds(t *testing.T) {
	calls := 0
	client := New(doerFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.Host != "api.openverse.org" || req.URL.Query().Get("license") != "cc0" || req.Header.Get("Authorization") != "" || req.URL.Query().Get("q") != "dry click & latch" {
			t.Fatal("unsafe search request", req.URL, req.Header)
		}
		return jsonResponse(t, map[string]any{"results": []openverseSound{sampleSound()}, "page_count": 2}), nil
	}))
	for index := 0; index < 2; index++ {
		result, err := client.Search(context.Background(), Search{Query: "dry click & latch"})
		if err != nil || len(result.Sounds) != 1 {
			t.Fatal(result, err)
		}
		sound := result.Sounds[0]
		if sound.Duration != 2.31 || !sound.Importable || sound.Attribution == "" || !strings.HasPrefix(sound.SourceVersion, "sha256:") || result.Downloaded || result.AudioVerified || result.Cached != (index == 1) {
			t.Fatal("invalid metadata", result)
		}
	}
	if calls != 1 {
		t.Fatal("search was not cached", calls)
	}
	client.now = func() time.Time { return time.Now().Add(cacheLifetime * 2) }
	if _, err := client.Search(context.Background(), Search{Query: "dry click & latch"}); err != nil || calls != 2 {
		t.Fatal("expired cache not refreshed", err, calls)
	}
}

func TestMetadataAndSelectionFailClosed(t *testing.T) {
	for _, mutate := range []func(*openverseSound){
		func(s *openverseSound) { s.License = "by-nc" }, func(s *openverseSound) { s.License = "by-nd" },
		func(s *openverseSound) { s.ID = "../escape" }, func(s *openverseSound) { s.Mature = true },
		func(s *openverseSound) { s.Duration = -1 }, func(s *openverseSound) { s.LicenseURL = "http://example.test" },
		func(s *openverseSound) { s.LicenseURL = "https://example.test/fake-license" }, func(s *openverseSound) { s.LicenseVersion = "4.0" },
	} {
		item := sampleSound()
		mutate(&item)
		if _, err := item.sound(); err == nil {
			t.Fatal("accepted invalid metadata", item)
		}
	}
	item := sampleSound()
	before, _ := item.sound()
	item.Creator = "Changed creator"
	after, _ := item.sound()
	if before.SourceVersion == after.SourceVersion {
		t.Fatal("attribution revision did not change version")
	}
	item.License, item.LicenseVersion, item.LicenseURL = "by", "4.0", "https://creativecommons.org/licenses/by/4.0/"
	if sound, err := item.sound(); err != nil || sound.License != "by" || sound.Attribution == "" {
		t.Fatal("valid CC BY rejected", sound, err)
	}
	for _, input := range []Search{{}, {Query: "click", License: "by-sa"}, {Query: "click", Page: 21}, {Query: "click", Limit: 21}, {Query: strings.Repeat("x", 161)}} {
		if _, err := input.Normalize(); err == nil {
			t.Fatal("accepted invalid query", input)
		}
	}
}

func TestDownloadOnlyAllowsDirectBoundedAudioWithoutCredentialForwarding(t *testing.T) {
	sound, _ := sampleSound().sound()
	payload := "ID3audiofixture!"
	client := New(doerFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "cdn.freesound.org" || req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
			t.Fatal(req.URL, req.Header)
		}
		return &http.Response{StatusCode: 200, ContentLength: int64(len(payload)), Body: io.NopCloser(strings.NewReader(payload))}, nil
	}))
	if body, err := client.Download(context.Background(), sound); err != nil || len(body) != len(payload) {
		t.Fatal(body, err)
	}
	for _, address := range []string{"http://cdn.freesound.org/previews/x.mp3", "https://127.0.0.1/x.mp3", "https://cdn.freesound.org.evil.test/previews/x.mp3", "https://cdn.freesound.org:444/previews/x.mp3", "https://cdn.freesound.org/previews/x.mp3?token=secret", "https://user:pass@cdn.freesound.org/previews/x.mp3", "https://cdn.freesound.org/previews/x.m3u8"} {
		sound.URL = address
		if _, err := client.Download(context.Background(), sound); err == nil {
			t.Fatal("accepted unsafe preview", address)
		}
	}
	for _, payload := range []string{"<html>bad</html>", "#EXTM3U\nhttps://internal/", "", "short"} {
		if audioSignature([]byte(payload), "mp3") {
			t.Fatal("accepted non-audio bytes")
		}
	}
}

func TestNetworkErrorsAreBoundedSanitizedAndRetryableWithoutReplay(t *testing.T) {
	for _, status := range []int{302, 401, 429, 503} {
		client := New(doerFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Header: http.Header{"Retry-After": []string{"60"}}, Body: io.NopCloser(strings.NewReader("secret provider details"))}, nil
		}))
		_, err := client.Lookup(context.Background(), testID)
		var failure *Failure
		if !errors.As(err, &failure) || strings.Contains(err.Error(), "secret") || failure.RetryAfter != "60" {
			t.Fatal(err)
		}
		if status == 429 && failure.Status != 429 || status != 429 && failure.Status != 502 {
			t.Fatal(failure)
		}
	}
	client := New(doerFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, ContentLength: maxMetadataBytes + 1, Body: io.NopCloser(strings.NewReader("{}"))}, nil
	}))
	if _, err := client.Lookup(context.Background(), testID); err == nil {
		t.Fatal("accepted oversized response")
	}
	client.http = doerFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, ContentLength: 500, Body: io.NopCloser(strings.NewReader("{}"))}, nil
	})
	if _, err := client.Lookup(context.Background(), testID); err == nil {
		t.Fatal("accepted truncated response")
	}
}

func TestTransportRejectsPrivateAndSpecialNetworksAndRedirects(t *testing.T) {
	for _, value := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.2.4", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "64:ff9b::7f00:1", "2002:7f00:1::"} {
		if publicIP(netip.MustParseAddr(value)) {
			t.Fatal("accepted private/special IP", value)
		}
	}
	if !publicIP(netip.MustParseAddr("1.1.1.1")) {
		t.Fatal("rejected public IP")
	}
	client := NewHTTPClient()
	if client.Timeout <= 0 || client.Transport.(*http.Transport).Proxy != nil || client.CheckRedirect(&http.Request{}, nil) == nil {
		t.Fatal("unsafe HTTP transport")
	}
	for _, address := range []string{"127.0.0.1:443", "api.openverse.org:80", "evil.test:443"} {
		if _, err := dialPublicLibrary(context.Background(), "tcp", address); err == nil {
			t.Fatal("accepted destination", address)
		}
	}
}

func TestDialPinsCheckedPublicIPAndRejectsMixedDNSAnswersBeforeConnection(t *testing.T) {
	connections := 0
	lookup := func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("1.1.1.1"), netip.MustParseAddr("127.0.0.1")}, nil
	}
	connect := func(context.Context, string, string) (net.Conn, error) {
		connections++
		return nil, errors.New("not connected")
	}
	if _, err := libraryDialer(lookup, connect)(context.Background(), "tcp", "api.openverse.org:443"); err == nil || connections != 0 {
		t.Fatal("mixed private/public DNS reached network", err, connections)
	}
	lookup = func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("1.1.1.1"), netip.MustParseAddr("8.8.8.8")}, nil
	}
	var addresses []string
	connect = func(_ context.Context, _ string, address string) (net.Conn, error) {
		addresses = append(addresses, address)
		return nil, errors.New("not connected")
	}
	if _, err := libraryDialer(lookup, connect)(context.Background(), "tcp", "cdn.freesound.org:443"); err == nil || len(addresses) != 2 || addresses[0] != "1.1.1.1:443" || addresses[1] != "8.8.8.8:443" {
		t.Fatal("did not pin checked IPs", addresses, err)
	}
}
