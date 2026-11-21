package compositions

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/credits"
)

func TestCompletedRenderReportsPendingCostWithoutRefundingOutput(t *testing.T) {
	store, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Begin("alice", "render", true); err != nil {
		t.Fatal(err)
	}
	ctx := credits.WithMeter(context.Background(), &credits.Meter{Store: store, Owner: "alice", ID: "render", DeferredUsage: true,
		Pricing: credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}})
	if _, err := credits.StartProvider(ctx); err != nil {
		t.Fatal(err)
	}
	if err := credits.ChargeRender(ctx, 72); err != nil {
		t.Fatal(err)
	}
	cost := completedRenderCost(ctx)
	if cost.Status != "pending" || cost.RenderCredits != 2 || cost.KnownCredits != 2 {
		t.Fatalf("completed output accounting: %+v", cost)
	}
	credits.Finish(ctx)
	pending, err := store.Pending("alice")
	if err != nil || pending.Render != 2*credits.UnitsPerCredit {
		t.Fatalf("render debit lost: %+v %v", pending, err)
	}
}

func TestRenderCostExplainsPerSceneRoundingWithoutChangingTariffs(t *testing.T) {
	store, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Begin("alice", "documentary", true); err != nil {
		t.Fatal(err)
	}
	ctx := credits.WithMeter(context.Background(), &credits.Meter{Store: store, Owner: "alice", ID: "documentary", Pricing: credits.Pricing{USDPerCredit: "10", RenderPerMinute: "10"}})
	if err := credits.ChargeRender(ctx, 59.433333); err != nil {
		t.Fatal(err)
	}
	for index, seconds := range []float64{4.733333, 5.1, 9.166667, 14.4, 10.1, 17.433333} {
		if err := credits.ChargeSceneRender(ctx, string(rune('a'+index))+".scene.json", seconds); err != nil {
			t.Fatal(err)
		}
	}
	cost := completedRenderCost(ctx)
	if cost.RenderCredits != 9 || cost.SceneRenderCredits != 6 || cost.KnownCredits != 15 || len(cost.RenderUsage) != 7 {
		t.Fatal(cost)
	}
	var total float64
	for _, item := range cost.RenderUsage {
		total += item.BilledCredits
		if item.CreditsPerMinute != "10" || item.Rounding != "floor-whole-credits-per-render" || item.DurationSeconds <= 0 {
			t.Fatal("missing billing basis", item)
		}
	}
	if total != cost.KnownCredits {
		t.Fatal("breakdown does not match debit", total, cost)
	}
	credits.RefundRender(ctx)
	if refunded := completedRenderCost(ctx); refunded.RenderCredits != 0 || len(refunded.RenderUsage) != 6 {
		t.Fatal("refund retained video billing detail", refunded)
	}
}

func TestServerSceneCostIsReportedSeparatelyFromVideoAndProviderUsage(t *testing.T) {
	store, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Begin("alice", "scene-and-video", true); err != nil {
		t.Fatal(err)
	}
	ctx := credits.WithWorkflowPolicy(context.Background(), credits.MCPServerRender)
	ctx = credits.WithMeter(ctx, &credits.Meter{Store: store, Owner: "alice", ID: "scene-and-video", Pricing: credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"}})
	if err := credits.ChargeRender(ctx, 60); err != nil {
		t.Fatal(err)
	}
	if err := credits.ChargeSceneRender(ctx, "scene.scene.json", 60); err != nil {
		t.Fatal(err)
	}
	cost := completedRenderCost(ctx)
	if cost.RenderCredits != 2 || cost.SceneRenderCredits != 2 || cost.AICredits != 0 || cost.KnownCredits != 4 {
		t.Fatal("server scene rendering was mislabeled as AI code generation", cost)
	}
}

func TestTimingPassReportsOneCreditEachForVoiceAndCaptions(t *testing.T) {
	store, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Begin("alice", "timing", true); err != nil {
		t.Fatal(err)
	}
	ctx := credits.WithWorkflowPolicy(context.Background(), credits.MCPMediaOnly)
	ctx = credits.WithMeter(ctx, &credits.Meter{Store: store, Owner: "alice", ID: "timing", Pricing: credits.Pricing{USDPerCredit: "10"}})
	for _, kind := range []string{"voice", "captions"} {
		attempt, err := credits.StartProvider(credits.WithAudioMinimum(ctx))
		if err != nil {
			t.Fatal(err)
		}
		if err := credits.ResolveProvider(ctx, attempt, "gen-"+kind, "0.000001"); err != nil {
			t.Fatal(err)
		}
	}
	cost := completedRenderCost(ctx)
	if cost == nil || cost.Status != "final" || cost.AICredits != 2 || cost.KnownCredits != 2 || cost.RenderCredits != 0 || cost.SceneRenderCredits != 0 {
		t.Fatal("timing job hid voice or caption minimums", cost)
	}
	credits.Finish(ctx)
	if balance, err := store.Balance("alice", true); err != nil || balance.Remaining != 998 {
		t.Fatal(balance, err)
	}
}
