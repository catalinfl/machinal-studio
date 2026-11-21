package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"math"
	"strconv"
	"strings"
	"time"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/mediacache"
	"github.com/gofiber/fiber/v2"
)

const MaxRenderSamples = 4
const maxAudioInspectionSeconds = 120

type RenderSamples struct {
	Times        []float64 `json:"times,omitempty" jsonschema:"Up to four explicit sample timestamps in final video seconds"`
	AudioStart   float64   `json:"audioStart,omitempty"`
	AudioSeconds float64   `json:"audioSeconds,omitempty" jsonschema:"Measure the mixed audio in this window (up to 120 seconds); zero skips audio"`
}

func (r RenderSamples) Validate() error {
	if len(r.Times) > MaxRenderSamples || len(r.Times) == 0 && r.AudioSeconds == 0 || !sampleTime(r.AudioStart) || !sampleTime(r.AudioSeconds) || r.AudioSeconds > maxAudioInspectionSeconds || r.AudioSeconds == 0 && r.AudioStart != 0 {
		return errors.New("Request 1–4 frame times and/or a mixed audio window of at most 120 seconds.")
	}
	for _, t := range r.Times {
		if !sampleTime(t) {
			return errors.New("Frame times must be finite and nonnegative.")
		}
	}
	return nil
}
func sampleTime(t float64) bool { return t >= 0 && t <= document.MaxTime.Seconds() }

func InspectRender(c *fiber.Ctx, name string) error {
	var r RenderSamples
	if !strings.HasSuffix(strings.ToLower(name), ".mp4") {
		return fiber.ErrUnsupportedMediaType
	}
	if len(c.Body()) > 2048 || document.DecodeJSON(c.Body(), &r) != nil || r.Validate() != nil {
		return fiber.ErrBadRequest
	}
	root, session := SessionRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	ctx, cancel := context.WithTimeout(c.UserContext(), 45*time.Second)
	defer cancel()
	c.SetUserContext(ctx)
	source, err := ResolveSessionSource(c, root, session, name)
	if err != nil {
		return AssetError(c, err)
	}
	meta, err := probeRenderOutput(ctx, source)
	if err != nil {
		return AssetError(c, err)
	}
	if r.AudioSeconds > 0 && r.AudioStart+r.AudioSeconds > meta.Duration {
		return fiber.NewError(422, "Audio window exceeds render duration.")
	}
	for _, t := range r.Times {
		if t >= meta.Duration {
			return fiber.NewError(422, "Frame time is outside the render.")
		}
	}
	frames := make([]fiber.Map, 0, len(r.Times))
	for _, t := range r.Times {
		args := renderSampleArgs(source, t)
		args = append(args, "-map", "0:V:0", "-frames:v", "1", "-vf", thumbnailFilter, "-threads", "1", "-c:v", "mjpeg", "-f", "image2pipe", "pipe:1")
		data, err := mediacache.Run(ctx, "ffmpeg", args...)
		if err != nil {
			return AssetError(c, err)
		}
		if _, err := jpeg.DecodeConfig(bytes.NewReader(data)); err != nil || len(data) > maxLocalThumbnailBytes {
			return fiber.NewError(422, "No bounded video frame at this time.")
		}
		frames = append(frames, fiber.Map{"time": t, "mimeType": "image/jpeg", "data": data})
	}
	audio := fiber.Map{"status": "not_requested"}
	if r.AudioSeconds > 0 {
		audio = fiber.Map{"status": "no_audio_stream"}
		if meta.AudioCodec != "" {
			args := renderSampleArgs(source, r.AudioStart)
			// Trim before loudnorm so its input statistics only cover the requested window.
			filter := "atrim=duration=" + strconv.FormatFloat(r.AudioSeconds, 'f', 6, 64) + ",loudnorm=print_format=json"
			args = append(args, "-map", "0:a:0", "-vn", "-t", strconv.FormatFloat(r.AudioSeconds, 'f', 6, 64), "-af", filter, "-f", "null", "-")
			report, err := mediacache.RunDiagnostics(ctx, args...)
			if err != nil {
				return AssetError(c, err)
			}
			audio, err = parseMixReport(report)
			if err != nil {
				return fiber.NewError(422, "Mixed audio measurement unavailable.")
			}
			audio["start"], audio["duration"] = r.AudioStart, r.AudioSeconds
		}
	}
	c.Set("Cache-Control", "no-store")
	return c.JSON(fiber.Map{"file": name, "frames": frames, "audio": audio, "credits": 0})
}

func renderSampleArgs(source mediacache.Source, t float64) []string {
	input, options := previewInput(source)
	args := []string{"-nostdin", "-hide_banner", "-nostats", "-threads", "1", "-filter_threads", "1", "-ss", strconv.FormatFloat(t, 'f', 6, 64), "-f", "mov"}
	return append(append(args, options...), "-i", input)
}

func probeRenderOutput(ctx context.Context, source mediacache.Source) (Metadata, error) {
	input, options := previewInput(source)
	args := append([]string{"-v", "error", "-f", "mov"}, options...)
	args = append(args, "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height,pix_fmt,duration", "-of", "json", input)
	data, err := mediacache.Run(ctx, "ffprobe", args...)
	if err != nil {
		return Metadata{}, err
	}
	return parseMetadata(data, false)
}

func parseMixReport(report []byte) (fiber.Map, error) {
	start, end := bytes.LastIndexByte(report, '{'), bytes.LastIndexByte(report, '}')
	var fields map[string]string
	if start < 0 || end < start || json.Unmarshal(report[start:end+1], &fields) != nil {
		return nil, errors.New("no loudnorm report")
	}
	audio := fiber.Map{"status": "measured", "scope": "mixed_audio_window"}
	for key, out := range map[string]string{"input_i": "integratedLUFS", "input_tp": "truePeakDBTP"} {
		value, err := strconv.ParseFloat(fields[key], 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 1) {
			return nil, fmt.Errorf("invalid %s", key)
		}
		if math.IsInf(value, -1) {
			audio[out] = nil
		} else {
			audio[out] = value
		}
		if key == "input_tp" {
			audio["clippingRisk"] = value >= 0
		}
	}
	return audio, nil
}
