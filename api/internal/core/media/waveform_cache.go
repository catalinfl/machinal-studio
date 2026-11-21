package media

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"time"

	"ffmpeg-go-server/internal/platform/filecache"
	"ffmpeg-go-server/internal/platform/mediacache"
	"github.com/gofiber/fiber/v2"
)

const (
	waveformProfile  = "waveform-v1-8000-400"
	waveformTimeout  = 2 * time.Minute
	maxWaveformBytes = 32 << 20
)

type waveformDecoder func(context.Context, string) (waveformResponse, error)

func serveWaveform(c *fiber.Ctx, source mediacache.Source, cache *mediacache.Cache, decode waveformDecoder) error {
	ctx, cancel := context.WithTimeout(c.UserContext(), waveformTimeout)
	defer cancel()
	path, err := cache.Get(ctx, source, waveformProfile, "waveform.json", func(path string) error {
		value, err := decode(ctx, source.Path)
		if err != nil {
			return err
		}
		return writeWaveform(path, value)
	}, validateWaveform)
	if err != nil {
		return AssetError(c, err)
	}
	if AssetNotModified(c, source, waveformProfile) {
		return c.Send(nil)
	}
	return SendAsset(c, path, fiber.MIMEApplicationJSONCharsetUTF8)
}

func writeWaveform(path string, value waveformResponse) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("open waveform cache: %w", err)
	}
	defer file.Close()
	if err := json.NewEncoder(file).Encode(value); err != nil {
		return fmt.Errorf("encode waveform cache: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close waveform cache: %w", err)
	}
	return nil
}

func validateWaveform(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	defer filecache.Release(file)
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxWaveformBytes {
		return fmt.Errorf("invalid waveform cache size")
	}
	var value waveformResponse
	decoder := json.NewDecoder(io.LimitReader(file, maxWaveformBytes+1))
	if err := decoder.Decode(&value); err != nil {
		return fmt.Errorf("decode waveform cache: %w", err)
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return fmt.Errorf("unexpected waveform cache data")
	}
	bins := value.Length / waveformBinSamples
	if value.Length%waveformBinSamples != 0 {
		bins++
	}
	if value.SampleRate != waveformSampleRate || value.BinSamples != waveformBinSamples || value.Length < 0 || bins > maxWaveformBins || len(value.Min) != bins || len(value.Max) != bins {
		return fmt.Errorf("invalid waveform cache shape")
	}
	for index, low := range value.Min {
		high := value.Max[index]
		if math.IsNaN(float64(low)) || math.IsInf(float64(low), 0) || math.IsNaN(float64(high)) || math.IsInf(float64(high), 0) || low > high {
			return fmt.Errorf("invalid waveform cache amplitude")
		}
	}
	return nil
}
