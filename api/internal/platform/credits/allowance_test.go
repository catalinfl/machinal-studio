package credits

import (
	"path/filepath"
	"testing"
	"time"
)

func addPass(t *testing.T, store *Store, id string, days int) {
	t.Helper()
	order := Order{ID: id, Owner: "alice", PackID: "pro-30", MembershipDays: days, USD: "10.00"}
	if err := store.SaveOrder(order); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteOrder(id, "capture-"+id); err != nil {
		t.Fatal(err)
	}
}

func spendIncluded(t *testing.T, store *Store, id string, credits int64) {
	t.Helper()
	if err := store.Begin("alice", id, true); err != nil {
		t.Fatal(err)
	}
	if err := store.ChargeRender("alice", id, credits*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", id); err != nil {
		t.Fatal(err)
	}
}

func TestPrepaidAllowanceDoesNotResetAtCalendarBoundary(t *testing.T) {
	now := time.Date(2026, 10, 31, 23, 59, 0, 0, time.UTC)
	store := testStore(t, &now)
	addPass(t, store, "ORDER111", 30)
	spendIncluded(t, store, "work", 400)
	end := now.AddDate(0, 0, 30)
	now = now.Add(2 * time.Minute)
	balance := balanceOf(t, store, "alice", true)
	if balance.MonthlyRemaining != 600 || balance.AllowancePeriod != "prepaid-30-day" || !balance.NextReset.Equal(end) {
		t.Fatalf("calendar rollover changed the prepaid allocation: %+v", balance)
	}
}

func TestPrepaidRenewalGrantsOnlyWhenTheNextPassStarts(t *testing.T) {
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	store := testStore(t, &now)
	addPass(t, store, "ORDER111", 30)
	spendIncluded(t, store, "work", 400)
	addPass(t, store, "ORDER222", 30)
	if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 600 || got.PurchasedRemaining != 0 {
		t.Fatal("advance purchase granted credits early", got)
	}
	now = now.AddDate(0, 0, 30)
	for range 2 {
		if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 1000 || !got.NextReset.Equal(now.AddDate(0, 0, 30)) {
			t.Fatal("next paid period did not replace the previous allocation exactly once", got)
		}
	}
	spendIncluded(t, store, "next-work", 100)
	if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 900 {
		t.Fatal("same period was granted twice", got)
	}
}

func TestExpiredPrepaidCreditsDoNotRollOverButTopUpsSurvive(t *testing.T) {
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	store := testStore(t, &now)
	addPass(t, store, "ORDER111", 30)
	addPurchase(t, store, "alice", 500)
	spendIncluded(t, store, "work", 200)
	now = now.AddDate(0, 0, 30)
	balance := balanceOf(t, store, "alice", false)
	if balance.MonthlyRemaining != 0 || balance.PurchasedRemaining != 500 {
		t.Fatal("expired included credits survived or purchased credits expired", balance)
	}
	addPass(t, store, "ORDER222", 30)
	if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 1000 || got.PurchasedRemaining != 500 {
		t.Fatal("new pass rolled over old included credits", got)
	}
}

func TestPrepaidAllowanceSurvivesRestartWithoutAnotherGrant(t *testing.T) {
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	file := filepath.Join(t.TempDir(), "credits.db")
	store, err := Open(file, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	addPass(t, store, "ORDER111", 30)
	spendIncluded(t, store, "work", 400)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	now = now.AddDate(0, 0, 1)
	store, err = Open(file, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 600 {
		t.Fatal("restart replenished the prepaid allocation", got)
	}
}

func TestSwitchingFromLegacyCalendarGrantDoesNotReplenishCredits(t *testing.T) {
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	store := testStore(t, &now)
	spendIncluded(t, store, "legacy-work", 400)
	addPass(t, store, "ORDER111", 30)
	if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 600 || got.AllowancePeriod != "prepaid-30-day" {
		t.Fatal("migration minted another allocation", got)
	}
}
