package sceneworker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

var errUnavailable = errors.New("scene worker is unavailable")

type worker struct {
	ready    chan struct{}
	done     chan struct{}
	readyErr error
	stop     func()
	active   int
	stopping atomic.Bool
}

type manager struct {
	mu      sync.Mutex
	start   func() (*worker, error)
	idle    time.Duration
	current *worker
	timer   *time.Timer
	closed  bool
	epoch   uint64
}

func (m *manager) acquire(ctx context.Context, wake bool) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.mu.Lock()
	w, err := m.reserve(wake)
	m.mu.Unlock()
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

// reserve runs under mu so simultaneous cold requests cannot start two workers.
func (m *manager) reserve(wake bool) (*worker, error) {
	if m.closed {
		return nil, errUnavailable
	}
	if m.current != nil {
		select {
		case <-m.current.done:
			m.current.stop()
			m.current = nil
		default:
		}
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
			// Keep the port reserved until the old process group has exited.
			w.stop()
			m.current = nil
		}
	})
}

func (m *manager) close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	if m.timer != nil {
		m.timer.Stop()
	}
	if m.current != nil {
		m.current.stop()
		m.current = nil
	}
}
