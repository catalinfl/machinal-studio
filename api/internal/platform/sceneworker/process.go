package sceneworker

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	probeInterval = 100 * time.Millisecond
	probeTimeout  = 15 * time.Second
	stopTimeout   = 5 * time.Second
)

type healthError struct {
	status int
	code   string
}

func (e *healthError) Error() string {
	return fmt.Sprintf("scene worker health returned HTTP %d (%s)", e.status, e.code)
}

func startWorker(c config, transport *http.Transport) (*worker, error) {
	cmd := exec.Command(c.node, c.script)
	cmd.Dir = filepath.Dir(c.script)
	cmd.Env = workerEnvironment(os.Environ())
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	configureProcess(cmd)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start scene worker: %w", err)
	}
	log.Printf("scene_worker started pid=%d", cmd.Process.Pid)
	w := &worker{ready: make(chan struct{}), done: make(chan struct{})}
	ctx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	w.stop = sync.OnceFunc(func() {
		w.stopping.Store(true)
		cancel()
		transport.CloseIdleConnections()
		stopProcess(cmd, w.done)
		log.Printf("scene_worker stopped pid=%d", cmd.Process.Pid)
	})
	go func() {
		err := cmd.Wait()
		close(w.done)
		if err != nil && !w.stopping.Load() {
			log.Printf("scene_worker exited pid=%d: %v", cmd.Process.Pid, err)
		}
		w.stop()
	}()
	go func() {
		defer cancel()
		w.readyErr = waitForWorker(ctx, w.done, c.token, transport)
		if w.readyErr != nil {
			w.stop()
		}
		close(w.ready)
	}()
	return w, nil
}

func workerEnvironment(env []string) []string {
	result := make([]string, 0, len(env)+2)
	for _, value := range env {
		if key, _, _ := strings.Cut(value, "="); key != "PORT" && key != "SCENE_SERVICE_HOST" {
			result = append(result, value)
		}
	}
	return append(result, "PORT=8092", "SCENE_SERVICE_HOST=127.0.0.1")
}

func waitForWorker(ctx context.Context, done <-chan struct{}, token string, transport http.RoundTripper) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		select {
		case <-done:
			cancel()
		case <-ctx.Done():
		}
	}()
	client := &http.Client{
		Transport: transport,
		Timeout:   probeTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	ticker := time.NewTicker(probeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return errUnavailable
		case <-ctx.Done():
			return fmt.Errorf("wait for scene worker: %w", ctx.Err())
		default:
		}
		err := probeWorker(ctx, client, token)
		if err == nil {
			return nil
		}
		var unhealthy *healthError
		if errors.As(err, &unhealthy) {
			return err
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for scene worker: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func probeWorker(ctx context.Context, client *http.Client, token string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, workerURL+"/health", nil)
	if err != nil {
		return fmt.Errorf("build scene worker probe: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("probe scene worker: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return &healthError{status: response.StatusCode, code: infrastructureCode(response.Header.Get("X-Scene-Error-Code"))}
	}
	return nil
}

func infrastructureCode(code string) string {
	switch code {
	case "scene_renderer_permission_denied", "scene_renderer_unavailable", "scene_browser_unavailable", "scene_ffmpeg_unavailable":
		return code
	default:
		return ""
	}
}
