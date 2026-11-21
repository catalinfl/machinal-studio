package sceneworker

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNodeWorkerLifecycle(t *testing.T) {
	if os.Getenv("SCENE_WORKER_INTEGRATION") != "1" {
		t.Skip("set SCENE_WORKER_INTEGRATION=1 to test spawning a real Node worker on loopback ports 8091/8092")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	script, err := filepath.Abs("testdata/worker.mjs")
	if err != nil {
		t.Fatal(err)
	}
	// Never talk to an existing worker or interfere with local development.
	for _, addr := range []string{serviceAddress, workerAddress} {
		listener, err := net.Listen("tcp", addr)
		if err != nil {
			t.Fatalf("integration test needs an unused %s: %v", addr, err)
		}
		listener.Close()
	}
	t.Setenv("SCENE_WORKER_NODE", node)
	t.Setenv("SCENE_WORKER_SCRIPT", script)
	t.Setenv("SCENE_WORKER_IDLE_TIMEOUT", "1s")
	t.Setenv("SCENE_SERVICE_URL", "http://"+serviceAddress)
	t.Setenv("SCENE_SERVICE_TOKEN", "integration-only-token")
	s, err := StartFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if s.manager.current != nil {
		t.Fatal("starting the API eagerly started Node")
	}
	firstPID := callWorker(t, "/compile")
	w := currentWorker(s)
	if firstPID == 0 || w == nil {
		t.Fatal("first request did not start Node")
	}
	// This operation exceeds the idle timeout, but must finish on the same worker.
	if pid := callWorker(t, "/render"); pid != firstPID {
		t.Fatal("active request was interrupted or moved to another worker")
	}
	awaitClosed(t, w.done)
	nextPID := callWorker(t, "/text")
	if nextPID == 0 || nextPID == firstPID {
		t.Fatal("request after idle shutdown did not start a new Node process")
	}
	next := currentWorker(s)
	s.Close()
	awaitClosed(t, next.done)
}

func currentWorker(s *Service) *worker {
	s.manager.mu.Lock()
	defer s.manager.mu.Unlock()
	return s.manager.current
}

func callWorker(t *testing.T, path string) int {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, "http://"+serviceAddress+path, strings.NewReader("test payload"))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer integration-only-token")
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(response.Body)
		t.Fatalf("worker request: HTTP %d %s", response.StatusCode, data)
	}
	var result struct {
		PID     int    `json:"pid"`
		Route   string `json:"route"`
		Payload string `json:"payload"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Route != path || result.Payload != "test payload" {
		t.Fatalf("worker received the wrong request: %+v", result)
	}
	return result.PID
}
