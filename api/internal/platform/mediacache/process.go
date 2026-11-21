package mediacache

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"time"
)

const (
	// ProbeTimeout bounds ffprobe metadata reads so a hung file cannot stall bin listing.
	ProbeTimeout = 20 * time.Second
	// ThumbnailTimeout bounds single-frame extracts for timeline/scrub previews.
	ThumbnailTimeout = 30 * time.Second
	// ProxyTimeout bounds full timeline encodes of long sessions.
	ProxyTimeout = 30 * time.Minute

	// stdoutLimit caps captured subprocess stdout; ffprobe JSON for large
	// bins stays well under 1 MiB, so more indicates a runaway output.
	stdoutLimit = 1 << 20
	// stderrLimit caps captured diagnostics kept for error messages.
	stderrLimit = 16 << 10
	// maxProbeSlots reserves a small lane for metadata so timeline encodes
	// cannot starve bin listing.
	maxProbeSlots = 2
	// maxEncoderSlots caps concurrent encodes to avoid disk/CPU thrash.
	maxEncoderSlots = 2
	// maxThreadsPerEncode caps ffmpeg threads per encode for the same reason.
	maxThreadsPerEncode = 4
)

type Runner func(context.Context, string, ...string) ([]byte, error)

// Probes have their own small pool so timeline encodes cannot starve bin metadata.
var (
	encodingSlots = make(chan struct{}, max(1, min(maxEncoderSlots, runtime.GOMAXPROCS(0)/2)))
	probeSlots    = make(chan struct{}, maxProbeSlots)
	// Threads sizes per-encode ffmpeg threading from available CPUs.
	Threads = max(1, min(maxThreadsPerEncode, runtime.GOMAXPROCS(0)/cap(encodingSlots)))
)

// withFileWhitelist mirrors utils.withProtocolWhitelist for the cache runner:
// insert "-protocol_whitelist file,pipe" before absolute-path "-i" inputs so
// playlist content cannot trigger outbound fetches. lavfi inputs untouched.
func withFileWhitelist(args []string) []string {
	out := make([]string, 0, len(args)+4)
	for i := 0; i < len(args); i++ {
		if args[i] == "-i" && i+1 < len(args) {
			next := args[i+1]
			hasWhitelist := i >= 2 && args[i-2] == "-protocol_whitelist"
			if len(next) > 0 && next[0] == '/' && !hasWhitelist {
				out = append(out, "-protocol_whitelist", "file,pipe")
			}
		}
		out = append(out, args[i])
	}
	return out
}

// Run executes program with encoding-slot concurrency limits.
func Run(ctx context.Context, program string, args ...string) ([]byte, error) {
	return runProcess(ctx, program, false, args...)
}

// RunDiagnostics captures bounded filter reports written by FFmpeg to stderr.
func RunDiagnostics(ctx context.Context, args ...string) ([]byte, error) {
	return runProcess(ctx, "ffmpeg", true, args...)
}

func runProcess(ctx context.Context, program string, diagnostics bool, args ...string) ([]byte, error) {
	args = withFileWhitelist(args)
	release, err := acquireProcessSlot(ctx, program)
	if err != nil {
		return nil, err
	}
	defer release()
	cmd := exec.CommandContext(ctx, program, args...)
	cmd.WaitDelay = time.Second
	stdout := limitedBuffer{limit: stdoutLimit}
	stderr := limitedBuffer{limit: stderrLimit}
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%s: %w: %s", program, err, stderr.String())
	}
	if stdout.truncated {
		return nil, fmt.Errorf("%s output exceeds %d byte limit", program, stdoutLimit)
	}
	if diagnostics {
		if stderr.truncated {
			return nil, fmt.Errorf("diagnostic report exceeds %d byte limit", stderrLimit)
		}
		return stderr.buffer.Bytes(), nil
	}
	return stdout.buffer.Bytes(), nil
}

func acquireProcessSlot(ctx context.Context, program string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	slots := encodingSlots
	if program == "ffprobe" {
		slots = probeSlots
	}
	select {
	case slots <- struct{}{}:
		return func() { <-slots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type limitedBuffer struct {
	buffer    bytes.Buffer
	limit     int
	truncated bool
}

func (b *limitedBuffer) String() string {
	return b.buffer.String()
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	remaining := b.limit - b.buffer.Len()
	if n > remaining {
		b.truncated = true
		p = p[:remaining]
	}
	// Infallible: bytes.Buffer.Write only fails on a nil receiver.
	_, _ = b.buffer.Write(p)
	return n, nil
}
