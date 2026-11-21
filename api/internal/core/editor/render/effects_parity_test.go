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

const (
	parityFrameBytes = 160 * 90 * 3
	parityFPS        = 12
	paritySource     = "nullsrc=size=160x90:rate=12,geq=lum='if(lt(mod(X+Y,16),8),32,224)':cb=128:cr=128"
)

func nativeParityFrames(t *testing.T, preset effect, frames int) []byte {
	t.Helper()
	graph, err := buildFilterForDuration([]effect{preset}, 1)
	if err != nil {
		t.Fatalf("build %s: %v", preset.ID, err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", "-v", "error", "-nostdin",
		"-f", "lavfi", "-i", paritySource, "-filter_complex_threads", "1",
		"-filter_complex", "[0:v]"+graph+"[out]", "-map", "[out]",
		"-frames:v", strconv.Itoa(frames), "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	pixels, err := cmd.Output()
	if err != nil {
		t.Fatalf("render %s: %v: %s", preset.ID, err, &stderr)
	}
	if len(pixels) != frames*parityFrameBytes {
		t.Fatalf("%s: got %d bytes, want %d", preset.ID, len(pixels), frames*parityFrameBytes)
	}
	return pixels
}

func TestFFmpegParityRegressions(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 to validate native parity regressions")
	}
	for _, id := range []string{"camera-shake", "gate-weave", "bad-tv"} {
		for _, mode := range []string{"in", "out", "in-out"} {
			t.Run(id+"/"+mode, func(t *testing.T) {
				nativeParityFrames(t, effect{ID: id, Ramp: &ramp{Mode: mode, Curve: "linear", Amount: 0.5, BlockDuration: 1}}, parityFPS)
			})
		}
	}
}

func TestFFmpegGaussianRampAxes(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 to validate native Gaussian ramps")
	}
	cases := []struct {
		name   string
		ramp   ramp
		sigmas [3]float64
	}{
		{"in", ramp{Mode: "in", Curve: "linear", Amount: 1, BlockDuration: 1}, [3]float64{1.5, 3, 4.5}},
		{"out", ramp{Mode: "out", Curve: "linear", Amount: 1, BlockDuration: 1}, [3]float64{4.5, 3, 1.5}},
		{"in-out", ramp{Mode: "in-out", Curve: "linear", Amount: 0.5, BlockDuration: 1}, [3]float64{3, 6, 3}},
		{"offset", ramp{Mode: "in", Curve: "linear", Amount: 1, BlockDuration: 2, Offset: 1}, [3]float64{3.75, 4.5, 5.25}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			animated := nativeParityFrames(t, effect{ID: "gaussian-blur", Ramp: &testCase.ramp}, parityFPS)
			for index, frame := range []int{3, 6, 9} {
				sigma := testCase.sigmas[index]
				constant := nativeParityFrames(t, effect{ID: "gaussian-blur", Params: map[string]float64{"sigma": sigma}}, 1)
				var errorSum float64
				for pixelIndex, pixel := range constant {
					errorSum += math.Abs(float64(animated[frame*parityFrameBytes+pixelIndex]) - float64(pixel))
				}
				if mae := errorSum / parityFrameBytes; mae > 1 {
					t.Fatalf("frame %d: animated sigma %.2f differs from static blur, MAE %.2f", frame, sigma, mae)
				}
			}
		})
	}
}
