package render

import (
	"context"
	"fmt"
	"log"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

const (
	maxConcurrentTextChunks = 6
	defaultTextWorkers      = 2
	minTextChunkMemory      = 512 << 20
	textFrameMemoryFactor   = 240
)

func textChunkWorkers(chunks, width, height, cpus int, memoryBytes int64) int {
	workers := min(chunks, maxConcurrentTextChunks, max(1, cpus))
	if memoryBytes <= 0 {
		return min(workers, defaultTextWorkers)
	}
	// FFmpeg retains decoded video frames and intermediate frames for each overlay.
	perChunk := max(int64(minTextChunkMemory), int64(width)*int64(height)*textFrameMemoryFactor)
	return min(workers, int(max(int64(1), memoryBytes/5*4/perChunk)))
}

func availableTextMemory() int64 {
	memory := int64(0)
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		for line := range strings.SplitSeq(string(data), "\n") {
			if fields := strings.Fields(line); len(fields) >= 2 && fields[0] == "MemAvailable:" {
				kilobytes, _ := strconv.ParseInt(fields[1], 10, 64)
				memory = kilobytes * 1024
				break
			}
		}
	}
	if limitData, err := os.ReadFile("/sys/fs/cgroup/memory.max"); err == nil {
		limit, limitErr := strconv.ParseInt(strings.TrimSpace(string(limitData)), 10, 64)
		if limitErr == nil && limit > 0 {
			if usedData, err := os.ReadFile("/sys/fs/cgroup/memory.current"); err == nil {
				if used, err := strconv.ParseInt(strings.TrimSpace(string(usedData)), 10, 64); err == nil {
					limit = max(1, limit-used)
				}
			}
			if memory == 0 || limit < memory {
				memory = limit
			}
		}
	}
	return memory
}

func textChunkWork(chunk textOverlayChunk, fps int) float64 {
	duration := float64(chunk.endFrame-chunk.startFrame) / float64(fps)
	work := 0.0
	for start := 0; start < len(chunk.itemIndices); start += maxTextOverlaysPerPass {
		layers := min(len(chunk.itemIndices)-start, maxTextOverlaysPerPass)
		work += duration * (1 + float64(min(layers, maxTextWorkLayers))*textWorkPerLayer)
	}
	return work
}

func renderTextChunks(input string, imageFiles []string, items []textItem, chunks []textOverlayChunk, w, h, fps int, work string, progress *renderProgress) ([]string, error) {
	weights := make([]float64, len(chunks))
	for index, chunk := range chunks {
		weights[index] = textChunkWork(chunk, fps)
	}
	return renderTasks("text", weights, w, h, progress, func(index int, taskProgress *renderProgress) (string, error) {
		return renderTextOverlayChunk(input, imageFiles, items, chunks[index], index, len(chunks), w, h, fps, work, taskProgress)
	})
}

func renderTasks(label string, weights []float64, w, h int, progress *renderProgress, render func(int, *renderProgress) (string, error)) ([]string, error) {
	ctx := context.Background()
	if progress != nil && progress.ctx != nil {
		ctx = progress.ctx
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	files := make([]string, len(weights))
	completed := make([]float64, len(weights))
	start := 0.0
	if progress != nil {
		start = progress.completedWork
	}

	var mu sync.Mutex
	var firstErr error
	jobs := make(chan int)
	var workers sync.WaitGroup
	workerCount := textChunkWorkers(len(weights), w, h, runtime.GOMAXPROCS(0), availableTextMemory())
	threadBudget := max(1, runtime.GOMAXPROCS(0)/max(1, workerCount)/2)
	log.Printf("render_%s_plan workers=%d threads_per_stage=%d tasks=%d", label, workerCount, threadBudget, len(weights))
	for range workerCount {
		workers.Go(func() {
			for index := range jobs {
				if ctx.Err() != nil {
					return
				}
				chunkProgress := newRenderProgress(weights[index], nil)
				chunkProgress.ctx = ctx
				chunkProgress.threadBudget = threadBudget
				if progress != nil && progress.callback != nil {
					chunkProgress.callback = func(ratio float64, message string) {
						mu.Lock()
						completed[index] = ratio * weights[index]
						progress.report((start+sumChunkWork(completed))/progress.totalWork, message, false)
						mu.Unlock()
					}
				}
				file, err := render(index, chunkProgress)
				mu.Lock()
				if err != nil && firstErr == nil {
					firstErr = fmt.Errorf("%s task %d: %w", label, index, err)
					cancel()
				}
				files[index] = file
				if err == nil {
					completed[index] = weights[index]
					if progress != nil {
						progress.report((start+sumChunkWork(completed))/progress.totalWork, fmt.Sprintf("rendered %s segment %d of %d", label, index+1, len(weights)), true)
					}
				}
				mu.Unlock()
			}
		})
	}

dispatch:
	for index := range weights {
		select {
		case jobs <- index:
		case <-ctx.Done():
			break dispatch
		}
	}
	close(jobs)
	workers.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if progress != nil {
		progress.completedWork = start + sumChunkWork(weights)
	}
	return files, nil
}

func sumChunkWork(weights []float64) float64 {
	total := 0.0
	for _, weight := range weights {
		total += weight
	}
	return total
}
