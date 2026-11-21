package credits

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	bolt "go.etcd.io/bbolt"
)

const UnitsPerCredit int64 = 1_000_000
const MonthlyAllowance int64 = 1_000 * UnitsPerCredit

var (
	ErrInsufficient  = errors.New("not enough credits")
	ErrBusy          = errors.New("this credit operation already exists")
	ErrPending       = errors.New("provider usage is awaiting reconciliation")
	ErrNotFound      = errors.New("credit operation not found")
	accountBucket    = []byte("accounts")
	orderBucket      = []byte("orders")
	captureBucket    = []byte("captures")
	ownerOrderBucket = []byte("owner-orders")
)

type Store struct {
	db  *bolt.DB
	now func() time.Time
}

type Account struct {
	Month        string                  `json:"month"`
	Granted      bool                    `json:"granted"`
	Monthly      int64                   `json:"monthly"`
	Purchased    int64                   `json:"purchased"`
	Debt         int64                   `json:"debt"`
	AllowanceEnd time.Time               `json:"allowanceEnd,omitempty"`
	Active       *Reservation            `json:"active,omitempty"`
	Operations   map[string]*Reservation `json:"operations,omitempty"`
}

type Reservation struct {
	ID          string                 `json:"id"`
	Month       string                 `json:"month"`
	Monthly     int64                  `json:"monthly"`
	Purchased   int64                  `json:"purchased"`
	Spent       int64                  `json:"spent"`
	Render      int64                  `json:"render"`
	SceneRender int64                  `json:"sceneRender,omitempty"`
	Attempts    map[string]bool        `json:"attempts"`
	Events      map[string]bool        `json:"events"`
	StartedAt   time.Time              `json:"startedAt"`
	Generations map[string]string      `json:"generations,omitempty"`
	Minimums    map[string]int64       `json:"minimums,omitempty"`
	RenderUsage map[string]RenderUsage `json:"renderUsage,omitempty"`
	AIPricing   *AIPricing             `json:"aiPricing,omitempty"`
}

type Balance struct {
	MonthlyAllowance   float64   `json:"monthlyAllowance"`
	MonthlyRemaining   float64   `json:"monthlyRemaining"`
	PurchasedRemaining float64   `json:"purchasedRemaining"`
	Remaining          float64   `json:"remaining"`
	Reserved           float64   `json:"reserved"`
	Debt               float64   `json:"debt"`
	NextReset          time.Time `json:"nextReset"`
	Pro                bool      `json:"pro"`
	UsagePending       bool      `json:"usagePending"`
	AllowancePeriod    string    `json:"allowancePeriod"`
}

func Open(path string, now func() time.Time) (*Store, error) {
	db, err := bolt.Open(path, 0600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, fmt.Errorf("open credit ledger: %w", err)
	}
	err = db.Update(func(tx *bolt.Tx) error {
		for _, name := range [][]byte{accountBucket, orderBucket, captureBucket, ownerOrderBucket} {
			if _, err := tx.CreateBucketIfNotExists(name); err != nil {
				return err
			}
		}
		return tx.Bucket(orderBucket).ForEach(func(key, value []byte) error {
			var order Order
			if err := json.Unmarshal(value, &order); err != nil {
				return fmt.Errorf("index payment order: %w", err)
			}
			return tx.Bucket(ownerOrderBucket).Put([]byte(order.Owner+"\x00"+string(key)), key)
		})
	})
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize credit ledger: %w", err)
	}
	store := &Store{db: db, now: now}
	if err := store.recoverInterrupted(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) update(owner string, paid bool, change func(*Account) error) error {
	if owner == "" {
		return ErrNotFound
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		account, err := loadAccount(tx, owner)
		if err != nil {
			return err
		}
		if err := s.renewAccount(tx, owner, &account, paid); err != nil {
			return err
		}
		if err := change(&account); err != nil {
			return err
		}
		return putJSON(tx.Bucket(accountBucket), owner, account)
	})
}

func loadAccount(tx *bolt.Tx, owner string) (Account, error) {
	var account Account
	if data := tx.Bucket(accountBucket).Get([]byte(owner)); data != nil {
		if err := json.Unmarshal(data, &account); err != nil {
			return account, fmt.Errorf("read credit account: %w", err)
		}
	}
	account.releaseLegacyHold()
	return account, nil
}

func (a *Account) releaseLegacyHold() {
	if a.Active == nil {
		return
	}
	// Older ledgers moved the entire wallet into Active; restore it once without losing usage.
	if a.Month == a.Active.Month {
		a.Monthly += a.Active.Monthly
	}
	a.Purchased += a.Active.Purchased
	if a.Operations == nil {
		a.Operations = make(map[string]*Reservation)
	}
	a.Operations[a.Active.ID] = a.Active
	a.Active = nil
}

func putJSON(bucket *bolt.Bucket, key string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode credit record: %w", err)
	}
	if err := bucket.Put([]byte(key), data); err != nil {
		return fmt.Errorf("save credit record: %w", err)
	}
	return nil
}

func (a *Account) renew(now time.Time, paid bool) {
	month := now.UTC().Format("2006-01")
	if a.Month != month {
		a.Month, a.Monthly, a.Granted = month, 0, false
	}
	if paid && !a.Granted {
		a.Monthly, a.Granted = MonthlyAllowance, true
	}
	a.payDebt()
}

func (a *Account) payDebt() {
	monthly := min(a.Monthly, a.Debt)
	a.Monthly, a.Debt = a.Monthly-monthly, a.Debt-monthly
	purchased := min(a.Purchased, a.Debt)
	a.Purchased, a.Debt = a.Purchased-purchased, a.Debt-purchased
}

func (s *Store) Balance(owner string, paid bool) (Balance, error) {
	var result Balance
	err := s.update(owner, paid, func(a *Account) error {
		now := s.now().UTC()
		result = Balance{Pro: paid, PurchasedRemaining: number(a.Purchased), Debt: number(a.Debt),
			NextReset: time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC), AllowancePeriod: "calendar-month"}
		if !a.AllowanceEnd.IsZero() {
			result.NextReset, result.AllowancePeriod = a.AllowanceEnd, "prepaid-30-day"
		}
		if paid {
			result.MonthlyAllowance, result.MonthlyRemaining = number(MonthlyAllowance), number(a.Monthly)
		}
		result.Remaining = result.MonthlyRemaining + result.PurchasedRemaining
		for _, operation := range a.Operations {
			result.UsagePending = result.UsagePending || len(operation.Attempts) > 0
		}
		return nil
	})
	return result, err
}

func number(units int64) float64 { return float64(units) / float64(UnitsPerCredit) }

func (s *Store) Begin(owner, id string, paid bool) error {
	if id == "" {
		return ErrNotFound
	}
	return s.update(owner, paid, func(a *Account) error {
		if a.Operations[id] != nil {
			return ErrBusy
		}
		if !paid || a.Monthly+a.Purchased <= 0 || a.Debt > 0 {
			return ErrInsufficient
		}
		if a.Operations == nil {
			a.Operations = make(map[string]*Reservation)
		}
		a.Operations[id] = &Reservation{ID: id, Month: a.Month,
			Attempts: map[string]bool{}, Events: map[string]bool{}, StartedAt: s.now().UTC()}
		return nil
	})
}

func (s *Store) reservation(owner, id string, change func(*Reservation) error) error {
	return s.update(owner, false, func(a *Account) error {
		operation := a.Operations[id]
		if operation == nil {
			return ErrNotFound
		}
		return change(operation)
	})
}

func (s *Store) StartAttempt(owner, id, attempt string) error {
	return s.startAttempt(owner, id, attempt, false)
}

func (s *Store) startAttempt(owner, id, attempt string, allowPending bool) error {
	return s.startAttemptWithMinimum(owner, id, attempt, allowPending, 0)
}

func (s *Store) startAttemptWithMinimum(owner, id, attempt string, allowPending bool, minimum int64) error {
	return s.startAttemptWithPricing(owner, id, attempt, allowPending, minimum, nil)
}

func (s *Store) startAttemptWithPricing(owner, id, attempt string, allowPending bool, minimum int64, pricing *AIPricing) error {
	if minimum < 0 || minimum > MinimumAudioCredits*UnitsPerCredit {
		return fmt.Errorf("invalid provider minimum")
	}
	return s.reservation(owner, id, func(r *Reservation) error {
		if len(r.Attempts) > 0 && !allowPending {
			return ErrPending
		}
		r.Attempts[attempt] = true
		if r.AIPricing == nil && pricing != nil {
			r.AIPricing = pricing
		}
		if minimum > 0 {
			if r.Minimums == nil {
				r.Minimums = make(map[string]int64)
			}
			// Usage can be reconciled without the original request context after a restart.
			r.Minimums[attempt] = minimum
		}
		return nil
	})
}

func (s *Store) NoteGeneration(owner, id, attempt, generation string) error {
	if len(generation) > 256 {
		return fmt.Errorf("invalid provider generation reference")
	}
	return s.reservation(owner, id, func(r *Reservation) error {
		if !r.Attempts[attempt] {
			return ErrNotFound
		}
		if r.Generations == nil {
			r.Generations = map[string]string{}
		}
		r.Generations[attempt] = generation
		return nil
	})
}

func (s *Store) ResolveAttempt(owner, id, attempt, event string, units int64) error {
	if units < 0 || units > 1<<60 {
		return fmt.Errorf("negative usage")
	}
	return s.reservation(owner, id, func(r *Reservation) error {
		if !r.Attempts[attempt] {
			return ErrNotFound
		}
		if r.Spent > 1<<60-units {
			return fmt.Errorf("usage exceeds accounting limits")
		}
		if !r.Events[event] {
			r.Spent += units
			r.Events[event] = true
		}
		delete(r.Attempts, attempt)
		delete(r.Minimums, attempt)
		return nil
	})
}

func (s *Store) ChargeRender(owner, id string, units int64) error {
	return s.chargeRender(owner, id, units, nil)
}

func (s *Store) chargeRender(owner, id string, units int64, usage *RenderUsage) error {
	return s.reservation(owner, id, func(r *Reservation) error {
		if units < 0 || units > 1<<60 || r.Spent > 1<<60-units {
			return fmt.Errorf("render usage exceeds accounting limits")
		}
		if !r.Events["render"] {
			r.Spent += units
			r.Render = units
			r.Events["render"] = true
			r.recordRenderUsage("render", usage)
		}
		return nil
	})
}

func (s *Store) ChargeSceneRender(owner, id, scene string, units int64) error {
	return s.chargeSceneRender(owner, id, scene, units, nil)
}

func (s *Store) chargeSceneRender(owner, id, scene string, units int64, usage *RenderUsage) error {
	if scene == "" || len(scene) > 255 {
		return fmt.Errorf("invalid scene render reference")
	}
	return s.reservation(owner, id, func(r *Reservation) error {
		event := "scene-render:" + scene
		if r.Events[event] {
			return nil
		}
		if units < 0 || units > 1<<60 || r.Spent > 1<<60-units || r.SceneRender > 1<<60-units {
			return fmt.Errorf("scene render usage exceeds accounting limits")
		}
		r.Spent += units
		r.SceneRender += units
		r.Events[event] = true
		r.recordRenderUsage(event, usage)
		return nil
	})
}

func (s *Store) Finish(owner, id string) error {
	return s.update(owner, false, func(a *Account) error {
		r := a.Operations[id]
		if r == nil {
			return ErrNotFound
		}
		if len(r.Attempts) > 0 {
			return ErrPending
		}
		settle(a, r)
		return nil
	})
}

func settle(a *Account, r *Reservation) {
	monthlySpent := min(r.Spent, a.Monthly)
	purchasedSpent := min(r.Spent-monthlySpent, a.Purchased)
	a.Monthly -= monthlySpent
	a.Purchased -= purchasedSpent
	a.Debt += r.Spent - monthlySpent - purchasedSpent
	delete(a.Operations, r.ID)
	a.payDebt()
}

func (s *Store) recoverInterrupted() error {
	return s.db.Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket(accountBucket)
		var owners []string
		if err := bucket.ForEach(func(key, _ []byte) error { owners = append(owners, string(key)); return nil }); err != nil {
			return err
		}
		for _, owner := range owners {
			account, err := loadAccount(tx, owner)
			if err != nil {
				return err
			}
			if err := s.renewAccount(tx, owner, &account, false); err != nil {
				return err
			}
			for _, operation := range account.Operations {
				if len(operation.Attempts) > 0 {
					if err := preserveLegacyPricing(operation); err != nil {
						return err
					}
					continue
				}
				// The exclusive database lock proves no previous render worker is still running.
				operation.Spent -= operation.Render
				settle(&account, operation)
			}
			if err := putJSON(bucket, owner, account); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) Pending(owner string) (*Reservation, error) {
	var result *Reservation
	err := s.db.View(func(tx *bolt.Tx) error {
		account, err := loadAccount(tx, owner)
		if err != nil {
			return err
		}
		for _, operation := range account.Operations {
			if result == nil || operation.StartedAt.Before(result.StartedAt) ||
				(operation.StartedAt.Equal(result.StartedAt) && operation.ID < result.ID) {
				result = operation
			}
		}
		return nil
	})
	return result, err
}

func (s *Store) Operation(owner, id string) (*Reservation, error) {
	var result *Reservation
	err := s.db.View(func(tx *bolt.Tx) error {
		account, err := loadAccount(tx, owner)
		if err != nil {
			return err
		}
		result = account.Operations[id]
		return nil
	})
	return result, err
}

func (s *Store) RefundRender(owner, id string) error {
	return s.reservation(owner, id, func(r *Reservation) error {
		if r.Events["render"] {
			r.Spent -= r.Render
			r.Render = 0
			delete(r.Events, "render")
			delete(r.RenderUsage, "render")
		}
		return nil
	})
}
