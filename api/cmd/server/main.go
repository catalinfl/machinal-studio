package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ffmpeg-go-server/internal/api"
	"ffmpeg-go-server/internal/platform/sceneworker"
)

// defaultPort serves local development when PORT is unset. Production
// platforms (notably Fly) always inject PORT explicitly.
const defaultPort = "8080"

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
}

func run() error {
	worker, err := sceneworker.StartFromEnv()
	if err != nil {
		return fmt.Errorf("initialize scene worker: %w", err)
	}
	defer worker.Close()
	app, err := api.NewApp()
	if err != nil {
		return fmt.Errorf("cannot initialize server: %w", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	fmt.Printf("Server is listening to %s\n", port)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		if err := app.ShutdownWithTimeout(30 * time.Second); err != nil {
			fmt.Fprintf(os.Stderr, "server shutdown: %v\n", err)
		}
	}()
	host := os.Getenv("HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	if err := app.Listen(host + ":" + port); err != nil {
		return fmt.Errorf("server error: %w", err)
	}
	if ctx.Err() != nil {
		<-shutdownDone
	}
	return nil
}
