package credits

import (
	"path/filepath"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func TestRestartSettlesKnownUsageButPreservesUnknownAttempts(t *testing.T) {
	file := filepath.Join(t.TempDir(), "credits.db")
	store, err := Open(file, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	for _, owner := range []string{"known", "unknown"} {
		if err := store.Begin(owner, "operation", true); err != nil {
			t.Fatal(err)
		}
		if err := store.StartAttempt(owner, "operation", "attempt"); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.ResolveAttempt("known", "operation", "attempt", "gen-known", 3*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.ChargeRender("known", "operation", 5*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.NoteGeneration("unknown", "operation", "attempt", "gen-unknown"); err != nil {
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
	if got := balanceOf(t, store, "known", true); got.Remaining != 997 || got.Reserved != 0 {
		t.Fatal(got)
	}
	if got := balanceOf(t, store, "unknown", true); got.Remaining != 1000 || got.Reserved != 0 || !got.UsagePending {
		t.Fatal(got)
	}
	pending, err := store.Pending("unknown")
	if err != nil || pending.Generations["attempt"] != "gen-unknown" || pending.StartedAt.IsZero() {
		t.Fatal(pending, err)
	}
}

func TestRefundDuringOperationRemovesPurchasedCredits(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	addPurchase(t, store, "alice", 250)
	if err := store.Begin("alice", "work", true); err != nil {
		t.Fatal(err)
	}
	if err := store.ReverseCapture("CAPTURE-alice", "refund", 250*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "work"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 1000 || got.PurchasedRemaining != 0 {
		t.Fatal(got)
	}
}

func TestOutOfOrderReversalBlocksLaterCaptureGrant(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	if err := store.BlockCapture("CAPTURE123"); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveOrder(Order{ID: "ORDER123", Owner: "alice", Credits: 250}); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteOrder("ORDER123", "CAPTURE123"); err == nil {
		t.Fatal("reversed payment was credited")
	}
}

func TestLegacyHoldIsReleasedWithoutLosingPendingUsage(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	file := filepath.Join(t.TempDir(), "credits.db")
	store, err := Open(file, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	legacy := Account{Month: "2026-10", Granted: true, Active: &Reservation{
		ID: "legacy", Month: "2026-10", Monthly: 1000 * UnitsPerCredit, Purchased: 50 * UnitsPerCredit,
		Spent: 2 * UnitsPerCredit, Attempts: map[string]bool{"audio": true}, Events: map[string]bool{"known": true},
		Generations: map[string]string{"audio": "gen-audio"}, StartedAt: now,
	}}
	if err := store.db.Update(func(tx *bolt.Tx) error {
		return putJSON(tx.Bucket(accountBucket), "alice", legacy)
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(file, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for range 2 {
		if got := balanceOf(t, store, "alice", true); got.Remaining != 1050 || got.Reserved != 0 || !got.UsagePending {
			t.Fatalf("legacy hold was lost or restored more than once: %+v", got)
		}
	}
	pending, err := store.Operation("alice", "legacy")
	if err != nil || pending == nil || pending.Spent != 2*UnitsPerCredit || pending.Generations["audio"] != "gen-audio" {
		t.Fatal("migration lost recorded provider usage", pending, err)
	}
	if err := store.ResolveAttempt("alice", "legacy", "audio", "gen-audio", UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "legacy"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.Remaining != 1047 {
		t.Fatal("legacy actual cost was not settled exactly once", got)
	}
}
