package compositions

import (
	"context"
	"log"
	"os"
	"slices"
	"strings"
	"time"

	"ffmpeg-go-server/internal/integrations/openrouter"
	"ffmpeg-go-server/internal/platform/credits"
)

const renderCostTimeout = 10 * time.Second

type RenderCost struct {
	Status             string                `json:"status"`
	PendingReason      string                `json:"pendingReason,omitempty"`
	AICredits          float64               `json:"aiCredits"`
	RenderCredits      float64               `json:"renderCredits"`
	SceneRenderCredits float64               `json:"sceneRenderCredits"`
	KnownCredits       float64               `json:"knownCredits"`
	USDPerCredit       string                `json:"usdPerCredit"`
	RenderUsage        []credits.RenderUsage `json:"renderUsage,omitempty"`
}

func completedRenderCost(ctx context.Context) *RenderCost {
	meter := credits.FromContext(ctx)
	if meter == nil {
		if credits.WorkflowPolicyFromContext(ctx) == credits.MCPFree {
			return &RenderCost{Status: "final"}
		}
		return nil
	}
	usageCtx, cancel := context.WithTimeout(ctx, renderCostTimeout)
	defer cancel()
	client := openrouter.Client{APIKey: strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")), BaseURL: strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL"))}
	if err := client.ReconcileUsage(usageCtx); err != nil {
		log.Printf("render completed; credit operation %s usage pending: %v", meter.ID, err)
	}
	reservation, err := meter.Store.Operation(meter.Owner, meter.ID)
	if err != nil || reservation == nil || reservation.ID != meter.ID {
		return &RenderCost{Status: "pending", USDPerCredit: meter.Pricing.USDPerCredit}
	}
	status := "final"
	if len(reservation.Attempts) > 0 {
		status = "pending"
	}
	cost := &RenderCost{Status: status, AICredits: float64(reservation.Spent-reservation.Render-reservation.SceneRender) / float64(credits.UnitsPerCredit),
		RenderCredits: float64(reservation.Render) / float64(credits.UnitsPerCredit), SceneRenderCredits: float64(reservation.SceneRender) / float64(credits.UnitsPerCredit), KnownCredits: float64(reservation.Spent) / float64(credits.UnitsPerCredit), USDPerCredit: meter.Pricing.USDPerCredit}
	if status == "pending" {
		cost.PendingReason = "awaiting_provider_usage"
		for attempt := range reservation.Attempts {
			if reservation.Generations[attempt] == "" {
				cost.PendingReason = "missing_provider_reference"
				break
			}
		}
	}
	for _, usage := range reservation.RenderUsage {
		cost.RenderUsage = append(cost.RenderUsage, usage)
	}
	slices.SortFunc(cost.RenderUsage, func(left, right credits.RenderUsage) int {
		if category := strings.Compare(left.Category, right.Category); category != 0 {
			return category
		}
		if left.DurationSeconds < right.DurationSeconds {
			return -1
		}
		if left.DurationSeconds > right.DurationSeconds {
			return 1
		}
		return 0
	})
	return cost
}
