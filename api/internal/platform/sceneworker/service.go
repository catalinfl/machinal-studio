package sceneworker

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

const operationTimeout = 30 * time.Minute

type Service struct {
	server    *http.Server
	manager   *manager
	transport *http.Transport
}

// StartFromEnv is opt-in; externally hosted scene services keep their lifecycle.
func StartFromEnv() (*Service, error) {
	c, err := configFromEnv()
	if err != nil || c.script == "" {
		return nil, err
	}
	listener, err := net.Listen("tcp", serviceAddress)
	if err != nil {
		return nil, fmt.Errorf("listen for scene worker requests: %w", err)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.MaxConnsPerHost = 32
	m := &manager{idle: c.idle}
	m.start = func() (*worker, error) { return startWorker(c, transport) }
	s := &Service{manager: m, transport: transport}
	s.server = &http.Server{
		Handler:           workerHandler(m, c.token, transport),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       operationTimeout,
		WriteTimeout:      operationTimeout,
		IdleTimeout:       time.Minute,
	}
	go func() {
		if err := s.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("scene worker proxy: %v", err)
		}
	}()
	log.Printf("scene_worker on_demand idle_timeout=%s", c.idle)
	return s, nil
}

func (s *Service) Close() {
	if s == nil {
		return
	}
	if err := s.server.Close(); err != nil {
		log.Printf("close scene worker proxy: %v", err)
	}
	s.manager.close()
	s.transport.CloseIdleConnections()
}

func workerHandler(m *manager, token string, transport http.RoundTripper) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: workerAddress})
	proxy.Transport = transport
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("scene worker request failed: %v", err)
		http.Error(w, "Scene worker is unavailable", http.StatusServiceUnavailable)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		wake, allowed := workerRoute(r)
		if !allowed {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		release, err := m.acquire(r.Context(), wake)
		if err != nil {
			if !wake && errors.Is(err, errUnavailable) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Printf("scene worker startup: %v", err)
			var unhealthy *healthError
			if errors.As(err, &unhealthy) && unhealthy.code != "" {
				w.Header().Set("X-Scene-Error-Code", unhealthy.code)
			}
			http.Error(w, "Scene worker is unavailable", http.StatusServiceUnavailable)
			return
		}
		defer release()
		ctx, cancel := context.WithTimeout(r.Context(), operationTimeout)
		defer cancel()
		proxy.ServeHTTP(w, r.WithContext(ctx))
	})
}

func workerRoute(r *http.Request) (wake, allowed bool) {
	if r.Method == http.MethodGet {
		if r.URL.Path == "/health" {
			return true, true
		}
		return false, strings.HasPrefix(r.URL.Path, "/render-progress/")
	}
	if r.Method == http.MethodPost {
		switch r.URL.Path {
		case "/compile", "/render", "/text", "/inspect":
			return true, true
		}
	}
	return false, false
}
