package textprepare

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/text"
)

var preparationHTTP = &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
var errPreparationBusy = errors.New("text preparation busy")

// Configured reports configuration only, without probing provider health.
func Configured() bool {
	return strings.TrimSpace(os.Getenv("SCENE_SERVICE_URL")) != ""
}

func Prepare(ctx context.Context, resolved *composition.Composition) (err error) {
	if _, err := resolved.PreparedText.Resolve(resolved.TextItems, resolved.Output); err == nil {
		return nil
	}
	started := time.Now()
	defer func() {
		overlays := 0
		if err == nil {
			overlays = len(resolved.PreparedText.Overlays)
		}
		log.Printf("render_text_prepare items=%d overlays=%d elapsed_ms=%d success=%t", len(resolved.TextItems), overlays, time.Since(started).Milliseconds(), err == nil)
	}()
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("SCENE_SERVICE_URL")), "/")
	if base == "" {
		return fmt.Errorf("text preparation needs SCENE_SERVICE_URL, or preparedText exported from the editor")
	}
	data, err := json.Marshal(struct {
		Items  []document.TextItem `json:"textItems"`
		Output document.Output     `json:"output"`
		Key    string              `json:"textRenderKey"`
	}{resolved.TextItems, resolved.Output, resolved.TextRenderKey})
	if err != nil {
		return fmt.Errorf("encode text preparation: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	for {
		prepared, err := fetchPrepared(ctx, base, data)
		if errors.Is(err, errPreparationBusy) {
			timer := time.NewTimer(time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return fmt.Errorf("wait for text preparation: %w", ctx.Err())
			case <-timer.C:
				continue
			}
		}
		if err != nil {
			return err
		}
		if _, err := prepared.Resolve(resolved.TextItems, resolved.Output); err != nil {
			return err
		}
		resolved.PreparedText = &prepared
		return nil
	}
}

func fetchPrepared(ctx context.Context, base string, data []byte) (text.Prepared, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/text", bytes.NewReader(data))
	if err != nil {
		return text.Prepared{}, fmt.Errorf("build text preparation: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token := os.Getenv("SCENE_SERVICE_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := preparationHTTP.Do(req)
	if err != nil {
		return text.Prepared{}, fmt.Errorf("prepare text: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests {
		return text.Prepared{}, errPreparationBusy
	}
	if response.StatusCode != http.StatusOK {
		return text.Prepared{}, fmt.Errorf("text preparation service returned HTTP %d", response.StatusCode)
	}
	var prepared text.Prepared
	if err := json.NewDecoder(io.LimitReader(response.Body, 128<<20)).Decode(&prepared); err != nil {
		return text.Prepared{}, fmt.Errorf("decode prepared text: %w", err)
	}
	return prepared, nil
}
