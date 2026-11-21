package utils

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// microsPerSecond converts ffmpeg out_time_us to seconds for progress ratios.
const microsPerSecond = 1_000_000

// withProtocolWhitelist inserts "-protocol_whitelist file,pipe" before every
// "-i" whose value is an absolute file path. lavfi/anullsrc/color inputs
// (next arg not starting with "/") are left untouched so synthetic sources
// keep working. This blocks playlist-driven SSRF (m3u pointing at IMDS)
// while keeping local-file renders functional.
func withProtocolWhitelist(args []string) []string {
	out := make([]string, 0, len(args)+4)
	for i := 0; i < len(args); i++ {
		if args[i] == "-i" && i+1 < len(args) {
			next := args[i+1]
			prevIsWhitelist := i > 0 && args[i-1] == "file,pipe"
			if len(next) > 0 && next[0] == '/' && !prevIsWhitelist {
				// Check the two previous args aren't already a whitelist.
				hasWhitelist := false
				if i >= 2 && args[i-2] == "-protocol_whitelist" {
					hasWhitelist = true
				}
				if !hasWhitelist {
					out = append(out, "-protocol_whitelist", "file,pipe")
				}
			}
		}
		out = append(out, args[i])
	}
	return out
}

// RunFFmpeg executes FFmpeg and includes its output when the command fails.
func RunFFmpeg(args ...string) error {
	return RunFFmpegContext(context.Background(), args...)
}

// RunFFmpegContext executes FFmpeg with a caller-provided context.
func RunFFmpegContext(ctx context.Context, args ...string) error {
	_, err := RunFFmpegOutputContext(ctx, args...)
	return err
}

// RunFFmpegOutputContext executes FFmpeg and returns its diagnostics. Analysis
// filters emit machine-readable metadata through the same output streams.
func RunFFmpegOutputContext(ctx context.Context, args ...string) (string, error) {
	args = withProtocolWhitelist(args)
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("ffmpeg: %w: %s", err, output)
	}
	return string(output), nil
}

// RunFFmpegProgress executes FFmpeg and reports progress against the expected
// output duration. FFmpeg writes machine-readable timestamps to stdout while
// regular diagnostics remain available for errors on stderr.
func RunFFmpegProgress(ctx context.Context, expectedDuration float64, onProgress func(float64), args ...string) error {
	args = withProtocolWhitelist(args)
	progressArgs := append([]string{"-progress", "pipe:1", "-nostats"}, args...)
	cmd := exec.CommandContext(ctx, "ffmpeg", progressArgs...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("ffmpeg progress pipe: %w", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("ffmpeg start: %w", err)
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if ratio, ok := parseFFmpegProgressLine(scanner.Text(), expectedDuration); ok && onProgress != nil {
			onProgress(ratio)
		}
	}
	scanErr := scanner.Err()
	waitErr := cmd.Wait()
	if waitErr != nil {
		return fmt.Errorf("ffmpeg: %w: %s", waitErr, stderr.String())
	}
	if scanErr != nil {
		return fmt.Errorf("ffmpeg progress: %w", scanErr)
	}
	if onProgress != nil {
		onProgress(1)
	}
	return nil
}

func parseFFmpegProgressLine(line string, expectedDuration float64) (float64, bool) {
	key, value, found := strings.Cut(line, "=")
	if !found {
		return 0, false
	}
	if key == "progress" && value == "end" {
		return 1, true
	}
	if expectedDuration <= 0 || (key != "out_time_us" && key != "out_time_ms") {
		return 0, false
	}
	microseconds, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, false
	}
	ratio := microseconds / microsPerSecond / expectedDuration
	return clampRatio(ratio), true
}

func clampRatio(ratio float64) float64 {
	if ratio < 0 {
		return 0
	}
	if ratio > 1 {
		return 1
	}
	return ratio
}
