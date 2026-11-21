package utils

import "testing"

func TestParseFFmpegProgressLine(t *testing.T) {
	tests := []struct {
		line     string
		duration float64
		want     float64
		ok       bool
	}{
		{line: "out_time_us=2500000", duration: 10, want: 0.25, ok: true},
		{line: "out_time_ms=10000000", duration: 10, want: 1, ok: true},
		{line: "progress=end", duration: 0, want: 1, ok: true},
		{line: "frame=25", duration: 10, ok: false},
		{line: "out_time_us=invalid", duration: 10, ok: false},
	}
	for _, test := range tests {
		got, ok := parseFFmpegProgressLine(test.line, test.duration)
		if ok != test.ok || got != test.want {
			t.Errorf("parseFFmpegProgressLine(%q) = (%v, %v), want (%v, %v)", test.line, got, ok, test.want, test.ok)
		}
	}
}
