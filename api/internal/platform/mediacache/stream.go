package mediacache

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"time"
)

// Stream shares the encoder queue without buffering a complete decoded audio stream.
func Stream(ctx context.Context, program string, args []string, consume func(io.Reader) error) error {
	release, err := acquireProcessSlot(ctx, program)
	if err != nil {
		return err
	}
	defer release()
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(child, program, withFileWhitelist(args)...)
	cmd.WaitDelay = time.Second
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open %s output: %w", program, err)
	}
	stderr := limitedBuffer{limit: stderrLimit}
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", program, err)
	}
	readErr := consume(stdout)
	if readErr != nil {
		// A failed consumer must not leave a child blocked on a full stdout pipe.
		cancel()
	}
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if readErr != nil {
		return fmt.Errorf("read %s output: %w", program, readErr)
	}
	if waitErr != nil {
		return fmt.Errorf("%s: %w: %s", program, waitErr, stderr.String())
	}
	return nil
}
