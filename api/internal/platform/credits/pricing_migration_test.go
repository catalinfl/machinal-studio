package credits

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestProviderSettlementUsesTariffRecordedWhenWorkStarted(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	if err := store.Begin("alice", "work", true); err != nil {
		t.Fatal(err)
	}
	meter := &Meter{Store: store, Owner: "alice", ID: "work", Pricing: Pricing{USDPerCredit: "0.01"}}
	ctx := WithMeter(context.Background(), meter)
	attempt, err := StartProvider(ctx)
	if err != nil {
		t.Fatal(err)
	}
	meter.Pricing.USDPerCredit = "10"
	if err := ResolveProvider(ctx, attempt, "generation", "0.02"); err != nil {
		t.Fatal(err)
	}
	Finish(ctx)
	if got := balanceOf(t, store, "alice", true); got.Remaining != 990 {
		t.Fatal("pending usage was repriced", got)
	}
}

func TestLegacyPendingUsageKeepsOriginalValueAndThirtyPercentPolicy(t *testing.T) {
	file := filepath.Join(t.TempDir(), "credits.db")
	store, err := Open(file, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Begin("alice", "legacy-work", true); err != nil {
		t.Fatal(err)
	}
	if err := store.StartAttempt("alice", "legacy-work", "legacy-attempt"); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CREDIT_LEGACY_USD_VALUE", "10")
	store, err = Open(file, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := WithMeter(context.Background(), &Meter{Store: store, Owner: "alice", ID: "legacy-work", Pricing: Pricing{USDPerCredit: "0.01"}})
	if err := ResolveProvider(ctx, "legacy-attempt", "generation", "3"); err != nil {
		t.Fatal(err)
	}
	Finish(ctx)
	if got := balanceOf(t, store, "alice", true); got.Remaining != 999 {
		t.Fatal("legacy usage was charged at the new tariff", got)
	}
}
