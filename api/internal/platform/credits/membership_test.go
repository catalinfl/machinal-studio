package credits

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestMembershipPassesStackSurviveRestartAndRevokeOnRefund(t *testing.T) {
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "credits.db")
	store, err := Open(path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"ORDER111", "ORDER222"} {
		if err := store.SaveOrder(Order{ID: id, Owner: "alice", PackID: "monthly", PlanName: "Creator", MembershipDays: 30, USD: "10.00"}); err != nil {
			t.Fatal(err)
		}
		if err := store.CompleteOrder(id, "capture-"+id); err != nil {
			t.Fatal(err)
		}
		if err := store.CompleteOrder(id, "capture-"+id); err != nil {
			t.Fatal(err)
		}
	}
	membership, err := store.Membership("alice")
	if err != nil || !membership.Active || !membership.Until.Equal(now.AddDate(0, 0, 60)) {
		t.Fatal(membership, err)
	}
	if other, err := store.Membership("bob"); err != nil || other.Active {
		t.Fatal(other, err)
	}
	if err := store.ReverseCapture("capture-ORDER111", "refund-1", 0); err != nil {
		t.Fatal(err)
	}
	if err := store.ReverseCapture("capture-ORDER111", "refund-1", 0); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = Open(path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	membership, err = store.Membership("alice")
	if err != nil || !membership.Active || !membership.Until.Equal(now.AddDate(0, 0, 30)) {
		t.Fatal(membership, err)
	}
	now = now.AddDate(0, 0, 31)
	if membership, err = store.Membership("alice"); err != nil || membership.Active {
		t.Fatal(membership, err)
	}
}

func TestRefundRequestsAreOwnedIdempotentAndDoNotMoveMoney(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.SaveOrder(Order{ID: "ORDER123", Owner: "alice", Credits: 100, USD: "2.00"}); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteOrder("ORDER123", "CAPTURE123"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequestRefund("bob", "ORDER123", "Please review this payment"); !errors.Is(err, ErrNotFound) {
		t.Fatal("refund escaped account scope", err)
	}
	first, err := store.RequestRefund("alice", "ORDER123", "Please review this payment")
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.RequestRefund("alice", "ORDER123", "A changed repeat request")
	if err != nil || first.RefundReason != second.RefundReason || !first.RefundRequestedAt.Equal(*second.RefundRequestedAt) {
		t.Fatal(first, second, err)
	}
	balance, err := store.Balance("alice", false)
	if err != nil || balance.PurchasedRemaining != 100 {
		t.Fatal("request issued a refund", balance, err)
	}
	requests, err := store.RefundRequests()
	if err != nil || len(requests) != 1 {
		t.Fatal(requests, err)
	}
	orders, err := store.Orders("bob")
	if err != nil || len(orders) != 0 {
		t.Fatal("payment history escaped owner", orders, err)
	}
}
