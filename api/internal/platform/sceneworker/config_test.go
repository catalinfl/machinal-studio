package sceneworker

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestExternalSceneServiceDoesNotStartManagedWorker(t *testing.T) {
	t.Setenv("SCENE_WORKER_SCRIPT", "")
	t.Setenv("SCENE_SERVICE_URL", "http://external-renderer:8091")
	s, err := StartFromEnv()
	if err != nil || s != nil {
		t.Fatalf("external renderer was changed: %v, %v", s, err)
	}
	s.Close()
}

func configureTestEnv(t *testing.T) {
	t.Helper()
	file := filepath.Join(t.TempDir(), "worker")
	if err := os.WriteFile(file, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SCENE_WORKER_NODE", file)
	t.Setenv("SCENE_WORKER_SCRIPT", file)
	t.Setenv("SCENE_SERVICE_URL", "http://"+serviceAddress)
	t.Setenv("SCENE_SERVICE_TOKEN", "test-secret")
	t.Setenv("SCENE_WORKER_IDLE_TIMEOUT", "")
}

func TestManagedWorkerConfig(t *testing.T) {
	configureTestEnv(t)
	c, err := configFromEnv()
	if err != nil || c.idle != time.Minute {
		t.Fatalf("invalid default configuration: %+v, %v", c, err)
	}
	t.Setenv("SCENE_WORKER_IDLE_TIMEOUT", "2m")
	c, err = configFromEnv()
	if err != nil || c.idle != 2*time.Minute {
		t.Fatalf("idle override was not applied: %v", err)
	}
}

func TestInvalidManagedWorkerConfig(t *testing.T) {
	for _, tc := range []struct{ key, value, diagnostic string }{
		{"SCENE_SERVICE_TOKEN", " ", "TOKEN"},
		{"SCENE_SERVICE_URL", "http://external:8091", "SERVICE_URL"},
		{"SCENE_WORKER_SCRIPT", "relative.mjs", "absolute paths"},
		{"SCENE_WORKER_NODE", "node", "absolute paths"},
		{"SCENE_WORKER_IDLE_TIMEOUT", "0s", "IDLE_TIMEOUT"},
		{"SCENE_WORKER_IDLE_TIMEOUT", "1ms", "IDLE_TIMEOUT"},
		{"SCENE_WORKER_IDLE_TIMEOUT", "2h", "IDLE_TIMEOUT"},
		{"SCENE_WORKER_IDLE_TIMEOUT", "invalid", "IDLE_TIMEOUT"},
	} {
		t.Run(tc.key+"="+tc.value, func(t *testing.T) {
			configureTestEnv(t)
			t.Setenv(tc.key, tc.value)
			if _, err := configFromEnv(); err == nil || !strings.Contains(err.Error(), tc.diagnostic) {
				t.Fatalf("want %q diagnostic, got %v", tc.diagnostic, err)
			}
		})
	}
}

func TestWorkerEnvironmentOverridesAPIPortWithoutLosingSecrets(t *testing.T) {
	env := workerEnvironment([]string{"PORT=8080", "SCENE_SERVICE_HOST=0.0.0.0", "SCENE_SERVICE_TOKEN=test-secret", "PATH=tools"})
	got := strings.Join(env, "\n")
	for _, expected := range []string{"PORT=8092", "SCENE_SERVICE_HOST=127.0.0.1", "SCENE_SERVICE_TOKEN=test-secret", "PATH=tools"} {
		if !strings.Contains(got, expected) {
			t.Fatalf("missing worker environment value %q", expected)
		}
	}
	if strings.Contains(got, "PORT=8080") || strings.Contains(got, "0.0.0.0") {
		t.Fatal("worker inherited the public API binding")
	}
}
