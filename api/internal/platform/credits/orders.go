package credits

import (
	"encoding/json"
	"fmt"
	"time"

	bolt "go.etcd.io/bbolt"
)

type Order struct {
	ID                string     `json:"id"`
	Owner             string     `json:"owner"`
	Reference         string     `json:"reference"`
	PackID            string     `json:"packId"`
	Credits           int64      `json:"credits"`
	USD               string     `json:"usd"`
	CaptureID         string     `json:"captureId,omitempty"`
	Reversed          int64      `json:"reversed,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	CompletedAt       time.Time  `json:"completedAt,omitempty"`
	MembershipDays    int        `json:"membershipDays,omitempty"`
	PlanName          string     `json:"planName,omitempty"`
	RefundRequestedAt *time.Time `json:"refundRequestedAt,omitempty"`
	RefundReason      string     `json:"refundReason,omitempty"`
	PaymentReversed   bool       `json:"paymentReversed,omitempty"`
}

func (s *Store) SaveOrder(order Order) error {
	if order.ID == "" || order.Owner == "" || order.Credits < 0 || order.Credits > 1_000_000 || order.MembershipDays < 0 || order.MembershipDays > 366 {
		return fmt.Errorf("invalid payment snapshot")
	}
	order.CreatedAt = s.now().UTC()
	return s.db.Update(func(tx *bolt.Tx) error {
		if tx.Bucket(orderBucket).Get([]byte(order.ID)) != nil {
			return fmt.Errorf("order already exists")
		}
		if err := putJSON(tx.Bucket(orderBucket), order.ID, order); err != nil {
			return err
		}
		return tx.Bucket(ownerOrderBucket).Put([]byte(order.Owner+"\x00"+order.ID), []byte(order.ID))
	})
}

func (s *Store) Order(id string) (Order, error) {
	var order Order
	err := s.db.View(func(tx *bolt.Tx) error { return readOrder(tx, id, &order) })
	return order, err
}

func readOrder(tx *bolt.Tx, id string, order *Order) error {
	data := tx.Bucket(orderBucket).Get([]byte(id))
	if data == nil {
		return ErrNotFound
	}
	if err := json.Unmarshal(data, order); err != nil {
		return fmt.Errorf("read payment order: %w", err)
	}
	return nil
}

func (s *Store) CompleteOrder(id, capture string) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		var order Order
		if err := readOrder(tx, id, &order); err != nil {
			return err
		}
		if order.CaptureID == capture {
			return nil
		}
		if tx.Bucket(captureBucket).Get([]byte("blocked:"+capture)) != nil {
			return fmt.Errorf("payment reversal requires reconciliation")
		}
		if order.CaptureID != "" || tx.Bucket(captureBucket).Get([]byte(capture)) != nil {
			return fmt.Errorf("payment was already credited")
		}
		account, err := loadAccount(tx, order.Owner)
		if err != nil {
			return err
		}
		if err := s.renewAccount(tx, order.Owner, &account, false); err != nil {
			return err
		}
		units := order.Credits * UnitsPerCredit
		if units < 0 || (units == 0 && order.MembershipDays == 0) || account.Purchased > 1<<60-units {
			return fmt.Errorf("credit balance exceeds accounting limits")
		}
		account.Purchased += units
		account.payDebt()
		order.CaptureID = capture
		order.CompletedAt = s.now().UTC()
		if err := putJSON(tx.Bucket(accountBucket), order.Owner, account); err != nil {
			return err
		}
		if err := tx.Bucket(captureBucket).Put([]byte(capture), []byte(id)); err != nil {
			return err
		}
		return putJSON(tx.Bucket(orderBucket), id, order)
	})
}

func (s *Store) CapturedOrder(capture string) (Order, error) {
	var order Order
	err := s.db.View(func(tx *bolt.Tx) error {
		id := tx.Bucket(captureBucket).Get([]byte(capture))
		if id == nil {
			return ErrNotFound
		}
		return readOrder(tx, string(id), &order)
	})
	return order, err
}

func (s *Store) ReverseCapture(capture, adjustment string, units int64) error {
	if units < 0 {
		return fmt.Errorf("invalid payment reversal")
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket(captureBucket)
		key := []byte("adjustment:" + adjustment)
		if bucket.Get(key) != nil {
			return nil
		}
		id := bucket.Get([]byte(capture))
		if id == nil {
			return ErrNotFound
		}
		var order Order
		if err := readOrder(tx, string(id), &order); err != nil {
			return err
		}
		units = min(units, order.Credits*UnitsPerCredit-order.Reversed)
		account, err := loadAccount(tx, order.Owner)
		if err != nil {
			return err
		}
		purchased := min(account.Purchased, units)
		account.Purchased -= purchased
		remaining := units - purchased
		account.Debt += remaining
		account.payDebt()
		order.Reversed += units
		order.PaymentReversed = true
		if err := putJSON(tx.Bucket(accountBucket), order.Owner, account); err != nil {
			return err
		}
		if err := putJSON(tx.Bucket(orderBucket), order.ID, order); err != nil {
			return err
		}
		return bucket.Put(key, []byte(order.ID))
	})
}

func (s *Store) BlockCapture(capture string) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket(captureBucket).Put([]byte("blocked:"+capture), []byte("reversed before grant"))
	})
}
