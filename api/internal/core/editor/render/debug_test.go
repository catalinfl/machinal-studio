package render

import (
	"strings"
	"testing"
)

func TestFormatVideoSegmentDebugShowsRampEnvelope(t *testing.T) {
	seg := segment{
		SrcStart: 0.24,
		SrcEnd:   3.3,
		Effects: []effect{{
			ID:     "grayscale",
			Params: map[string]float64{},
			Ramp: &ramp{
				Mode: "in-out", Curve: "ease-in-out", Amount: 0.5,
				BlockDuration: 3.06, Offset: 0,
			},
		}},
	}
	effectFilter, err := buildFilterForDuration(seg.Effects, 3.06)
	if err != nil {
		t.Fatalf("build effect filter: %v", err)
	}
	got := formatVideoSegmentDebug(0, 1, "clip.mp4", seg, 1, effectFilter,
		"setpts=(PTS-STARTPTS)/1,"+effectFilter+",scale=640:360",
		[]string{"-ss", "0.24", "-t", "3.06"}, "clip.mp4")

	for _, fragment := range []string{
		"video clip 0 segment 1",
		"src=[0.24,3.3]",
		"id=grayscale",
		"mode=in-out",
		"curve=ease-in-out",
		"blockDuration=3.06",
		"offset=0",
		"effectFilter=format=rgb24,settb=AVTB,split[r0a][r0b]",
		"blend=all_expr=",
		"-ss 0.24 -t 3.06 -i clip.mp4",
		"T=0->0",
		"T=1.53->1",
	} {
		if !strings.Contains(got, fragment) {
			t.Errorf("debug report %q does not contain %q", got, fragment)
		}
	}
}

func TestFormatVideoSegmentDebugPassthrough(t *testing.T) {
	seg := segment{SrcStart: 0, SrcEnd: 0.24}
	got := formatVideoSegmentDebug(0, 0, "clip.mp4", seg, 1, "", "setpts=(PTS-STARTPTS)/1", []string{"-ss", "0", "-t", "0.24"}, "clip.mp4")
	if !strings.Contains(got, "effects: none (passthrough)") {
		t.Errorf("passthrough debug report missing marker: %q", got)
	}
	if strings.Contains(got, "effectFilter=") {
		t.Errorf("passthrough debug report should not log an effect filter: %q", got)
	}
}
