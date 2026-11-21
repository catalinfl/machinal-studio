package credits

import (
	"fmt"
	"sort"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

const PrepaidAllowanceDays = 30
const prepaidPeriodPrefix = "prepaid:"

type membershipTerm struct {
	order      Order
	start, end time.Time
}

func membershipTerms(orders []Order) []membershipTerm {
	sort.Slice(orders, func(i, j int) bool {
		if orders[i].CompletedAt.Equal(orders[j].CompletedAt) {
			return orders[i].ID < orders[j].ID
		}
		return orders[i].CompletedAt.Before(orders[j].CompletedAt)
	})
	terms := []membershipTerm{}
	var until time.Time
	for _, order := range orders {
		if order.CaptureID == "" || order.MembershipDays == 0 || order.PaymentReversed || order.Reversed > 0 {
			continue
		}
		start := order.CompletedAt.UTC()
		if until.After(start) {
			start = until
		}
		until = start.AddDate(0, 0, order.MembershipDays)
		terms = append(terms, membershipTerm{order: order, start: start, end: until})
	}
	return terms
}

func prepaidAllowance(orders []Order, now time.Time) (string, time.Time) {
	for _, term := range membershipTerms(orders) {
		if now.Before(term.start) || !now.Before(term.end) {
			continue
		}
		cycle := int(now.Sub(term.start) / (PrepaidAllowanceDays * 24 * time.Hour))
		end := term.start.AddDate(0, 0, (cycle+1)*PrepaidAllowanceDays)
		if end.After(term.end) {
			end = term.end
		}
		return fmt.Sprintf("%s%s:%d", prepaidPeriodPrefix, term.order.ID, cycle), end
	}
	return "", time.Time{}
}

func (s *Store) renewAccount(tx *bolt.Tx, owner string, account *Account, paid bool) error {
	orders, err := ordersForOwner(tx, owner)
	if err != nil {
		return err
	}
	now := s.now().UTC()
	period, end := prepaidAllowance(orders, now)
	if period == "" {
		account.AllowanceEnd = time.Time{}
		account.renew(now, paid)
		return nil
	}
	if account.Month != period {
		// Preserve an existing calendar grant when migrating an active prepaid account.
		preserve := account.Granted && !strings.HasPrefix(account.Month, prepaidPeriodPrefix)
		account.Month = period
		if !preserve {
			account.Monthly, account.Granted = 0, false
		}
	}
	account.AllowanceEnd = end
	if paid && !account.Granted {
		account.Monthly, account.Granted = MonthlyAllowance, true
	}
	account.payDebt()
	return nil
}
