package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"strconv"

	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

const (
	waveformSampleRate = 8_000
	waveformBinSamples = 400
	// waveformChannels downmixes to mono so one min/max pair per bin covers
	// the audible signal.
	waveformChannels = 1
	// waveformFloatSize is the f32le sample width; reads are rounded down to
	// multiples of it so partial samples carry over to the next read.
	waveformFloatSize = 4
	// waveformReadSize balances pipe throughput against stack pressure.
	waveformReadSize = 64 * 1024
	// waveformCarrySize holds one partial float32 sample (at most 3 bytes)
	// across reads.
	waveformCarrySize = waveformFloatSize - 1
)

// waveformCommand starts the ffmpeg decode pipe. It is a var so tests can stub
// the subprocess; the cache-based paths in this package take a
// mediacache.Runner instead, which this legacy streaming decode predates.
var waveformCommand = exec.CommandContext

type waveformResponse struct {
	SampleRate int       `json:"sampleRate"`
	Length     int       `json:"length"`
	BinSamples int       `json:"binSamples"`
	Min        []float32 `json:"min"`
	Max        []float32 `json:"max"`
}

// Waveform serves per-bin min/max amplitudes decoded to mono f32le.
func Waveform(c *fiber.Ctx) error {
	inputPath, err := parseWaveformRequest(c)
	if err != nil {
		return AssetError(c, err)
	}
	waveform, err := decodeWaveform(c.UserContext(), inputPath)
	if err != nil {
		return AssetError(c, fiber.NewError(fiber.StatusUnprocessableEntity, "cannot decode media"))
	}
	return c.JSON(waveform)
}

func parseWaveformRequest(c *fiber.Ctx) (string, error) {
	fileName := c.Query("file")
	if fileName == "" {
		return "", fiber.NewError(fiber.StatusBadRequest, "parameter 'file' not found")
	}
	root, session := SessionRoot(c)
	if session == "" {
		return "", fiber.NewError(fiber.StatusUnauthorized, "login required")
	}
	WarmSession(c.UserContext(), session, root, fileName)
	inputPath, err := storage.SafeJoinIn(root, fileName)
	if err != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	// Lstat (not Stat) so a swapped-in symlink is rejected, not followed.
	if info, err := os.Lstat(inputPath); err != nil || !info.Mode().IsRegular() {
		return "", fiber.NewError(fiber.StatusNotFound, "source file doesn't exist")
	}
	return inputPath, nil
}

func decodeWaveform(ctx context.Context, inputPath string) (waveformResponse, error) {
	cmd := waveformCommand(
		ctx,
		"ffmpeg",
		"-nostdin",
		"-v", "error",
		"-protocol_whitelist", "file,pipe",
		"-i", inputPath,
		"-vn",
		"-ac", strconv.Itoa(waveformChannels),
		"-ar", strconv.Itoa(waveformSampleRate),
		"-f", "f32le",
		"pipe:1",
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return waveformResponse{}, fmt.Errorf("waveform output: %w", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return waveformResponse{}, fmt.Errorf("waveform start: %w", err)
	}

	waveform, readErr := aggregateWaveform(stdout)
	waitErr := cmd.Wait()
	if readErr != nil {
		return waveformResponse{}, fmt.Errorf("waveform decode: %w", readErr)
	}
	if waitErr != nil {
		return waveformResponse{}, fmt.Errorf("waveform ffmpeg: %w: %s", waitErr, stderr.String())
	}
	return waveform, nil
}

func aggregateWaveform(reader io.Reader) (waveformResponse, error) {
	response := newWaveformResponse()
	buffer := make([]byte, waveformReadSize+waveformCarrySize)
	accumulator := waveformAccumulator{}
	carried := 0

	for {
		read, err := reader.Read(buffer[carried:])
		available := carried + read
		complete := available - available%waveformFloatSize
		accumulator.addSamples(buffer[:complete], &response)
		carried = carryWaveformRemainder(buffer, complete, available)
		if err == io.EOF {
			break
		}
		if err != nil {
			return waveformResponse{}, fmt.Errorf("read waveform samples: %w", err)
		}
	}

	if carried != 0 {
		return waveformResponse{}, io.ErrUnexpectedEOF
	}
	accumulator.flush(&response)
	return response, nil
}

func newWaveformResponse() waveformResponse {
	return waveformResponse{
		SampleRate: waveformSampleRate,
		BinSamples: waveformBinSamples,
		Min:        make([]float32, 0),
		Max:        make([]float32, 0),
	}
}

type waveformAccumulator struct {
	binCount int
	low      float32
	high     float32
}

func (a *waveformAccumulator) addSamples(samples []byte, response *waveformResponse) {
	for offset := 0; offset < len(samples); offset += waveformFloatSize {
		sample := math.Float32frombits(binary.LittleEndian.Uint32(samples[offset : offset+waveformFloatSize]))
		if sample < a.low {
			a.low = sample
		}
		if sample > a.high {
			a.high = sample
		}
		response.Length++
		a.binCount++
		if a.binCount == waveformBinSamples {
			response.Min = append(response.Min, a.low)
			response.Max = append(response.Max, a.high)
			a.binCount = 0
			a.low = 0
			a.high = 0
		}
	}
}

func (a *waveformAccumulator) flush(response *waveformResponse) {
	if a.binCount > 0 {
		response.Min = append(response.Min, a.low)
		response.Max = append(response.Max, a.high)
	}
}

func carryWaveformRemainder(buffer []byte, complete, available int) int {
	carried := available - complete
	copy(buffer, buffer[complete:available])
	return carried
}
