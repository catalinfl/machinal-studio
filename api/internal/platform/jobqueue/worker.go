package jobqueue

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/sessions"
)

const (
	defaultWorkers            = 2
	defaultPollInterval       = time.Second
	defaultHeartbeat          = 5 * time.Second
	defaultJobTimeout         = 2 * time.Hour
	storeTimeout              = 10 * time.Second
	workerFailureBackoff      = 15 * time.Second
	workspaceRefresh          = 20 * time.Second
	leaseFailureGrace         = 30 * time.Second
	maxConcurrentWaits        = 64
	defaultStatusPollInterval = 5 * time.Second
)

type Service struct {
	Store         Repository
	Tasks         map[string]Task
	Options       Options
	cancel        context.CancelFunc
	wg            sync.WaitGroup
	waiters       chan struct{}
	watchMu       sync.Mutex
	watches       map[string]*jobWatch
	timingMu      sync.Mutex
	started       map[string]time.Time
	durations     map[string][]time.Duration
	historyLoaded map[string]bool
	inventory     []Job
}

func New(store Repository, tasks map[string]Task, options Options) *Service {
	if options.Workers <= 0 {
		options.Workers = defaultWorkers
	}
	if options.PollInterval <= 0 {
		options.PollInterval = defaultPollInterval
	}
	if options.Heartbeat <= 0 {
		options.Heartbeat = defaultHeartbeat
	}
	if options.Timeout <= 0 {
		options.Timeout = defaultJobTimeout
	}
	if options.StatusPollInterval <= 0 {
		options.StatusPollInterval = defaultStatusPollInterval
	}
	return &Service{Store: store, Tasks: tasks, Options: options, waiters: make(chan struct{}, maxConcurrentWaits),
		watches: make(map[string]*jobWatch), started: make(map[string]time.Time), durations: make(map[string][]time.Duration), historyLoaded: make(map[string]bool)}
}

func randomID() (string, error) {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", fmt.Errorf("generate job reference: %w", err)
	}
	return hex.EncodeToString(data[:]), nil
}

func (s *Service) Start(ctx context.Context) {
	ctx, s.cancel = context.WithCancel(ctx)
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.protectWorkspaces(ctx)
	}()
	for range s.Options.Workers {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.work(ctx)
		}()
	}
}

func (s *Service) protectWorkspaces(ctx context.Context) {
	for ctx.Err() == nil {
		jobs, err := s.Store.Active(ctx)
		if err == nil {
			s.setInventory(jobs)
			ids := make([]string, 0, len(jobs))
			for _, job := range jobs {
				ids = append(ids, job.Session)
				if _, err := sessions.TouchOwned(job.Session, job.Owner); err != nil {
					log.Printf("protect job workspace: %v", err)
				}
			}
			sessions.SetJobSessions(ids)
			cleanPayloads(jobs)
		}
		// On an outage, retain the last known protection set rather than
		// evicting media that a queued or running job still needs.
		if !sleep(ctx, workspaceRefresh) {
			return
		}
	}
}

func (s *Service) Close() error {
	if s.cancel != nil {
		s.cancel()
	}
	s.wg.Wait()
	return nil
}

func sleep(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (s *Service) work(ctx context.Context) {
	for ctx.Err() == nil {
		lease, err := randomID()
		if err != nil {
			log.Printf("job worker: %v", err)
			return
		}
		job, err := s.Store.Claim(ctx, lease)
		if err == nil && job != nil {
			s.execute(ctx, *job)
			continue
		}
		if err != nil && ctx.Err() == nil {
			log.Printf("job queue unavailable: %v", err)
			if !sleep(ctx, workerFailureBackoff) {
				return
			}
		} else if !sleep(ctx, s.Options.PollInterval) {
			return
		}
	}
}

func failure(status int, message string) Result {
	body, _ := json.Marshal(message)
	return Result{StatusCode: status, ContentType: "text/plain", Body: body}
}

func (s *Service) execute(parent context.Context, claimed Job) {
	release := sessions.UseWorkspace(claimed.Session)
	defer release()
	job, err := s.Store.Start(parent, claimed)
	if err != nil {
		return
	}
	job.Input = claimed.Input
	s.loadTimingHistory(parent, job)
	s.beginTiming(job)
	s.notifyJob(job.ID)
	ctx, cancel := context.WithTimeout(parent, s.Options.Timeout)
	defer cancel()
	var mu sync.Mutex
	latest := Update{Message: "Processing"}
	tracker := stageTracker{}
	trackStages := isRenderKind(job.Kind)
	report := func(update Update) {
		mu.Lock()
		defer mu.Unlock()
		if trackStages {
			update = tracker.update(update, time.Now(), false)
		}
		latest = update
		latest.Snapshot = append(json.RawMessage(nil), update.Snapshot...)
	}
	ctx = context.WithValue(ctx, reporterKey{}, report)
	ctx = context.WithValue(ctx, identityKey{}, job.ID)
	stopHeartbeat := make(chan struct{})
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		s.keepLease(parent, job, func() Update {
			mu.Lock()
			defer mu.Unlock()
			return latest
		}, cancel, stopHeartbeat)
	}()
	result := s.run(ctx, job)
	if ctx.Err() != nil {
		result = failure(408, "The job was interrupted or exceeded its time limit. Check existing results before submitting again.")
	}
	s.endTiming(job, result.StatusCode >= 200 && result.StatusCode < 300)
	mu.Lock()
	if trackStages {
		latest = tracker.update(latest, time.Now(), true)
	}
	result.Snapshot = append(json.RawMessage(nil), latest.Snapshot...)
	mu.Unlock()
	// A failed status write must never cause the expensive task to run a second time.
	for {
		writeCtx, writeCancel := context.WithTimeout(context.Background(), storeTimeout)
		err = s.Store.Finish(writeCtx, job, result)
		writeCancel()
		if err == nil || errors.Is(err, ErrLeaseLost) || errors.Is(err, ErrNotFound) {
			if err == nil {
				removePayload(job.ID)
				s.notifyJob(job.ID)
			}
			break
		}
		log.Printf("save result of job %s: %v", job.ID, err)
		if !sleep(parent, s.Options.PollInterval) {
			break
		}
	}
	close(stopHeartbeat)
	<-heartbeatDone
}

func (s *Service) run(ctx context.Context, job Job) (result Result) {
	if s.Options.Local {
		ctx = credits.WithLocalExecution(ctx)
		job.Input.Billed = false
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("job %s panicked: %v", job.ID, recovered)
			result = failure(500, "Processing failed. Check existing results before submitting again.")
		}
	}()
	if job.Kind == sceneQueueKind && job.Input.CreditPolicy == credits.MCPFree {
		return failure(400, "A free scene compilation cannot run the server AI scene generator. Check the stored compilation task metadata.")
	}
	task, ok := s.Tasks[job.Kind]
	if !ok {
		return failure(400, "This job type is not supported by the current server.")
	}
	if job.Input.CreditPolicy != "" {
		if job.Input.CreditPolicy != credits.MCPFree && job.Input.CreditPolicy != credits.MCPMediaOnly && job.Input.CreditPolicy != credits.MCPServerRender {
			return failure(400, "This job has an unsupported credit policy.")
		}
		ctx = credits.WithWorkflowPolicy(ctx, job.Input.CreditPolicy)
	}
	// Older queued MCP renders may contain the superseded free-render policy.
	if credits.IsMCPWorkflow(ctx) && isRenderKind(job.Kind) {
		job.Input.CreditPolicy, job.Input.Billed = credits.MCPServerRender, true
		ctx = credits.WithWorkflowPolicy(ctx, credits.MCPServerRender)
	}
	if s.Options.Prepare != nil {
		prepared, finish, err := s.Options.Prepare(ctx, job)
		if err != nil {
			return failure(402, "The job could not start. Check your subscription and credit balance.")
		}
		ctx = prepared
		defer finish()
	}
	result = task(ctx, job)
	if len(result.Body) > MaxResultBytes || !json.Valid(result.Body) {
		return failure(500, "The job produced an invalid or oversized result.")
	}
	return result
}

func (s *Service) keepLease(ctx context.Context, job Job, latest func() Update, cancel context.CancelFunc, stop <-chan struct{}) {
	ticker := time.NewTicker(s.Options.Heartbeat)
	defer ticker.Stop()
	lastSuccess := time.Now()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			pulseCtx, pulseCancel := context.WithTimeout(context.WithoutCancel(ctx), storeTimeout)
			current, err := s.Store.Heartbeat(pulseCtx, job, latest())
			pulseCancel()
			if errors.Is(err, ErrLeaseLost) || errors.Is(err, ErrNotFound) {
				cancel()
				return
			}
			if err == nil {
				s.notifyJob(job.ID)
				lastSuccess = time.Now()
				if current.CancelRequested {
					cancel()
				}
			} else if time.Since(lastSuccess) >= leaseFailureGrace {
				// Stop side effects before PocketBase's 90-second lease can expire.
				cancel()
			}
		}
	}
}
