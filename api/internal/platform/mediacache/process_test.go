package mediacache

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestProcessQueueHonorsCancellation(t *testing.T) {
	for range cap(encodingSlots) {
		encodingSlots <- struct{}{}
	}
	defer func() {
		for range cap(encodingSlots) {
			<-encodingSlots
		}
	}()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Run(ctx, "ffmpeg"); !errors.Is(err, context.Canceled) {
		t.Fatalf("queued job did not cancel: %v", err)
	}
}

func TestProcessOutputIsBounded(t *testing.T) {
	output := limitedBuffer{limit: 16}
	if _, err := io.Copy(&output, io.LimitReader(strings.NewReader(strings.Repeat("x", 100)), 100)); err != nil {
		t.Fatal(err)
	}
	if len(output.String()) != 16 || !output.truncated {
		t.Fatalf("output limit not enforced: %q, %v", output.String(), output.truncated)
	}
}
