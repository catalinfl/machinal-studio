package media

import (
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/mediacache"
	"github.com/gofiber/fiber/v2"
)

func TestWaveformCacheReusesConcurrentRequestsAndInvalidatesChangedSources(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audio.wav")
	if err := os.WriteFile(path, []byte("synthetic audio"), 0600); err != nil {
		t.Fatal(err)
	}
	cache := &mediacache.Cache{}
	var calls atomic.Int32
	decode := func(ctx context.Context, source string) (waveformResponse, error) {
		calls.Add(1)
		return waveformResponse{SampleRate: waveformSampleRate, BinSamples: waveformBinSamples, Length: 2, Min: []float32{-0.5}, Max: []float32{0.7}}, nil
	}
	app := fiber.New()
	app.Get("/waveform", func(c *fiber.Ctx) error {
		source, err := mediacache.ReadSource(path)
		if err != nil {
			return err
		}
		return serveWaveform(c, source, cache, decode)
	})
	var wait sync.WaitGroup
	for range 12 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			response, err := app.Test(httptest.NewRequest("GET", "/waveform", nil), 5000)
			if err != nil {
				t.Error(err)
				return
			}
			defer response.Body.Close()
			var value waveformResponse
			if response.StatusCode != 200 || json.NewDecoder(response.Body).Decode(&value) != nil || value.Length != 2 {
				t.Error("invalid cached waveform response", response.StatusCode)
			}
		}()
	}
	wait.Wait()
	if calls.Load() != 1 {
		t.Fatalf("identical requests decoded %d times", calls.Load())
	}
	response, err := app.Test(httptest.NewRequest("GET", "/waveform", nil))
	if err != nil {
		t.Fatal(err)
	}
	etag := response.Header.Get("ETag")
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	request := httptest.NewRequest("GET", "/waveform", nil)
	request.Header.Set("If-None-Match", etag)
	response, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 304 || calls.Load() != 1 {
		t.Fatal("unchanged waveform did not revalidate", response.StatusCode)
	}
	changed := time.Now().Add(time.Second)
	if err := os.Chtimes(path, changed, changed); err != nil {
		t.Fatal(err)
	}
	response, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || calls.Load() != 2 || response.Header.Get("ETag") == etag {
		t.Fatal("changed source reused stale waveform")
	}
}

func TestWaveformCacheRejectsCorruption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "waveform.json")
	for _, data := range []string{
		`{"sampleRate":8000,"binSamples":400,"length":1,"min":[],"max":[]}`,
		`{"sampleRate":8000,"binSamples":400,"length":1,"min":[1],"max":[0]}`,
		`{"sampleRate":8000,"binSamples":400,"length":1,"min":[0],"max":[1]}{}`,
	} {
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if validateWaveform(path) == nil {
			t.Fatal("invalid cached waveform accepted", data)
		}
	}
}
