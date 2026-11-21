package credits

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestAudioMinimumOnlyAppliesToPositiveUsage(t *testing.T) {
	pricing := Pricing{USDPerCredit: "10"}
	for _, test := range []struct {
		cost string
		want int64
	}{
		{"0", 0},
		{"0.000001", UnitsPerCredit},
		{"1e-20", UnitsPerCredit},
		{"2", UnitsPerCredit},
		{"4", 2 * UnitsPerCredit},
		{"5.999", 2 * UnitsPerCredit},
	} {
		units, err := pricing.aiUnits(test.cost, MinimumAudioCredits*UnitsPerCredit)
		if err != nil || units != test.want {
			t.Errorf("cost %s: units=%d err=%v; want %d", test.cost, units, err, test.want)
		}
	}
	for _, invalid := range []string{"", "-1", "NaN", "Infinity", "9999999999999999999999999"} {
		if _, err := pricing.aiUnits(invalid, UnitsPerCredit); err == nil {
			t.Errorf("accepted invalid cost %q", invalid)
		}
	}
}

func TestAudioMinimumSurvivesRestartAndSettlementWithoutRequestContext(t *testing.T) {
	file := filepath.Join(t.TempDir(), "credits.db")
	store, err := Open(file, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Begin("alice", "audio-job", true); err != nil {
		t.Fatal(err)
	}
	meter := &Meter{Store: store, Owner: "alice", ID: "audio-job", DeferredUsage: true, Pricing: Pricing{USDPerCredit: "10"}}
	ctx := WithAudioMinimum(WithMeter(context.Background(), meter))
	voice, err := StartProvider(ctx)
	if err != nil {
		t.Fatal(err)
	}
	captions, err := StartProvider(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(file, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	meter.Store = store
	ctx = WithMeter(context.Background(), meter)
	for _, attempt := range []string{voice, captions} {
		if err := ResolveProvider(ctx, attempt, "gen-"+attempt, "0.00001"); err != nil {
			t.Fatal(err)
		}
		if err := ResolveProvider(ctx, attempt, "gen-"+attempt, "0.00001"); !errors.Is(err, ErrNotFound) {
			t.Fatal("duplicate resolution was not rejected", err)
		}
	}
	operation, err := store.Operation("alice", "audio-job")
	if err != nil || operation.Spent != 2*UnitsPerCredit || len(operation.Minimums) != 0 {
		t.Fatal("voice/captions minimum was lost or duplicated", operation, err)
	}
	if err := store.Finish("alice", "audio-job"); err != nil {
		t.Fatal(err)
	}
	if balance, err := store.Balance("alice", true); err != nil || balance.Remaining != 998 || balance.UsagePending {
		t.Fatal(balance, err)
	}
}
