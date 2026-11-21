package projects

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestProjectOpenMemoryOverRealHTTP(t *testing.T) {
	if testing.Short() {
		t.Skip("loopback load test")
	}
	useProjectDataDir(t)
	store, project := projectWithLargeState(t)
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Get("/projects/:projectID", func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice"); return c.Next() }, store.GetHandler)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	served := make(chan error, 1)
	go func() { served <- app.Listener(listener) }()
	t.Cleanup(func() {
		if err := app.ShutdownWithTimeout(5 * time.Second); err != nil {
			t.Error(err)
		}
		if err := <-served; err != nil {
			t.Error(err)
		}
	})
	transport := &http.Transport{MaxIdleConns: 100, MaxIdleConnsPerHost: 100}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second}
	url := "http://" + listener.Addr().String() + "/projects/" + project.ID
	for _, parallel := range []bool{false, true} {
		t.Run(fmt.Sprintf("100_opens_parallel=%t", parallel), func(t *testing.T) {
			runtime.GC()
			var before, after, idle runtime.MemStats
			runtime.ReadMemStats(&before)
			errors := make(chan error, 100)
			var wait sync.WaitGroup
			open := func() {
				defer wait.Done()
				response, err := client.Get(url)
				if err != nil {
					errors <- err
					return
				}
				defer response.Body.Close()
				count, err := io.Copy(io.Discard, response.Body)
				if err != nil || response.StatusCode != 200 || count < int64(len(project.State)) {
					errors <- fmt.Errorf("incomplete response: status=%d bytes=%d err=%v", response.StatusCode, count, err)
				}
			}
			for range 100 {
				wait.Add(1)
				if parallel {
					go open()
				} else {
					open()
				}
			}
			wait.Wait()
			close(errors)
			for err := range errors {
				t.Error(err)
			}
			runtime.ReadMemStats(&after)
			runtime.GC()
			runtime.ReadMemStats(&idle)
			allocated := after.TotalAlloc - before.TotalAlloc
			t.Logf("100 x 8 MiB, client+server in one process: total allocations %.2f MiB; heap before %.2f, after %.2f, after GC %.2f MiB",
				float64(allocated)/(1<<20), float64(before.HeapAlloc)/(1<<20), float64(after.HeapAlloc)/(1<<20), float64(idle.HeapAlloc)/(1<<20))
			// Buffering every response would allocate at least 800 MiB in this fixture.
			if allocated > 200<<20 {
				t.Fatalf("project reads allocate proportional to payload: %d bytes", allocated)
			}
		})
	}
}
