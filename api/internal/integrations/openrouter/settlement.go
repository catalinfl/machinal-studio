package openrouter

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"ffmpeg-go-server/internal/platform/credits"
)

const settlementTimeout = 10 * time.Second

func FinishUsage(ctx context.Context) {
	meter := credits.FromContext(ctx)
	if meter == nil {
		return
	}
	usageCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), settlementTimeout)
	defer cancel()
	client := Client{APIKey: strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")), BaseURL: strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL"))}
	if err := client.ReconcileUsage(usageCtx); err != nil {
		log.Printf("operation %s completed; provider usage pending: %v", meter.ID, err)
	}
	credits.Finish(usageCtx)
}
