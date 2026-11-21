package media

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

func TestAggregateWaveform(t *testing.T) {
	samples := make([]float32, waveformBinSamples+2)
	samples[10] = -0.75
	samples[20] = 0.5
	samples[waveformBinSamples] = -0.25
	samples[waveformBinSamples+1] = 0.9
	var input bytes.Buffer
	for _, sample := range samples {
		if err := binary.Write(&input, binary.LittleEndian, math.Float32bits(sample)); err != nil {
			t.Fatal(err)
		}
	}

	result, err := aggregateWaveform(&input)
	if err != nil {
		t.Fatal(err)
	}
	if result.SampleRate != waveformSampleRate || result.BinSamples != waveformBinSamples {
		t.Fatalf("unexpected waveform format: %+v", result)
	}
	if result.Length != len(samples) {
		t.Fatalf("length = %d, want %d", result.Length, len(samples))
	}
	if len(result.Min) != 2 || len(result.Max) != 2 {
		t.Fatalf("bins = %d/%d, want 2/2", len(result.Min), len(result.Max))
	}
	if result.Min[0] != -0.75 || result.Max[0] != 0.5 {
		t.Fatalf("first bin = %v/%v", result.Min[0], result.Max[0])
	}
	if result.Min[1] != -0.25 || result.Max[1] != 0.9 {
		t.Fatalf("second bin = %v/%v", result.Min[1], result.Max[1])
	}
}
