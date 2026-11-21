package render

import (
	"bytes"
	"context"
	"math"
	"os"
	"os/exec"
	"strconv"
	"testing"
	"time"
)

func TestFFmpegIntensityRampClockIntegration(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 to validate intensity ramp pixels with native FFmpeg")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Fatal("ffmpeg is required for intensity ramp integration tests")
	}

	const (
		frameSize     = 64 * 64 * 3
		fps           = 40
		blockDuration = 10.21678
		cut           = 4.275
	)
	// Static stripes make blur strength measurable without motion or lossy encoding.
	const source = "nullsrc=size=64x64:rate=40,geq=lum='if(lt(mod(X,16),8),32,224)':cb=128:cr=128"
	render := func(t *testing.T, filter, timeBase string, start float64, frames int) []byte {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		filter = "settb=" + timeBase + ",setpts=PTS+" + ff(start) + "/TB," + filter
		cmd := exec.CommandContext(ctx, "ffmpeg",
			"-hide_banner", "-loglevel", "error", "-nostdin",
			"-f", "lavfi", "-i", source,
			"-filter_complex_threads", "1", "-filter_complex", "[0:v]"+filter+"[out]",
			"-map", "[out]", "-frames:v", strconv.Itoa(frames),
			"-fps_mode", "passthrough", "-threads", "1",
			"-pix_fmt", "gbrp", "-f", "rawvideo", "pipe:1",
		)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		pixels, err := cmd.Output()
		if err != nil {
			t.Fatalf("render ramp pixels: %v: %s\nfilter: %s", err, &stderr, filter)
		}
		if len(pixels) != frames*frameSize {
			t.Fatalf("output size = %d bytes, want %d (%d frames)", len(pixels), frames*frameSize, frames)
		}
		return pixels
	}

	for _, preset := range []effect{
		{ID: "directional-blur", Params: map[string]float64{"angle": 0, "radius": 8}},
		{ID: "blur"},
		{ID: "tilt-shift"},
	} {
		t.Run(preset.ID, func(t *testing.T) {
			inner, err := buildEffectFilter(preset)
			if err != nil {
				t.Fatalf("build effect: %v", err)
			}
			original := render(t, wrapIntensityFilter(inner, "0", "r0"), "AVTB", 0, 1)
			full := render(t, wrapIntensityFilter(inner, "1", "r0"), "AVTB", 0, 1)
			pixel, delta := 0, 0.0
			for i := range original {
				difference := float64(full[i]) - float64(original[i])
				if math.Abs(difference) > math.Abs(delta) {
					pixel, delta = i, difference
				}
			}
			if math.Abs(delta) < 32 {
				t.Fatalf("fixture has insufficient effect contrast: pixel delta = %v", delta)
			}

			for _, timeBase := range []string{"1/40", "1/9000000"} {
				t.Run("time_base="+timeBase, func(t *testing.T) {
					var first, second []float64
					for _, segment := range []struct {
						name   string
						offset float64
						start  float64
						frames int
					}{
						{name: "first", frames: int(cut * fps)},
						{name: "second", offset: cut, frames: int(math.Ceil((blockDuration - cut) * fps))},
						{name: "second_nonzero_pts", start: cut, frames: int(math.Ceil((blockDuration - cut) * fps))},
					} {
						t.Run(segment.name, func(t *testing.T) {
							r := ramp{
								Mode: "in-out", Curve: "linear", Amount: 0.5,
								BlockDuration: blockDuration, Offset: segment.offset,
							}
							var filter string
							if preset.ID == "blur" {
								// Retain wrapper coverage for blur, whose builder uses a parameter ramp.
								filter = wrapIntensityFilter(inner, rampIntensityExpr(r), "r0")
							} else {
								ramped := preset
								ramped.Ramp = &r
								var err error
								filter, err = buildFilterForDuration([]effect{ramped}, float64(segment.frames)/fps)
								if err != nil {
									t.Fatalf("build ramped effect: %v", err)
								}
							}
							pixels := render(t, filter, timeBase, segment.start, segment.frames)
							intensities := make([]float64, segment.frames)
							for frame := range intensities {
								blockTime := float64(frame)/fps + segment.start + segment.offset
								wantIntensity := 2 * math.Min(blockTime, blockDuration-blockTime) / blockDuration
								wantPixel := float64(original[pixel]) + delta*wantIntensity
								gotPixel := float64(pixels[frame*frameSize+pixel])
								intensities[frame] = (gotPixel - float64(original[pixel])) / delta
								if math.Abs(gotPixel-wantPixel) > 2 {
									t.Fatalf("frame %d at block time %.3fs: pixel = %.0f, want %.2f; intensity = %.3f, want %.3f",
										frame, blockTime, gotPixel, wantPixel, intensities[frame], wantIntensity)
								}
							}
							switch segment.name {
							case "first":
								first = intensities
							case "second":
								second = intensities
							}
						})
					}
					if first == nil || second == nil {
						return
					}
					if first[3*fps] <= first[fps]+0.3 {
						t.Fatalf("first segment did not ramp up: I(1s) = %.3f, I(3s) = %.3f", first[fps], first[3*fps])
					}
					if math.Abs(second[0]-first[len(first)-1]) > 2/(fps*blockDuration)+4/math.Abs(delta) {
						t.Fatalf("ramp discontinuity at cut: %.3f -> %.3f", first[len(first)-1], second[0])
					}
					peak := int(math.Round((blockDuration/2 - cut) * fps))
					if second[peak] < 0.97 || second[len(second)-1] > 0.03 {
						t.Fatalf("second segment did not peak and fade out: peak = %.3f, end = %.3f", second[peak], second[len(second)-1])
					}
					t.Logf("measured intensity: first 3s=%.3f, cut=%.3f/%.3f, second peak=%.3f, end=%.3f",
						first[3*fps], first[len(first)-1], second[0], second[peak], second[len(second)-1])
				})
			}
		})
	}

	t.Run("soft-focus-constant", func(t *testing.T) {
		// Neutral grading ensures the pixel changes come from sigma, not brightness.
		filter, err := buildFilterForDuration([]effect{{
			ID:     "soft-focus",
			Params: map[string]float64{"sigma": 1.2, "brightness": 0, "saturation": 1},
		}}, 1)
		if err != nil {
			t.Fatalf("build constant soft focus: %v", err)
		}
		original := render(t, "format=gbrp", "1/9000000", 0, 1)
		softened := render(t, filter, "1/9000000", 0, 1)
		const dark, bright = 32*64 + 7, 32*64 + 8
		darkIncrease := int(softened[dark]) - int(original[dark])
		brightDecrease := int(original[bright]) - int(softened[bright])
		if darkIncrease < 10 || brightDecrease < 10 {
			t.Fatalf("soft focus did not soften the stripe edge: dark %d -> %d, bright %d -> %d",
				original[dark], softened[dark], original[bright], softened[bright])
		}
		t.Logf("sigma=1.2 edge pixels: dark %d -> %d, bright %d -> %d",
			original[dark], softened[dark], original[bright], softened[bright])
	})
}
