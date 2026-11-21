package credits

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testStore(t *testing.T, clock *time.Time) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "credits.db"), func() time.Time { return *clock })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	return store
}

func addPurchase(t *testing.T, store *Store, owner string, count int64) {
	t.Helper()
	order := Order{ID: "ORDER-" + owner, Owner: owner, Reference: "ref", Credits: count, USD: "1.00"}
	if err := store.SaveOrder(order); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteOrder(order.ID, "CAPTURE-"+owner); err != nil {
		t.Fatal(err)
	}
}

func balanceOf(t *testing.T, store *Store, owner string, paid bool) Balance {
	t.Helper()
	balance, err := store.Balance(owner, paid)
	if err != nil {
		t.Fatal(err)
	}
	return balance
}

func TestMonthlyCreditsRenewAtUTCMonthAndPurchasesSurvive(t *testing.T) {
	now := time.Date(2026, 10, 31, 23, 59, 59, 0, time.UTC)
	store := testStore(t, &now)
	addPurchase(t, store, "alice", 200)
	if got := balanceOf(t, store, "alice", true); got.Remaining != 1200 {
		t.Fatalf("initial balance: %+v", got)
	}
	if err := store.Begin("alice", "work", true); err != nil {
		t.Fatal(err)
	}
	if err := store.ChargeRender("alice", "work", 1050*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "work"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 0 || got.PurchasedRemaining != 150 {
		t.Fatalf("monthly credits were not consumed first: %+v", got)
	}
	now = now.Add(time.Second)
	got := balanceOf(t, store, "alice", true)
	if got.MonthlyRemaining != 1000 || got.PurchasedRemaining != 150 || got.NextReset.Format(time.RFC3339) != "2026-12-01T00:00:00Z" {
		t.Fatalf("renewal: %+v", got)
	}
	if again := balanceOf(t, store, "alice", true); again.Remaining != 1150 {
		t.Fatalf("duplicate monthly grant: %+v", again)
	}
}

func TestFreeAccountsCannotMintCredits(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	if got := balanceOf(t, store, "free", false); got.Remaining != 0 || got.MonthlyAllowance != 0 {
		t.Fatalf("free grant: %+v", got)
	}
	if err := store.Begin("free", "work", false); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("free operation: %v", err)
	}
	if got := balanceOf(t, store, "paid", true); got.Remaining != 1000 {
		t.Fatal(got)
	}
	if got := balanceOf(t, store, "paid", false); got.MonthlyRemaining != 0 {
		t.Fatal("expired plan retained spendable monthly credits")
	}
	if got := balanceOf(t, store, "paid", true); got.Remaining != 1000 {
		t.Fatal("plan toggling changed allocation")
	}
}

func TestDuplicateConcurrentOperationStartsOnlyOnce(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	var winners atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 24; i++ {
		group.Go(func() {
			if err := store.Begin("alice", "operation", true); err == nil {
				winners.Add(1)
			} else if !errors.Is(err, ErrBusy) {
				t.Error(err)
			}
		})
	}
	group.Wait()
	if winners.Load() != 1 {
		t.Fatalf("%d concurrent spends", winners.Load())
	}
	if err := store.Begin("bob", "independent", true); err != nil {
		t.Fatal("unrelated user was blocked", err)
	}
}

func TestUnknownProviderUsageDoesNotReserveBalance(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	if err := store.Begin("alice", "work", true); err != nil {
		t.Fatal(err)
	}
	if err := store.StartAttempt("alice", "work", "attempt"); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "work"); !errors.Is(err, ErrPending) {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); !got.UsagePending || got.Reserved != 0 || got.Remaining != 1000 {
		t.Fatal(got)
	}
	if err := store.ResolveAttempt("alice", "work", "attempt", "generation", 12500); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "work"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.Remaining != 999.9875 {
		t.Fatal(got)
	}
}

func TestRolloverDoesNotRestoreExpiredMonthlyCredits(t *testing.T) {
	now := time.Date(2026, 12, 31, 23, 59, 59, 0, time.UTC)
	store := testStore(t, &now)
	addPurchase(t, store, "alice", 50)
	if err := store.Begin("alice", "old", true); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 1000 {
		t.Fatal(got)
	}
	if err := store.Finish("alice", "old"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.Remaining != 1050 {
		t.Fatalf("old credits rolled over: %+v", got)
	}
}

func TestFailedRenderRefundsOnlyRenderNotProviderUsage(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	if err := store.Begin("alice", "work", true); err != nil {
		t.Fatal(err)
	}
	if err := store.StartAttempt("alice", "work", "ai"); err != nil {
		t.Fatal(err)
	}
	if err := store.ResolveAttempt("alice", "work", "ai", "gen", 2*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.ChargeRender("alice", "work", 10*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.RefundRender("alice", "work"); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "work"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.Remaining != 998 {
		t.Fatal(got)
	}
}

func TestPaymentGrantIsDurableAndIdempotent(t *testing.T) {
	file := filepath.Join(t.TempDir(), "credits.db")
	store, err := Open(file, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	addPurchase(t, store, "alice", 250)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(file, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.CompleteOrder("ORDER-alice", "CAPTURE-alice"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.PurchasedRemaining != 250 {
		t.Fatal(got)
	}
	if err := store.SaveOrder(Order{ID: "other", Owner: "bob", Credits: 250}); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteOrder("other", "CAPTURE-alice"); err == nil {
		t.Fatal("capture credited across two accounts")
	}
}

func TestProviderOverageBecomesDebtAndBlocksFurtherWork(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	if err := store.Begin("alice", "work", true); err != nil {
		t.Fatal(err)
	}
	if err := store.StartAttempt("alice", "work", "ai"); err != nil {
		t.Fatal(err)
	}
	if err := store.ResolveAttempt("alice", "work", "ai", "gen", 1005*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "work"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.Debt != 5 || got.Remaining != 0 {
		t.Fatal(got)
	}
	if err := store.Begin("alice", "next", true); !errors.Is(err, ErrInsufficient) {
		t.Fatal(err)
	}
}

func TestOperationChargesActualUsageOnlyAtCompletion(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	addPurchase(t, store, "alice", 50)
	if err := store.Begin("alice", "render", true); err != nil {
		t.Fatal(err)
	}
	if err := store.ChargeRender("alice", "render", 12*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.MonthlyRemaining != 1000 || got.PurchasedRemaining != 50 || got.Remaining != 1050 || got.Reserved != 0 {
		t.Fatalf("starting work changed the wallet: %+v", got)
	}
	if err := store.Finish("alice", "render"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.Remaining != 1038 || got.MonthlyRemaining != 988 || got.PurchasedRemaining != 50 {
		t.Fatalf("actual usage was not settled: %+v", got)
	}
	if err := store.Finish("alice", "render"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("operation settled twice: %v", err)
	}
}

func TestDistinctOperationsShareWalletWithoutReservingIt(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	var group sync.WaitGroup
	for i := range 24 {
		group.Go(func() {
			id := fmt.Sprintf("operation-%d", i)
			if err := store.Begin("alice", id, true); err != nil {
				t.Error(err)
				return
			}
			if err := store.ChargeRender("alice", id, UnitsPerCredit); err != nil {
				t.Error(err)
				return
			}
			if err := store.Finish("alice", id); err != nil {
				t.Error(err)
			}
		})
	}
	group.Wait()
	if got := balanceOf(t, store, "alice", true); got.Remaining != 976 || got.Reserved != 0 {
		t.Fatalf("concurrent accounting lost usage or reserved the wallet: %+v", got)
	}
}

func TestPendingUsageDoesNotBlockAnotherOperation(t *testing.T) {
	now := time.Now()
	store := testStore(t, &now)
	if err := store.Begin("alice", "pending", true); err != nil {
		t.Fatal(err)
	}
	if err := store.StartAttempt("alice", "pending", "attempt"); err != nil {
		t.Fatal(err)
	}
	if err := store.NoteGeneration("alice", "pending", "attempt", "gen-old"); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "pending"); !errors.Is(err, ErrPending) {
		t.Fatal(err)
	}
	if err := store.Begin("alice", "next", true); err != nil {
		t.Fatalf("unresolved provider usage blocked unrelated work: %v", err)
	}
	if err := store.ChargeRender("alice", "next", 10*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "next"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.Remaining != 990 || !got.UsagePending || got.Reserved != 0 {
		t.Fatal(got)
	}
	if err := store.ResolveAttempt("alice", "pending", "attempt", "gen-old", 2*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish("alice", "pending"); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, store, "alice", true); got.Remaining != 988 || got.UsagePending {
		t.Fatalf("late usage was lost or double charged: %+v", got)
	}
}
