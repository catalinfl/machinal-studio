package render

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"testing"
)

func TestRenderTasksKeepOrderAndMonotonicProgress(t *testing.T) {
	weights := make([]float64, 20)
	for index := range weights {
		weights[index] = 1
	}
	last := 0.0
	progress := newRenderProgress(20, func(ratio float64, _ string) {
		if ratio < last {
			t.Errorf("progress went backward: %f < %f", ratio, last)
		}
		last = ratio
	})
	files, err := renderTasks("test", weights, 128, 72, progress, func(index int, child *renderProgress) (string, error) {
		runtime.Gosched()
		child.report(0.5, "half", true)
		if child.threadBudget < 1 {
			return "", errors.New("missing thread budget")
		}
		return fmt.Sprint(index), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for index, file := range files {
		if file != fmt.Sprint(index) {
			t.Fatalf("output %d = %s", index, file)
		}
	}
	if progress.completedWork != 20 {
		t.Fatalf("incomplete progress: %f", progress.completedWork)
	}
}

func TestRenderTaskFailureCancelsOtherWorkers(t *testing.T) {
	want := errors.New("failed segment")
	files, err := renderTasks("test", []float64{1, 1, 1}, 128, 72, nil, func(index int, child *renderProgress) (string, error) {
		if index == 0 {
			return "", want
		}
		<-child.ctx.Done()
		return "", child.ctx.Err()
	})
	if !errors.Is(err, want) || files != nil {
		t.Fatalf("partial results on failure: %v, %v", files, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	progress := newRenderProgress(1, nil)
	progress.ctx = ctx
	_, err = renderTasks("test", []float64{1}, 128, 72, progress, func(int, *renderProgress) (string, error) {
		t.Error("started a canceled task")
		return "", nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
