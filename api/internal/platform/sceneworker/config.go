package sceneworker

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	serviceAddress = "127.0.0.1:8091"
	workerAddress  = "127.0.0.1:8092"
	workerURL      = "http://" + workerAddress
	startupTimeout = 90 * time.Second
	defaultIdle    = time.Minute
)

type config struct {
	node   string
	script string
	token  string
	idle   time.Duration
}

func configFromEnv() (config, error) {
	c := config{
		node:   strings.TrimSpace(os.Getenv("SCENE_WORKER_NODE")),
		script: strings.TrimSpace(os.Getenv("SCENE_WORKER_SCRIPT")),
		token:  os.Getenv("SCENE_SERVICE_TOKEN"),
		idle:   defaultIdle,
	}
	if c.script == "" {
		return c, nil
	}
	if strings.TrimRight(os.Getenv("SCENE_SERVICE_URL"), "/") != "http://"+serviceAddress {
		return c, fmt.Errorf("managed scene worker requires SCENE_SERVICE_URL=http://%s", serviceAddress)
	}
	if strings.TrimSpace(c.token) == "" {
		return c, fmt.Errorf("managed scene worker requires SCENE_SERVICE_TOKEN")
	}
	if !filepath.IsAbs(c.script) || !filepath.IsAbs(c.node) {
		return c, fmt.Errorf("SCENE_WORKER_SCRIPT and SCENE_WORKER_NODE must be absolute paths")
	}
	for _, path := range []string{c.script, c.node} {
		info, err := os.Stat(path)
		if err != nil {
			return c, fmt.Errorf("stat scene worker file: %w", err)
		}
		if !info.Mode().IsRegular() {
			return c, fmt.Errorf("scene worker paths must be regular files")
		}
	}
	if value := strings.TrimSpace(os.Getenv("SCENE_WORKER_IDLE_TIMEOUT")); value != "" {
		idle, err := time.ParseDuration(value)
		if err != nil || idle < time.Second || idle > time.Hour {
			return c, fmt.Errorf("SCENE_WORKER_IDLE_TIMEOUT must be between 1s and 1h")
		}
		c.idle = idle
	}
	return c, nil
}
