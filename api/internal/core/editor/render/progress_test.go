package render

import "testing"

func TestEstimateRenderWorkDistinguishesCutsFromOverlaps(t *testing.T) {
	cutRequest := renderRequest{VideoChannels: []channel{{Clips: []clip{
		{InPoint: 0, OutPoint: 5, Start: 0},
		{InPoint: 0, OutPoint: 5, Start: 5},
	}}}}
	overlapRequest := renderRequest{VideoChannels: []channel{{Clips: []clip{
		{InPoint: 0, OutPoint: 6, Start: 0},
		{InPoint: 0, OutPoint: 5, Start: 5},
	}}}}
	plan := renderPlan{totalDuration: 10}

	cutWork := estimateRenderWork(cutRequest, plan)
	overlapWork := estimateRenderWork(overlapRequest, plan)
	if cutWork != 10 {
		t.Fatalf("cut work = %v, want 10 (no unused base alpha mask)", cutWork)
	}
	if overlapWork <= cutWork {
		t.Fatalf("overlap work = %v, want more than cut work %v", overlapWork, cutWork)
	}
}

func TestRenderProgressNeverRegresses(t *testing.T) {
	var ratios []float64
	progress := newRenderProgress(10, func(ratio float64, _ string) {
		ratios = append(ratios, ratio)
	})
	progress.report(0.5, "rendering", true)
	progress.report(0.2, "rendering", true)
	progress.complete("complete")

	if len(ratios) != 3 {
		t.Fatalf("received %d progress reports, want 3", len(ratios))
	}
	if ratios[1] != ratios[0] {
		t.Fatalf("progress regressed from %v to %v", ratios[0], ratios[1])
	}
	if ratios[2] != 0.999 {
		t.Fatalf("final streamed ratio = %v, want 0.999", ratios[2])
	}
}
