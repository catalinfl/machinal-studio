package render

import "testing"

func TestTextChunkWorkersRespectMemoryResolutionAndCPU(t *testing.T) {
	tests := []struct {
		name                        string
		chunks, width, height, cpus int
		memory                      int64
		want                        int
	}{
		{"docker desktop 2GB 1080p", 20, 1920, 1080, 16, 2 << 30, 3},
		{"docker desktop 6GB 1080p", 20, 1920, 1080, 16, 6 << 30, 6},
		{"docker desktop 2GB 4K", 20, 3840, 2160, 16, 2 << 30, 1},
		{"limited CPUs", 20, 1920, 1080, 2, 6 << 30, 2},
		{"few chunks", 1, 1920, 1080, 16, 6 << 30, 1},
		{"unknown memory", 20, 1920, 1080, 16, 0, 2},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := textChunkWorkers(test.chunks, test.width, test.height, test.cpus, test.memory); got != test.want {
				t.Fatalf("workers = %d, want %d", got, test.want)
			}
		})
	}
}
