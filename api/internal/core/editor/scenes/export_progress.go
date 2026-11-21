package scenes

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

const exportProgressInterval = time.Second

type ExportProgress struct {
	Stage         string  `json:"stage"`
	WrittenFrames int     `json:"writtenFrames"`
	TotalFrames   int     `json:"totalFrames"`
	ElapsedMS     float64 `json:"elapsedMs"`
}

type exportProgressKey struct{}

func WithExportProgress(ctx context.Context, report func(ExportProgress)) context.Context {
	return context.WithValue(ctx, exportProgressKey{}, report)
}

func watchExportProgress(ctx context.Context, request *http.Request, frames int) func() {
	report, ok := ctx.Value(exportProgressKey{}).(func(ExportProgress))
	if !ok || report == nil {
		return func() {}
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return func() {}
	}
	id := hex.EncodeToString(random[:])
	request.Header.Set("X-Scene-Progress-Id", id)
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(exportProgressInterval)
		defer ticker.Stop()
		var last ExportProgress
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if update, ok := readExportProgress(ctx, request, id, frames); ok && update != last {
					last = update
					report(update)
				}
			}
		}
	}()
	return func() { cancel(); <-done }
}

func readExportProgress(ctx context.Context, original *http.Request, id string, frames int) (ExportProgress, bool) {
	ctx, cancel := context.WithTimeout(ctx, exportProgressInterval)
	defer cancel()
	request := original.Clone(ctx)
	request.Method, request.Body, request.GetBody, request.ContentLength = http.MethodGet, nil, nil, 0
	request.URL.Path = strings.TrimSuffix(original.URL.Path, "/render") + "/render-progress/" + id
	request.Header.Del("Content-Type")
	response, err := rendererHTTP.Do(request)
	if err != nil {
		return ExportProgress{}, false
	}
	defer response.Body.Close()
	var update ExportProgress
	if response.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(response.Body, 1024)).Decode(&update) != nil {
		return update, false
	}
	switch update.Stage {
	case "compiling", "cache-lookup", "cache-miss", "cache-disabled", "capture", "encoding", "cache-hit":
	default:
		return update, false
	}
	return update, update.TotalFrames == frames && update.WrittenFrames >= 0 && update.WrittenFrames <= frames && update.ElapsedMS >= 0 && !math.IsNaN(update.ElapsedMS) && !math.IsInf(update.ElapsedMS, 0)
}
