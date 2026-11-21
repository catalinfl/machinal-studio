package imagegen

import (
	"context"
	"os"
	"strconv"
)

const defaultMediaConcurrency = 4
const maximumMediaConcurrency = 16

// Recipe and image limits are distinct from MCP metadata and job waits.
var mediaConcurrency = parseMediaConcurrency(os.Getenv("MACHINAL_MEDIA_CONCURRENCY"))

func ConcurrencyLimit() int { return mediaConcurrency }

func parseMediaConcurrency(value string) int {
	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 || limit > maximumMediaConcurrency {
		return defaultMediaConcurrency
	}
	return limit
}

func waitForRequestSlot(ctx context.Context) error {
	select {
	case requestSlots <- struct{}{}:
		if err := ctx.Err(); err != nil {
			releaseRequestSlot()
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
