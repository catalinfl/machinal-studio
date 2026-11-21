package render

import (
	"context"
	"fmt"
	"log"
	"math"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"ffmpeg-go-server/internal/core/editor/scenes"
)

// maxTimestampGapSeconds caps the tolerance for timestamp holes: legitimate
// footage — even low-fps screen recordings — never has consecutive-frame gaps
// anywhere near half a second, so anything above it is unambiguously
// pathological. Smaller windows scale the tolerance down so a mostly-missing
// short clip is caught too.
const maxTimestampGapSeconds = 0.5

// probeTimeout bounds the showinfo decode: a clip window is seconds long, so
// two minutes is generous even on cold storage without stalling the export.
const probeTimeout = 2 * time.Minute

// probeErrorLines keeps only the head of ffmpeg output; the cause is almost
// always in the first lines and full logs would bloat the render error.
const probeErrorLines = 3

// coverageTolerance returns the largest tolerated timestamp hole for a window
// of the given source duration.
func coverageTolerance(window float64) float64 {
	return math.Min(maxTimestampGapSeconds, math.Max(0.1, 0.25*window))
}

var showinfoPtsPattern = regexp.MustCompile(`pts_time:([0-9]+(?:\.[0-9]+)?)`)

// parseShowinfoTimestamps extracts presentation timestamps from
// `ffmpeg -vf showinfo` log output. Frames with unknown timestamps (N/A) are
// skipped; an empty result means "cannot assess", never "healthy".
func parseShowinfoTimestamps(output string) []float64 {
	var times []float64
	for _, match := range showinfoPtsPattern.FindAllStringSubmatch(output, -1) {
		value, err := strconv.ParseFloat(match[1], 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		times = append(times, value)
	}
	return times
}

// maxTimestampGap returns the largest jump between consecutive frame
// timestamps and where it starts. It reports 0 when there is nothing usable
// to compare; coverage edges are assessed separately.
func maxTimestampGap(times []float64) (gap, at float64) {
	if len(times) < 2 {
		return 0, 0
	}
	ordered := append([]float64(nil), times...)
	sort.Float64s(ordered)
	for i := 1; i < len(ordered); i++ {
		if delta := ordered[i] - ordered[i-1]; delta > gap {
			gap, at = delta, ordered[i-1]
		}
	}
	return gap, at
}

// assessTimestampCoverage checks the frames FFmpeg actually delivers for a
// clip window against the requested [windowStart, windowEnd] range. Besides
// holes between consecutive frames it also catches shortfalls at the edges:
// input-side -t truncation hides a trailing gap from consecutive-diff logic
// (the probe simply yields no frames past the gap), yet the renderer would
// still pad the tail with frozen frames. It returns "" when healthy or when
// there is too little data to judge (fail-open); otherwise a human-readable
// problem description.
//
// FFmpeg input seeking (`-ss` before `-i`, the same path the segment
// renderer uses) resets presentation timestamps to start near zero, so the
// probe usually returns 0-based times for an absolute source window such as
// [3.075,6.475]. Comparing those directly against the absolute window would
// report a phantom ~windowStart trailing shortfall on every healthy trimmed
// clip. When the probe starts near zero while the window starts far from it,
// the window is therefore realigned to [0, duration] before the edge checks;
// gap sizes are translation-invariant so they are unaffected. Timestamps
// that already start near the window are assessed absolutely, preserving the
// true-truncation signal in both modes.
func assessTimestampCoverage(times []float64, windowStart, windowEnd float64) string {
	window := windowEnd - windowStart
	if !(window > 0) {
		return ""
	}
	tolerance := coverageTolerance(window)
	if len(times) < 2 {
		if window > tolerance {
			return fmt.Sprintf("only %d frame(s) decoded in a %ss window", len(times), ff(window))
		}
		return ""
	}
	ordered := append([]float64(nil), times...)
	sort.Float64s(ordered)
	// Realign a 0-based probe to the absolute window. Only shift when the
	// probe clearly starts at zero and the window clearly does not; an
	// actually-truncated absolute probe (first frame near windowStart but a
	// short tail) must keep its absolute positions so the shortfall still
	// reports.
	offset := 0.0
	if math.Abs(ordered[0]) <= tolerance && math.Abs(ordered[0]-windowStart) > tolerance {
		offset = windowStart
	}
	aligned := make([]float64, len(ordered))
	for i, value := range ordered {
		aligned[i] = value + offset
	}
	var problems []string
	if leading := aligned[0] - windowStart; leading > tolerance {
		problems = append(problems, fmt.Sprintf("frames start at %s, %ss into the window", ff(aligned[0]), ff(leading)))
	}
	if trailing := windowEnd - aligned[len(aligned)-1]; trailing > tolerance {
		problems = append(problems, fmt.Sprintf("frames stop at %s, %ss before the window end", ff(aligned[len(aligned)-1]), ff(trailing)))
	}
	if gap, at := maxTimestampGap(aligned); gap > tolerance {
		problems = append(problems, fmt.Sprintf("%ss gap in frame timestamps around %s", ff(gap), ff(at)))
	}
	return strings.Join(problems, "; ")
}

// probeFrameTimestamps decodes the clip window [start, start+duration] and
// returns the presentation timestamps of the frames FFmpeg actually delivers
// for it — the same seeking path the segment renderer uses, so gaps found
// here are gaps the render would hit. A probe failure is returned as an
// error; callers fail open (log and continue) because an unreadable probe
// must not block files the renderer itself might still handle.
func probeFrameTimestamps(path string, start, duration float64) ([]float64, error) {
	if duration <= 0 {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-hide_banner", "-loglevel", "info",
		"-protocol_whitelist", "file,pipe",
		"-ss", ff(math.Max(0, start)), "-t", ff(duration),
		"-threads", "2",
		"-i", path,
		"-an", "-sn", "-dn", "-vf", "showinfo=checksum=0", "-fps_mode", "passthrough", "-f", "null", "-",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("timestamp probe: %w: %s", err, firstLines(string(output), probeErrorLines))
	}
	return parseShowinfoTimestamps(string(output)), nil
}

func firstLines(output string, count int) string {
	lines := strings.Split(output, "\n")
	if len(lines) > count {
		lines = lines[:count]
	}
	return strings.Join(lines, "\n")
}

// timestampGapError builds the actionable render error for a gappy source.
func timestampGapError(file, problem string, windowStart, windowEnd float64) error {
	return fmt.Errorf(
		"source %q cannot be rendered faithfully over [%s,%s]: %s — "+
			"the export would freeze on a stale frame there instead of failing. "+
			"Re-encode to constant frame rate and re-import: ffmpeg -i %q -vsync cfr -r 30 -c:a copy %q",
		file, ff(windowStart), ff(windowEnd), problem,
		file, "fixed-"+file,
	)
}

// validateClipTimestamps rejects video clips whose rendered window contains a
// timestamp gap large enough to freeze segment tails (see
// maxTimestampGapSeconds). Images are looped stills, not timestamped video,
// and audio follows a different pipeline, so both are skipped. Probe failures
// fail open with a log line: the renderer will surface its own error if the
// file is truly unreadable.
func validateClipTimestamps(clips []clip, scope fileScope) error {
	return validateTimestampWindows(clips, scope, probeFrameTimestamps)
}

type timestampWindow struct {
	file       string
	start, end float64
}

func validateTimestampWindows(clips []clip, scope fileScope, probe func(string, float64, float64) ([]float64, error)) error {
	checked := make(map[timestampWindow]bool)
	for index, movingClip := range clips {
		if movingClip.MediaKind == "image" || movingClip.MediaKind == "audio" || scenes.IsSource(movingClip.File) {
			continue
		}
		window := movingClip.OutPoint - movingClip.InPoint
		if !(window > 0) {
			continue
		}
		key := timestampWindow{movingClip.File, movingClip.InPoint, movingClip.OutPoint}
		if checked[key] {
			continue
		}
		// The payload carries the bare file name; the media lives under the
		// session volume (same resolution validateReferencedFiles uses).
		// Probing the unresolved name would fail open on every render.
		path, err := scope.join(movingClip.File)
		if err != nil {
			log.Printf("render timestamp check skipped for clip %d (%s): %v", index, movingClip.File, err)
			continue
		}
		times, err := probe(path, movingClip.InPoint, window)
		if err != nil {
			log.Printf("render timestamp check skipped for clip %d (%s): %v", index, movingClip.File, err)
			continue
		}
		if problem := assessTimestampCoverage(times, movingClip.InPoint, movingClip.OutPoint); problem != "" {
			return timestampGapError(movingClip.File, problem, movingClip.InPoint, movingClip.OutPoint)
		}
		checked[key] = true
	}
	return nil
}
