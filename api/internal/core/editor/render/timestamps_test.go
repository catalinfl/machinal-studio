package render

import (
	"strings"
	"testing"
)

func TestParseShowinfoTimestampsSkipsUnknown(t *testing.T) {
	output := `[Parsed_showinfo_0 @ 0x1] n:   0 pts:      0 pts_time:0       duration: 3003
[Parsed_showinfo_0 @ 0x1] n:   1 pts:   3003 pts_time:0.0333667   duration: 3003
[Parsed_showinfo_0 @ 0x1] n:   2 pts:      0 pts_time:N/A         duration: 3003
not a timestamp line
[Parsed_showinfo_0 @ 0x1] n:   3 pts:   9009 pts_time:0.1001      duration: 3003`
	got := parseShowinfoTimestamps(output)
	want := []float64{0, 0.0333667, 0.1001}
	if len(got) != len(want) {
		t.Fatalf("parseShowinfoTimestamps = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("parseShowinfoTimestamps = %v, want %v", got, want)
		}
	}
}

func TestMaxTimestampGapFindsJumps(t *testing.T) {
	healthy := []float64{0, 0.033, 0.067, 0.1, 0.133}
	if gap, _ := maxTimestampGap(healthy); gap > 0.05 {
		t.Fatalf("healthy timestamps report gap %v", gap)
	}
	// Decode order is not guaranteed (B-frames); the detector must sort.
	shuffled := []float64{2.4, 0, 10.1, 0.033, 2.366}
	gap, at := maxTimestampGap(shuffled)
	if gap < 7.6 || gap > 7.8 {
		t.Fatalf("gapped timestamps report gap %v, want ~7.7", gap)
	}
	if at < 2.3 || at > 2.4 {
		t.Fatalf("gap location = %v, want ~2.36", at)
	}
	if gap, _ := maxTimestampGap(nil); gap != 0 {
		t.Fatalf("empty timestamps report gap %v, want 0", gap)
	}
	if gap, _ := maxTimestampGap([]float64{1.5}); gap != 0 {
		t.Fatalf("single timestamp reports gap %v, want 0", gap)
	}
}

func TestTimestampGapErrorIsActionable(t *testing.T) {
	err := timestampGapError("clip.mp4", "7.6s gap in frame timestamps around 2.36", 0, 3.875)
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, fragment := range []string{"clip.mp4", "7.6", "ffmpeg", "-vsync cfr"} {
		if !strings.Contains(err.Error(), fragment) {
			t.Errorf("gap error %q does not contain %q", err.Error(), fragment)
		}
	}
}

func TestAssessTimestampCoverage(t *testing.T) {
	healthy := make([]float64, 0, 117)
	for k := 0; k <= 116; k++ {
		healthy = append(healthy, float64(k)/30)
	}
	if problem := assessTimestampCoverage(healthy, 0, 3.875); problem != "" {
		t.Fatalf("healthy window reports %q", problem)
	}
	// Trailing shortfall: -t truncation hides the gap from consecutive-diff
	// logic, but the missing tail is exactly what tpad would freeze on.
	trailing := make([]float64, 0, 71)
	for k := 0; k < 71; k++ {
		trailing = append(trailing, float64(k)/30)
	}
	problem := assessTimestampCoverage(trailing, 0, 3.875)
	if !strings.Contains(problem, "before the window end") {
		t.Fatalf("trailing shortfall reports %q, want a window-end problem", problem)
	}
	leading := []float64{2.0, 2.033, 3.8}
	if problem := assessTimestampCoverage(leading, 0, 3.875); !strings.Contains(problem, "into the window") {
		t.Fatalf("leading shortfall reports %q, want a window-start problem", problem)
	}
	if problem := assessTimestampCoverage(nil, 0, 3.875); !strings.Contains(problem, "only 0 frame") {
		t.Fatalf("empty probe reports %q, want a missing-frames problem", problem)
	}
	if problem := assessTimestampCoverage(nil, 0, 0.05); problem != "" {
		t.Fatalf("tiny window with no frames reports %q, want fail-open", problem)
	}
	if problem := assessTimestampCoverage(healthy, 0, 0); problem != "" {
		t.Fatalf("degenerate window reports %q, want fail-open", problem)
	}
	// Input seeking resets PTS to zero, so a healthy trimmed clip reports
	// 0-based times for an absolute window. [3.075,6.475] with frames
	// 0..~3.39 must be healthy, not a 3s trailing shortfall.
	trimmed := make([]float64, 0, 103)
	for k := 0; k <= 102; k++ {
		trimmed = append(trimmed, float64(k)/30)
	}
	if problem := assessTimestampCoverage(trimmed, 3.075, 6.475); problem != "" {
		t.Fatalf("0-based probe for trimmed window reports %q, want healthy", problem)
	}
	// The same window with only 0..0.32s of frames is genuinely truncated
	// and must still report a window-end shortfall after realignment.
	short := make([]float64, 0, 11)
	for k := 0; k <= 10; k++ {
		short = append(short, float64(k)/30)
	}
	if problem := assessTimestampCoverage(short, 3.075, 6.475); !strings.Contains(problem, "before the window end") {
		t.Fatalf("truncated 0-based probe reports %q, want a window-end problem", problem)
	}
	// Absolute timestamps keep working: a healthy absolute window stays
	// healthy and a truncated absolute tail still reports.
	absolute := make([]float64, 0, 103)
	for k := 0; k <= 102; k++ {
		absolute = append(absolute, 3.075+float64(k)/30)
	}
	if problem := assessTimestampCoverage(absolute, 3.075, 6.475); problem != "" {
		t.Fatalf("absolute probe for trimmed window reports %q, want healthy", problem)
	}
	absoluteShort := absolute[:11]
	if problem := assessTimestampCoverage(absoluteShort, 3.075, 6.475); !strings.Contains(problem, "before the window end") {
		t.Fatalf("truncated absolute probe reports %q, want a window-end problem", problem)
	}
}

func TestValidateClipTimestampsSkipsNonVideo(t *testing.T) {
	clips := []clip{
		{File: "photo.jpg", MediaKind: "image", InPoint: 0, OutPoint: 5},
		{File: "sound.mp3", MediaKind: "audio", InPoint: 0, OutPoint: 5},
		{File: "empty.mp4", MediaKind: "video", InPoint: 2, OutPoint: 2},
	}
	// None of these may invoke the prober (no such files exist in test env).
	if err := validateClipTimestamps(clips, legacyScope()); err != nil {
		t.Fatalf("validateClipTimestamps = %v, want nil", err)
	}
}

func TestTimestampWindowsReuseOnlyIdenticalSuccessfulChecks(t *testing.T) {
	clips := []clip{
		{File: "source.mp4", OutPoint: 1},
		{File: "source.mp4", OutPoint: 1, Start: 5},
		{File: "source.mp4", InPoint: 1, OutPoint: 2},
	}
	calls := 0
	err := validateTimestampWindows(clips, fileScope{root: t.TempDir()}, func(_ string, start, duration float64) ([]float64, error) {
		calls++
		return []float64{0, 0.2, 0.4, 0.6, 0.8, 0.99}, nil
	})
	if err != nil || calls != 2 {
		t.Fatalf("window checks: calls=%d, error=%v", calls, err)
	}
	clips[2].OutPoint = 3
	err = validateTimestampWindows(clips, fileScope{root: t.TempDir()}, func(_ string, start, duration float64) ([]float64, error) {
		return []float64{0, 0.2, 0.4, 0.6, 0.8, 0.99}, nil
	})
	if err == nil || !strings.Contains(err.Error(), "before the window end") {
		t.Fatalf("changed window bypassed coverage validation: %v", err)
	}
}
