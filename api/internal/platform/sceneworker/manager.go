package sceneworker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

var errUnavailable = errors.New("scene worker is unavailable")

// Bound idle cache I/O so the next cold request does not wait for a full disk scan.
const reclaimTimeout = 2 * time.Second

type worker struct {
	ready    chan struct{}
	done     chan struct{}
	readyErr error
	stop     func()
	active   int
	stopping atomic.Bool
}

type manager struct {
	mu       sync.Mutex
	start    func() (*worker, error)
	reclaim  func(context.Context)
	idle     time.Duration
	current  *worker
	timer    *time.Timer
	closed   bool
	epoch    uint64
	retiring chan struct{}
}

func (m *manager) acquire(ctx context.Context, wake bool) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	w, err := m.acquireWorker(ctx, wake)
	if err != nil {
		return nil, err
	}
	release := sync.OnceFunc(func() { m.release(w) })
	select {
	case <-ctx.Done():
		release()
		return nil, ctx.Err()
	case <-w.ready:
		if w.readyErr != nil {
			release()
			return nil, w.readyErr
		}
		return release, nil
	}
}

func (m *manager) acquireWorker(ctx context.Context, wake bool) (*worker, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		m.mu.Lock()
		if m.current != nil {
			select {
			case <-m.current.done:
				m.retire(m.current)
			default:
			}
		}
		pending := m.retiring
		if pending == nil || m.closed {
			w, err := m.reserve(wake)
			m.mu.Unlock()
			return w, err
		}
		m.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-pending:
		}
	}
}

// reserve runs under mu so simultaneous cold requests cannot start two workers.
func (m *manager) reserve(wake bool) (*worker, error) {
	if m.closed {
		return nil, errUnavailable
	}
	if m.current == nil {
		if !wake {
			return nil, errUnavailable
		}
		w, err := m.start()
		if err != nil {
			return nil, err
		}
		m.current = w
	}
	if m.timer != nil {
		m.timer.Stop()
	}
	m.epoch++
	m.current.active++
	return m.current, nil
}

func (m *manager) release(w *worker) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w.active--
	if m.current != w || w.active != 0 || m.closed {
		return
	}
	m.epoch++
	epoch := m.epoch
	m.timer = time.AfterFunc(m.idle, func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.current == w && w.active == 0 && m.epoch == epoch && !m.closed {
			m.retire(w)
		}
	})
}

// retire runs under mu; acquisition waits without holding mu until cleanup ends.
func (m *manager) retire(w *worker) {
	m.current = nil
	m.epoch++
	if m.timer != nil {
		m.timer.Stop()
	}
	pending := make(chan struct{})
	m.retiring = pending
	go func() {
		w.stop()
		if m.reclaim != nil {
			ctx, cancel := context.WithTimeout(context.Background(), reclaimTimeout)
			m.reclaim(ctx)
			cancel()
		}
		m.mu.Lock()
		m.retiring = nil
		close(pending)
		m.mu.Unlock()
	}()
}

func (m *manager) close() {
	m.mu.Lock()
	m.closed = true
	if m.timer != nil {
		m.timer.Stop()
	}
	if m.current != nil {
		m.retire(m.current)
	}
	pending := m.retiring
	m.mu.Unlock()
	if pending != nil {
		<-pending
	}
}
