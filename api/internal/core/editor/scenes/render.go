package scenes

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ffmpeg-go-server/editengine/sceneasset"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/mediacache"
	"ffmpeg-go-server/internal/platform/storage"
	"ffmpeg-go-server/internal/utils"
)

const maxVideoBytes = 1 << 30 // full-length lossless Full HD scenes can exceed 512 MiB
const maxBundleBytes = 2 << 20

var rendererHTTP = &http.Client{Timeout: 30 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

type componentError struct{ diagnostic string }

func (err *componentError) Error() string { return err.diagnostic }

type compilationMedia struct {
	Images     map[string]string `json:"images,omitempty"`
	Videos     map[string]string `json:"videos,omitempty"`
	Parameters SceneParameters   `json:"parameters,omitempty"`
	Models     map[string]string `json:"models,omitempty"`
	Range      *CaptureRange     `json:"range,omitempty"`
}

type CaptureRange struct {
	StartFrame int `json:"startFrame"`
	EndFrame   int `json:"endFrame"`
}

func compileRemote(ctx context.Context, component string, config Config) (string, error) {
	return compileSceneRemote(ctx, component, config, compilationMedia{}, false)
}

func compileValidatedRemote(ctx context.Context, component string, config Config, media compilationMedia) (string, error) {
	return compileSceneRemote(ctx, component, config, media, true)
}

func compileSceneRemote(ctx context.Context, component string, config Config, media compilationMedia, inspectLayout bool) (string, error) {
	body, err := json.Marshal(struct {
		Component string `json:"component"`
		Config    Config `json:"config"`
		compilationMedia
		InspectLayout bool `json:"inspectLayout,omitempty"`
	}{component, config, media, inspectLayout})
	if err != nil {
		return "", fmt.Errorf("encode scene compilation: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(os.Getenv("SCENE_SERVICE_URL"), "/")+"/compile", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create scene compilation: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if token := os.Getenv("SCENE_SERVICE_TOKEN"); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := rendererHTTP.Do(request)
	if err != nil {
		return "", fmt.Errorf("contact scene compiler: %w", err)
	}
	defer response.Body.Close()
	if err := rendererServiceError(response); err != nil {
		return "", err
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBundleBytes+1))
	if err != nil {
		return "", fmt.Errorf("read compiled scene: %w", err)
	}
	if response.StatusCode == http.StatusUnprocessableEntity {
		return "", &componentError{diagnostic: string(data)}
	}
	if response.StatusCode != http.StatusOK || len(data) > maxBundleBytes {
		return "", fmt.Errorf("scene compiler returned HTTP %d or exceeded size limits", response.StatusCode)
	}
	var result struct {
		JavaScript string `json:"javascript"`
	}
	if err := json.Unmarshal(data, &result); err != nil || result.JavaScript == "" {
		return "", fmt.Errorf("scene compiler returned an invalid bundle")
	}
	return result.JavaScript, nil
}

func rendererReady(ctx context.Context) error {
	// A sleeping local worker needs time to start and verify its native tools.
	ctx, cancel := context.WithTimeout(ctx, 95*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(os.Getenv("SCENE_SERVICE_URL"), "/")+"/health", nil)
	if err != nil {
		return err
	}
	if token := os.Getenv("SCENE_SERVICE_TOKEN"); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := rendererHTTP.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if err := rendererServiceError(response); err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("renderer health returned HTTP %d", response.StatusCode)
	}
	return nil
}

func renderRemote(ctx context.Context, component string, config Config, images, videos map[string]string, output string) (json.RawMessage, error) {
	return renderParameterizedRemote(ctx, component, config, compilationMedia{Images: images, Videos: videos}, output)
}

func renderParameterizedRemote(ctx context.Context, component string, config Config, media compilationMedia, output string) (json.RawMessage, error) {
	base := strings.TrimRight(os.Getenv("SCENE_SERVICE_URL"), "/")
	if base == "" {
		return nil, fmt.Errorf("SCENE_SERVICE_URL is not configured")
	}
	body, err := json.Marshal(struct {
		Component string `json:"component"`
		Config    Config `json:"config"`
		compilationMedia
	}{component, config, media})
	if err != nil {
		return nil, fmt.Errorf("encode render request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/render", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create render request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if token := os.Getenv("SCENE_SERVICE_TOKEN"); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	started := time.Now()
	frames := config.Frames
	if media.Range != nil {
		frames = media.Range.EndFrame - media.Range.StartFrame
	}
	if id := jobqueue.ID(ctx); id != "" {
		request.Header.Set("X-Scene-Request-Id", id)
	}
	log.Printf("scene_export_started job=%q width=%d height=%d fps=%g frames=%d", jobqueue.ID(ctx), config.Width, config.Height, config.FPS, frames)
	stopProgress := watchExportProgress(ctx, request, frames)
	defer stopProgress()
	response, err := rendererHTTP.Do(request)
	if err != nil {
		return nil, fmt.Errorf("contact scene renderer: %w", err)
	}
	defer response.Body.Close()
	stopProgress()
	log.Printf("scene_export_response job=%q status=%d elapsed_ms=%d declared_bytes=%d", jobqueue.ID(ctx), response.StatusCode, time.Since(started).Milliseconds(), response.ContentLength)
	if err := rendererServiceError(response); err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		diagnostic, err := io.ReadAll(io.LimitReader(response.Body, 4000))
		if err != nil {
			return nil, fmt.Errorf("read scene diagnostic: %w", err)
		}
		if response.StatusCode == http.StatusUnprocessableEntity {
			return nil, &componentError{diagnostic: string(diagnostic)}
		}
		return nil, fmt.Errorf("scene renderer HTTP %d: %s", response.StatusCode, diagnostic)
	}
	if response.ContentLength > maxVideoBytes {
		return nil, fmt.Errorf("scene video exceeds output limit of %d bytes", maxVideoBytes)
	}
	manifest, err := base64.StdEncoding.DecodeString(response.Header.Get("X-Scene-Manifest"))
	if err != nil || !json.Valid(manifest) {
		return nil, fmt.Errorf("scene renderer returned an invalid manifest")
	}
	file, err := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("stage scene video: %w", err)
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.Remove(output)
		}
	}()
	transferStarted := time.Now()
	size, copyErr := io.Copy(file, io.LimitReader(response.Body, maxVideoBytes+1))
	closeErr := file.Close()
	if copyErr != nil {
		return nil, fmt.Errorf("download scene video: %w", copyErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("close scene video: %w", closeErr)
	}
	if size == 0 || size > maxVideoBytes {
		return nil, fmt.Errorf("scene video is empty or exceeds output limit of %d bytes", maxVideoBytes)
	}
	if response.ContentLength >= 0 && size != response.ContentLength {
		return nil, fmt.Errorf("scene video download is truncated")
	}
	complete = true
	log.Printf("scene_export_completed job=%q elapsed_ms=%d transfer_ms=%d bytes=%d", jobqueue.ID(ctx), time.Since(started).Milliseconds(), time.Since(transferStarted).Milliseconds(), size)
	return manifest, nil
}

func loadVoice(ctx context.Context, root, file string) (media.Metadata, error) {
	source, err := media.ResolveSource(root, file)
	if err != nil {
		return media.Metadata{}, err
	}
	metadata, err := media.LoadMetadata(ctx, &mediacache.Default, source, mediacache.Run)
	if err != nil {
		return metadata, fmt.Errorf("inspect narration: %w", err)
	}
	if metadata.AudioCodec == "" || metadata.Duration <= 0 || metadata.Duration > maxVoiceSeconds {
		return metadata, fmt.Errorf("choose a recording with audio lasting at most %d seconds", maxVoiceSeconds)
	}
	return metadata, nil
}

func muxVoice(ctx context.Context, root, file, video, output string, d Definition) error {
	voice, err := storage.SafeJoinIn(root, file)
	if err != nil {
		return err
	}
	seconds := func(value float64) string { return strconv.FormatFloat(value, 'f', 6, 64) }
	args := []string{"-v", "error", "-nostdin", "-i", video, "-ss", seconds(d.Start), "-i", voice, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-af", "apad", "-t", seconds(d.End - d.Start), "-movflags", "+faststart", output}
	if err := utils.RunFFmpegContext(ctx, args...); err != nil {
		return fmt.Errorf("synchronize scene narration: %w", err)
	}
	return nil
}

func importScene(root, filename, id string, manifest json.RawMessage, hasVoice bool) (Scene, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(manifest, &fields); err != nil {
		return Scene{}, fmt.Errorf("decode rendered scene: %w", err)
	}
	if hasVoice {
		file, err := os.Open(filepath.Join(root, filename))
		if err != nil {
			return Scene{}, err
		}
		hash := sha256.New()
		size, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil {
			return Scene{}, copyErr
		}
		if closeErr != nil {
			return Scene{}, closeErr
		}
		fields["sha256"], _ = json.Marshal(hex.EncodeToString(hash.Sum(nil)))
		fields["size"], _ = json.Marshal(size)
		fields["hasAudio"] = json.RawMessage("true")
	}
	fields["file"], _ = json.Marshal(filename)
	updated, err := json.Marshal(fields)
	if err != nil {
		return Scene{}, err
	}
	imported, err := sceneasset.Import(root, filename, id, bytes.NewReader(updated))
	if err != nil {
		return Scene{}, fmt.Errorf("import scene asset: %w", err)
	}
	return Scene{ID: id, Asset: imported.Asset, Manifest: updated}, nil
}
