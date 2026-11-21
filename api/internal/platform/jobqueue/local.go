package jobqueue

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	bolt "go.etcd.io/bbolt"
)

var localJobsBucket = []byte("jobs")
var localKeysBucket = []byte("idempotency")

const maxLocalActiveJobs = 64

type Local struct {
	db  *bolt.DB
	now func() time.Time
}

func OpenLocal(path string, now func() time.Time) (*Local, error) {
	db, err := bolt.Open(path, 0600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, fmt.Errorf("open local job database (only one API instance is supported): %w", err)
	}
	store := &Local{db: db, now: now}
	if err := store.initialize(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Local) Close() error { return s.db.Close() }

func (s *Local) initialize() error {
	return s.db.Update(func(tx *bolt.Tx) error {
		for _, name := range [][]byte{localJobsBucket, localKeysBucket} {
			if _, err := tx.CreateBucketIfNotExists(name); err != nil {
				return fmt.Errorf("create local queue: %w", err)
			}
		}
		jobs, err := readLocalJobs(tx)
		if err != nil {
			return err
		}
		for _, job := range jobs {
			if job.Status != "running" && job.Status != "claimed" {
				continue
			}
			// A provider may have consumed this request before shutdown. Never replay it.
			job.Status, job.StatusCode = "failed", 408
			job.Message = "Interrupted by API restart. Inspect existing assets before resubmitting."
			job.Lease = ""
			if err := s.put(tx, job); err != nil {
				return err
			}
		}
		return nil
	})
}

func readLocalJobs(tx *bolt.Tx) ([]Job, error) {
	jobs := []Job{}
	err := tx.Bucket(localJobsBucket).ForEach(func(_, value []byte) error {
		var job Job
		if err := json.Unmarshal(value, &job); err != nil {
			return fmt.Errorf("decode local job: %w", err)
		}
		jobs = append(jobs, job)
		return nil
	})
	return jobs, err
}

func readLocalJob(tx *bolt.Tx, id string) (Job, error) {
	var job Job
	value := tx.Bucket(localJobsBucket).Get([]byte(id))
	if value == nil {
		return job, ErrNotFound
	}
	if err := json.Unmarshal(value, &job); err != nil {
		return job, fmt.Errorf("decode local job: %w", err)
	}
	return job, nil
}

func (s *Local) put(tx *bolt.Tx, job Job) error {
	job.Revision++
	job.UpdatedAt = s.now().UTC().Format(time.RFC3339Nano)
	data, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("encode local job: %w", err)
	}
	if err := tx.Bucket(localJobsBucket).Put([]byte(job.ID), data); err != nil {
		return fmt.Errorf("save local job: %w", err)
	}
	return nil
}

func (s *Local) Enqueue(ctx context.Context, job Job) (Job, error) {
	var result Job
	err := s.db.Update(func(tx *bolt.Tx) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		keys := tx.Bucket(localKeysBucket)
		if id := keys.Get([]byte(job.IdempotencyKey)); id != nil {
			existing, err := readLocalJob(tx, string(id))
			if err != nil {
				return err
			}
			if existing.Fingerprint != job.Fingerprint || existing.Owner != job.Owner || existing.Session != job.Session || existing.Kind != job.Kind {
				return &StoreError{Status: 409, Action: "enqueue"}
			}
			result = existing
			return nil
		}
		jobs, err := readLocalJobs(tx)
		if err != nil {
			return err
		}
		active := 0
		for _, existing := range jobs {
			if !jobTerminal(existing.Status) {
				active++
			}
		}
		if active >= maxLocalActiveJobs {
			return &StoreError{Status: 429, Action: "enqueue"}
		}
		job.Status, job.CreatedAt = "queued", s.now().UTC().Format(time.RFC3339Nano)
		if err := s.put(tx, job); err != nil {
			return err
		}
		if err := keys.Put([]byte(job.IdempotencyKey), []byte(job.ID)); err != nil {
			return fmt.Errorf("save local idempotency key: %w", err)
		}
		result, err = readLocalJob(tx, job.ID)
		return err
	})
	return result, err
}

func (s *Local) Get(ctx context.Context, owner, session, id string) (Job, error) {
	var result Job
	err := s.db.View(func(tx *bolt.Tx) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		var err error
		result, err = readLocalJob(tx, id)
		if err == nil && (result.Owner != owner || result.Session != session) {
			return ErrNotFound
		}
		return err
	})
	return result, err
}

func (s *Local) selectJobs(ctx context.Context, keep func(Job) bool) ([]Job, error) {
	result := []Job{}
	err := s.db.View(func(tx *bolt.Tx) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		jobs, err := readLocalJobs(tx)
		if err != nil {
			return err
		}
		for _, job := range jobs {
			if keep(job) {
				result = append(result, job)
			}
		}
		return nil
	})
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt > result[j].CreatedAt })
	return result, err
}

func (s *Local) List(ctx context.Context, owner, session string) ([]Job, error) {
	jobs, err := s.selectJobs(ctx, func(job Job) bool { return job.Owner == owner && job.Session == session })
	if len(jobs) > 100 {
		jobs = jobs[:100]
	}
	return jobs, err
}

func (s *Local) Active(ctx context.Context) ([]Job, error) {
	return s.selectJobs(ctx, func(job Job) bool { return !jobTerminal(job.Status) })
}

func (s *Local) Claim(ctx context.Context, lease string) (*Job, error) {
	var result *Job
	err := s.db.Update(func(tx *bolt.Tx) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		jobs, err := readLocalJobs(tx)
		if err != nil {
			return err
		}
		sort.Slice(jobs, func(i, j int) bool { return jobs[i].CreatedAt < jobs[j].CreatedAt })
		for _, job := range jobs {
			if job.Status != "queued" {
				continue
			}
			job.Status, job.Lease = "claimed", lease
			if err := s.put(tx, job); err != nil {
				return err
			}
			result = &job
			return nil
		}
		return nil
	})
	return result, err
}

func (s *Local) updateLease(ctx context.Context, job Job, update func(*Job)) (Job, error) {
	var result Job
	err := s.db.Update(func(tx *bolt.Tx) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		current, err := readLocalJob(tx, job.ID)
		if err != nil {
			return err
		}
		if current.Lease == "" || current.Lease != job.Lease || jobTerminal(current.Status) {
			return ErrLeaseLost
		}
		update(&current)
		if err := s.put(tx, current); err != nil {
			return err
		}
		result, err = readLocalJob(tx, job.ID)
		return err
	})
	return result, err
}

func (s *Local) Start(ctx context.Context, job Job) (Job, error) {
	return s.updateLease(ctx, job, func(current *Job) { current.Status = "running"; current.Attempts++ })
}

func (s *Local) Heartbeat(ctx context.Context, job Job, update Update) (Job, error) {
	return s.updateLease(ctx, job, func(current *Job) {
		current.Progress, current.Message = update.Progress, update.Message
		current.Snapshot = update.Snapshot
	})
}

func (s *Local) Finish(ctx context.Context, job Job, result Result) error {
	_, err := s.updateLease(ctx, job, func(current *Job) {
		current.Status = "completed"
		if result.StatusCode < 200 || result.StatusCode >= 300 {
			current.Status = "failed"
		}
		if current.CancelRequested {
			current.Status = "cancelled"
		}
		current.Result, current.Snapshot = result.Body, result.Snapshot
		current.StatusCode, current.ContentType = result.StatusCode, result.ContentType
		current.Progress, current.Lease = 1, ""
	})
	return err
}

func (s *Local) Cancel(ctx context.Context, owner, session, id string) (Job, error) {
	var result Job
	err := s.db.Update(func(tx *bolt.Tx) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		job, err := readLocalJob(tx, id)
		if err != nil {
			return err
		}
		if job.Owner != owner || job.Session != session {
			return ErrNotFound
		}
		if !jobTerminal(job.Status) {
			job.CancelRequested = true
			if job.Status == "queued" {
				job.Status = "cancelled"
			}
			if err := s.put(tx, job); err != nil {
				return err
			}
		}
		result, err = readLocalJob(tx, id)
		return err
	})
	return result, err
}

var _ Repository = (*Local)(nil)
