package imagegen

import (
	"context"
	"errors"
	"testing"
)

func TestMediaConcurrencyIsBoundedAndConfigurable(t *testing.T) {
	for _, value := range []string{"", "invalid", "0", "-1", "17"} {
		if got := parseMediaConcurrency(value); got != defaultMediaConcurrency {
			t.Fatal(value, got)
		}
	}
	for value, want := range map[string]int{"1": 1, "8": 8, "16": 16} {
		if got := parseMediaConcurrency(value); got != want {
			t.Fatal(value, got)
		}
	}
}

func TestQueuedImageCancellationNeverAcquiresAProviderSlot(t *testing.T) {
	for range cap(requestSlots) {
		if !acquireRequestSlot() {
			t.Fatal("could not fill provider slots")
		}
		t.Cleanup(releaseRequestSlot)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitForRequestSlot(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if len(requestSlots) != cap(requestSlots) {
		t.Fatal("cancelled request changed slot ownership")
	}
}
