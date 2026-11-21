package credits

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	bolt "go.etcd.io/bbolt"
)

type Membership struct {
	Active bool      `json:"active"`
	PlanID string    `json:"planId,omitempty"`
	Name   string    `json:"name,omitempty"`
	Until  time.Time `json:"until,omitempty"`
}

func (s *Store) Orders(owner string) ([]Order, error) {
	var orders []Order
	err := s.db.View(func(tx *bolt.Tx) error {
		var err error
		orders, err = ordersForOwner(tx, owner)
		return err
	})
	sort.Slice(orders, func(i, j int) bool {
		if orders[i].CreatedAt.Equal(orders[j].CreatedAt) {
			return orders[i].ID > orders[j].ID
		}
		return orders[i].CreatedAt.After(orders[j].CreatedAt)
	})
	return orders, err
}

func ordersForOwner(tx *bolt.Tx, owner string) ([]Order, error) {
	orders := []Order{}
	prefix := []byte(owner + "\x00")
	cursor := tx.Bucket(ownerOrderBucket).Cursor()
	for key, id := cursor.Seek(prefix); key != nil && bytes.HasPrefix(key, prefix); key, id = cursor.Next() {
		var order Order
		if err := readOrder(tx, string(id), &order); err != nil {
			return nil, err
		}
		orders = append(orders, order)
	}
	return orders, nil
}

func (s *Store) Membership(owner string) (Membership, error) {
	orders, err := s.Orders(owner)
	if err != nil {
		return Membership{}, err
	}
	var membership Membership
	for _, term := range membershipTerms(orders) {
		membership.Until = term.end
		membership.PlanID, membership.Name = term.order.PackID, term.order.PlanName
	}
	membership.Active = membership.Until.After(s.now())
	return membership, nil
}

func (s *Store) RequestRefund(owner, id, reason string) (Order, error) {
	var order Order
	reason = strings.TrimSpace(reason)
	if size := utf8.RuneCountInString(reason); size < 10 || size > 1000 {
		return order, fmt.Errorf("refund reason must contain 10-1000 characters")
	}
	err := s.db.Update(func(tx *bolt.Tx) error {
		if err := readOrder(tx, id, &order); err != nil {
			return err
		}
		if order.Owner != owner {
			return ErrNotFound
		}
		if order.CaptureID == "" || order.PaymentReversed {
			return fmt.Errorf("payment is not eligible for a refund request")
		}
		if order.RefundRequestedAt != nil {
			return nil
		}
		now := s.now().UTC()
		order.RefundRequestedAt, order.RefundReason = &now, reason
		return putJSON(tx.Bucket(orderBucket), order.ID, order)
	})
	return order, err
}

func (s *Store) RefundRequests() ([]Order, error) {
	orders := []Order{}
	err := s.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket(orderBucket).ForEach(func(_, data []byte) error {
			var order Order
			if err := json.Unmarshal(data, &order); err != nil {
				return fmt.Errorf("read refund request: %w", err)
			}
			if order.RefundRequestedAt != nil && !order.PaymentReversed {
				orders = append(orders, order)
			}
			return nil
		})
	})
	return orders, err
}
