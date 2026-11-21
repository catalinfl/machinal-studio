package render

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"strings"
)

// debugRamps enables verbose per-segment render logging: for every video
// segment it prints the source window, the effect payload (params + ramp
// envelope), a numeric sampling of the ramp intensity I(T), the exact effect
// filter, and the full -vf chain sent to FFmpeg. Enable with DEBUGGING=true
// in the api environment (already forwarded by docker-compose.yml), rebuild
// the image, then read the output with:
//
//	docker compose logs api | grep render-debug
var debugRamps = strings.EqualFold(strings.TrimSpace(os.Getenv("DEBUGGING")), "true")

const rampDebugSamples = 9 // T=0..duration in 8 steps; enough to eyeball the envelope

func describeRamp(r *ramp) string {
	if r == nil {
		return "none (constant)"
	}
	return fmt.Sprintf("mode=%s curve=%s amount=%s blockDuration=%s offset=%s",
		r.mode(), r.curve(), ff(r.Amount), ff(r.BlockDuration), ff(r.Offset))
}

// sampleRampIntensity evaluates I(T) across a segment so the envelope can be
// eyeballed in the logs. Progress is block-relative:
// progress = (offset + T) / blockDuration, mirroring rampIntensityExpr.
func sampleRampIntensity(r *ramp, segmentDuration float64) string {
	if r == nil {
		return "n/a (constant full strength)"
	}
	d := r.BlockDuration
	if !(d > 0) {
		return "n/a (degenerate block, full strength)"
	}
	offset := r.Offset
	if math.IsNaN(offset) || math.IsInf(offset, 0) {
		offset = 0
	}
	parts := make([]string, 0, rampDebugSamples)
	for k := 0; k < rampDebugSamples; k++ {
		t := segmentDuration * float64(k) / float64(rampDebugSamples-1)
		parts = append(parts, fmt.Sprintf("T=%s->%s", ff(t), ff(rampIntensityAt(*r, (offset+t)/d))))
	}
	return strings.Join(parts, " ")
}

// formatVideoSegmentDebug builds the multi-line debug report for one video
// segment render. Pure function (no env access) so tests can assert on it.
func formatVideoSegmentDebug(clipIndex, segmentIndex int, file string, seg segment, rate float64, effectFilter, videoFilter string, inputArgs []string, inputPath string) string {
	var out strings.Builder
	duration := math.Max(0, seg.SrcEnd-seg.SrcStart)
	rate = sanitizePlaybackRate(rate)
	timelineDur := duration / rate
	fmt.Fprintf(&out, "[render-debug] video clip %d segment %d file=%s src=[%s,%s] rate=%s timelineDur=%s\n",
		clipIndex, segmentIndex, file, ff(seg.SrcStart), ff(seg.SrcEnd), ff(rate), ff(timelineDur))
	if len(seg.Effects) == 0 {
		out.WriteString("[render-debug]   effects: none (passthrough)\n")
	} else {
		for n, effect := range seg.Effects {
			// Best-effort debug rendering: params come from validated JSON
			// numbers, so Marshal cannot fail in practice.
			params, _ := json.Marshal(effect.Params)
			fmt.Fprintf(&out, "[render-debug]   effect %d id=%s params=%s\n", n, effect.ID, string(params))
			fmt.Fprintf(&out, "[render-debug]     ramp: %s\n", describeRamp(effect.Ramp))
			fmt.Fprintf(&out, "[render-debug]     intensity: %s\n", sampleRampIntensity(effect.Ramp, timelineDur))
		}
		fmt.Fprintf(&out, "[render-debug]   effectFilter=%s\n", effectFilter)
	}
	// strings.Builder writes never fail; Fprintf errors are safely ignored here.
	fmt.Fprintf(&out, "[render-debug]   input=%s -i %s\n", strings.Join(inputArgs, " "), inputPath)
	fmt.Fprintf(&out, "[render-debug]   vf=%s", videoFilter)
	return out.String()
}

func debugVideoSegment(clipIndex, segmentIndex int, file string, seg segment, rate float64, effectFilter, videoFilter string, inputArgs []string, inputPath string) {
	if !debugRamps {
		return
	}
	log.Print(formatVideoSegmentDebug(clipIndex, segmentIndex, file, seg, rate, effectFilter, videoFilter, inputArgs, inputPath))
}
