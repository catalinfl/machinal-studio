package render

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"
)

// Export validates an editor export request and coordinates video, audio and
// text rendering into the final downloadable file.
func Export(c *fiber.Ctx) error {
	req, err := parseRenderRequest(c.Body())
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString(err.Error())
	}
	req, err = normalizeOutputRequest(req)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString(err.Error())
	}

	// Fail closed: never fall back to the shared DataDir (was BOLA via
	// legacyScope). Middleware guarantees a session; double-check here.
	session := sessions.FromRequest(c)
	if session == "" {
		return c.Status(fiber.StatusUnauthorized).SendString("login required")
	}
	scope := scopeForRequest(session)
	planClips := collectAllClips(req)
	scope.warm(c.UserContext(), planClips)
	plan, err := prepareRenderPlan(req, scope)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString(err.Error())
	}
	if strings.Contains(c.Get(fiber.HeaderAccept), "application/x-ndjson") {
		return streamExport(c, req, plan)
	}

	outputName, outputPath, err := executeRender(req, plan, nil)
	if err != nil {
		// Never forward ffmpeg internals/paths to clients (was info leak +
		// existence oracle). Validation errors above are 400 with safe messages.
		return c.Status(fiber.StatusInternalServerError).SendString("media processing failed")
	}
	publishLegacyRender(plan.scope.session, outputName, outputPath)
	c.Set("Content-Disposition", "attachment; filename="+outputName)
	return c.SendFile(outputPath)
}

type renderStreamEvent struct {
	Type     string  `json:"type"`
	Ratio    float64 `json:"ratio,omitempty"`
	Message  string  `json:"message,omitempty"`
	Filename string  `json:"filename,omitempty"`
}

func streamExport(c *fiber.Ctx, req renderRequest, plan renderPlan) error {
	c.Set(fiber.HeaderContentType, "application/x-ndjson")
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Context().SetBodyStreamWriter(fasthttp.StreamWriter(func(writer *bufio.Writer) {
		encoder := json.NewEncoder(writer)
		send := func(event renderStreamEvent) {
			if encoder.Encode(event) == nil {
				// Best-effort flush: a failed flush surfaces on the next
				// Encode anyway, so the stream can continue.
				_ = writer.Flush()
			}
		}
		progress := newRenderProgress(estimateRenderWork(req, plan), func(ratio float64, message string) {
			send(renderStreamEvent{Type: "progress", Ratio: ratio, Message: message})
		})
		send(renderStreamEvent{Type: "progress", Message: "preparing server render"})
		outputName, outputPath, err := executeRender(req, plan, progress)
		if err != nil {
			send(renderStreamEvent{Type: "error", Message: "media processing failed"})
			return
		}
		publishLegacyRender(plan.scope.session, outputName, outputPath)
		progress.complete("server render complete")
		send(renderStreamEvent{Type: "complete", Filename: outputName})
	}))
	return nil
}

func executeRender(req renderRequest, plan renderPlan, progress *renderProgress) (string, string, error) {
	if sceneProgressShare(req) > 0 {
		ctx := context.Background()
		if progress != nil && progress.ctx != nil {
			ctx = progress.ctx
		}
		if progress != nil {
			progress.report(0, "Rendering live scenes for export", true)
		}
		var err error
		var callback progressCallback
		if progress != nil {
			callback = progress.callback
		}
		req, err = materializeSceneClips(ctx, req, plan.scope.root, callback)
		defer removeSceneExports(plan.scope.root, req.sceneExports)
		if err != nil {
			return "", "", err
		}
		plan, err = prepareRenderPlan(req, plan.scope)
		if err != nil {
			return "", "", err
		}
		if progress != nil {
			progress.totalWork = estimateRenderWork(req, plan)
			progress.callback = func(ratio float64, message string) {
				if callback != nil {
					callback(sceneExportWorkShare+(1-sceneExportWorkShare)*ratio, message)
				}
			}
		}
	}

	work, err := os.MkdirTemp(plan.scope.root, "render_")
	if err != nil {
		return "", "", fmt.Errorf("cannot create work dir: %w", err)
	}
	defer os.RemoveAll(work)

	// Unique per job: concurrent renders never overwrite each other.
	outputName := uniqueOutputName(plan.output.extension)
	outputPath, err := storage.SafeJoinIn(plan.scope.root, outputName)
	if err != nil {
		return "", "", fmt.Errorf("resolve output %s: %w", outputName, err)
	}

	videoFile, audioFile, err := renderTracks(req, plan, work, progress)
	if err != nil {
		return "", "", err
	}
	if err := writeRenderOutput(plan, videoFile, audioFile, outputPath, progress); err != nil {
		_ = os.Remove(outputPath)
		return "", "", err
	}
	return outputName, outputPath, nil
}

func publishLegacyRender(session, name, path string) {
	if session == "" {
		return
	}
	prefix := sessions.S3Prefix(session)
	objectstore.BackgroundPut(prefix, path, objectstore.RenderKey(prefix, name))
}

type renderPlan struct {
	scope          fileScope
	allClips       []clip
	videoClipCount int
	audioClipCount int
	fps            int
	totalDuration  float64
	hasVideo       bool
	hasAudio       bool
	output         outputSettings
}

// defaultFPS matches the browser preview when the payload omits fps.
const defaultFPS = 30
const maxRenderDurationSeconds = 24 * 60 * 60

// Render resource ceilings: one unbounded fps/resolution with a single small
// clip could force giant frame buffers and frame-count loops across the
// 2-slot render pool (slow-loris of the queue).
const (
	maxRenderFPS    = 120
	maxRenderDim    = 4096
	maxRenderPixels = 3840 * 2160 * 2   // ~16.6MP: 4K + headroom, blocks 100kx100k OOM
	maxTotalFrames  = 24 * 60 * 60 * 60 // 24h * 60fps ceiling
)

func parseRenderRequest(body []byte) (renderRequest, error) {
	// Bound before unmarshal: Fiber buffers up to 2GiB for /upload, but render
	// JSON must never be megabytes (clips+effects are references, text images
	// capped at 64MB total elsewhere). Reject early to avoid OOM/CPU.
	const maxRenderRequestBytes = 4 << 20
	if len(body) > maxRenderRequestBytes {
		return renderRequest{}, fmt.Errorf("render request too large: at most %d bytes", maxRenderRequestBytes)
	}
	var req renderRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return renderRequest{}, fmt.Errorf("invalid JSON: %w", err)
	}
	return req, nil
}

func prepareRenderPlan(req renderRequest, scope fileScope) (renderPlan, error) {
	output, err := parseOutputSettings(req.Format, req.Quality)
	if err != nil {
		return renderPlan{}, err
	}
	videoClips, videoClipCount := collectChannelClips(req.VideoChannels)
	audioClips, audioClipCount := collectChannelClips(req.AudioChannels)
	allClips := append(videoClips, audioClips...)
	plan := renderPlan{
		scope:          scope,
		allClips:       allClips,
		videoClipCount: videoClipCount,
		audioClipCount: audioClipCount,
		fps:            normalizedFPS(req.FPS),
		output:         output,
	}
	if err := validateRenderRequest(req, plan); err != nil {
		return renderPlan{}, err
	}
	if err := validateReferencedFiles(plan.allClips, scope); err != nil {
		return renderPlan{}, err
	}
	if err := validateClipTimestamps(plan.allClips, scope); err != nil {
		return renderPlan{}, err
	}
	plan.totalDuration = renderDuration(plan.allClips, req.TextItems)
	if req.Duration != nil {
		if math.IsNaN(*req.Duration) || math.IsInf(*req.Duration, 0) || *req.Duration < plan.totalDuration-fadeEps || *req.Duration > maxRenderDurationSeconds {
			return renderPlan{}, fmt.Errorf("composition duration must cover all active content and be at most 24 hours")
		}
		plan.totalDuration = *req.Duration
	}
	// Bound total frames (duration*fps) so 24h@120fps cannot be requested
	// with 4K frames to stall the 2-slot pool.
	if plan.totalDuration*float64(plan.fps) > float64(maxTotalFrames) {
		return renderPlan{}, fmt.Errorf("composition too large: duration x fps exceeds limit")
	}
	plan.hasVideo = plan.videoClipCount > 0 || len(req.TextItems) > 0
	plan.hasAudio = plan.audioClipCount > 0
	return plan, nil
}

func collectChannelClips(channels []channel) ([]clip, int) {
	clipCount := 0
	clips := make([]clip, 0)
	for _, channel := range channels {
		clips = append(clips, channel.Clips...)
		clipCount += len(channel.Clips)
	}
	return clips, clipCount
}

func normalizedFPS(fps int) int {
	if fps <= 0 {
		return defaultFPS
	}
	if fps > maxRenderFPS {
		return maxRenderFPS
	}
	return fps
}

func validateRenderRequest(req renderRequest, plan renderPlan) error {
	if !req.Fit.Valid() {
		return fmt.Errorf("invalid fit: expected contain or cover")
	}
	if err := validatePlaybackRates(plan.allClips); err != nil {
		return err
	}
	if err := validateClipCompositing(plan.allClips); err != nil {
		return err
	}
	if !hasRenderableContent(req, plan) {
		return fmt.Errorf("nothing to render")
	}
	if !plan.output.audioOnly && !hasValidResolution(req) {
		return fmt.Errorf("invalid resolution")
	}
	if err := prepareTextItems(req.TextItems); err != nil {
		return err
	}
	return validateVideoEffects(req.VideoChannels)
}

func hasRenderableContent(req renderRequest, plan renderPlan) bool {
	return plan.videoClipCount > 0 || plan.audioClipCount > 0 || len(req.TextItems) > 0
}

func hasValidResolution(req renderRequest) bool {
	if req.Resolution.W <= 0 || req.Resolution.H <= 0 {
		return false
	}
	if req.Resolution.W > maxRenderDim || req.Resolution.H > maxRenderDim {
		return false
	}
	// int64 to avoid overflow on 100000x100000.
	if int64(req.Resolution.W)*int64(req.Resolution.H) > int64(maxRenderPixels) {
		return false
	}
	return true
}

func validateVideoEffects(channels []channel) error {
	for _, channel := range channels {
		for _, movingClip := range channel.Clips {
			for _, segment := range movingClip.Segments {
				if _, err := buildFilter(segment.Effects); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func validateReferencedFiles(clips []clip, scope fileScope) error {
	for _, movingClip := range clips {
		path, err := scope.join(movingClip.File)
		if err != nil {
			return err
		}
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("file doesn't exist: %s", movingClip.File)
			}
			return fmt.Errorf("stat %s: %w", movingClip.File, err)
		}
	}
	return nil
}

// collectAllClips gathers every referenced clip before the plan exists so
// Export can warm them from S3 in one pass.
func collectAllClips(req renderRequest) []clip {
	videoClips, _ := collectChannelClips(req.VideoChannels)
	audioClips, _ := collectChannelClips(req.AudioChannels)
	return append(videoClips, audioClips...)
}

func renderDuration(clips []clip, textItems []textItem) float64 {
	duration := 0.0
	for _, movingClip := range clips {
		if end := clipEndT(movingClip); end > duration {
			duration = end
		}
	}
	for _, item := range textItems {
		if end := item.Start + item.Duration; end > duration {
			duration = end
		}
	}
	return duration
}

func renderTracks(req renderRequest, plan renderPlan, work string, progress *renderProgress) (string, string, error) {
	videoFile := ""
	if plan.hasVideo {
		var err error
		videoFile, err = renderVideoTrack(req, plan, work, progress)
		if err != nil {
			return "", "", err
		}
	}
	audioFile, err := buildAudio(req.AudioChannels, plan.hasAudio, plan.totalDuration, work, progress, plan.scope)
	if err != nil {
		return "", "", err
	}
	return videoFile, audioFile, nil
}

func renderVideoTrack(req renderRequest, plan renderPlan, work string, progress *renderProgress) (string, error) {
	videoFile, err := buildVideo(req, plan.videoClipCount, plan.fps, plan.totalDuration, work, progress, plan.scope)
	if err != nil || len(req.TextItems) == 0 {
		return videoFile, err
	}
	if plan.videoClipCount == 0 {
		videoFile = filepath.Join(work, "text_base.mp4")
		if err := generateBlackVideoWithWork(plan.totalDuration, req.Resolution.W, req.Resolution.H, plan.fps, videoFile, plan.totalDuration, "rendering black video", progress); err != nil {
			return "", err
		}
	}
	return overlayTextItems(videoFile, req.TextItems, req.Resolution.W, req.Resolution.H, plan.fps, plan.totalDuration, work, progress)
}

func buildVideo(req renderRequest, clipCount, fps int, totalDuration float64, work string, progress *renderProgress, scope fileScope) (string, error) {
	if clipCount == 0 {
		return "", nil
	}

	channelFiles := make([]string, 0, len(req.VideoChannels))
	channelMaskFiles := make([]string, 0, len(req.VideoChannels))
	videoChannels := make([]channel, 0, len(req.VideoChannels))

	for index, channel := range req.VideoChannels {
		if len(channel.Clips) == 0 {
			continue
		}
		sort.SliceStable(channel.Clips, func(left, right int) bool {
			return channel.Clips[left].Start < channel.Clips[right].Start
		})
		xfadeByRight := make(map[int]string, len(channel.Transitions))
		for _, transition := range channel.Transitions {
			xfadeByRight[transition.RightClipIndex] = sanitizeXfade(transition.Xfade)
		}
		channelWork := filepath.Join(work, fmt.Sprintf("video_channel_%d", index))
		if err := os.Mkdir(channelWork, 0o700); err != nil {
			return "", fmt.Errorf("cannot create video work dir: %w", err)
		}
		channelFile, err := buildVideoTrack(channel.Clips, req.Resolution.W, req.Resolution.H, fps, channelWork, totalDuration, xfadeByRight, progress, scope, req.Fit)
		if err != nil {
			return "", err
		}
		maskFile := ""
		if len(channelFiles) > 0 || channelNeedsBaseMask(channel) {
			maskFile, err = buildVideoMaskTrack(channel.Clips, req.Resolution.W, req.Resolution.H, fps, channelWork, totalDuration, xfadeByRight, progress, scope, req.Fit)
			if err != nil {
				return "", err
			}
		}
		channelFiles = append(channelFiles, channelFile)
		channelMaskFiles = append(channelMaskFiles, maskFile)
		videoChannels = append(videoChannels, channel)
	}

	return compositeVideoChannels(channelFiles, channelMaskFiles, videoChannels, req.Resolution.W, req.Resolution.H, fps, totalDuration, work, progress)
}

func buildAudio(channels []channel, enabled bool, totalDuration float64, work string, progress *renderProgress, scope fileScope) (string, error) {
	if !enabled {
		return "", nil
	}
	channelFiles := make([]string, 0, len(channels))
	for index, channel := range channels {
		if len(channel.Clips) == 0 {
			continue
		}
		sort.SliceStable(channel.Clips, func(left, right int) bool {
			return channel.Clips[left].Start < channel.Clips[right].Start
		})
		channelWork := filepath.Join(work, fmt.Sprintf("audio_channel_%d", index))
		if err := os.Mkdir(channelWork, 0o700); err != nil {
			return "", fmt.Errorf("cannot create audio work dir: %w", err)
		}
		channelFile, err := buildAudioTrack(channel.Clips, channelWork, totalDuration, progress, scope)
		if err != nil {
			return "", err
		}
		channelFiles = append(channelFiles, channelFile)
	}
	return mixAudioChannels(channelFiles, totalDuration, work, progress)
}

func writeRenderOutput(plan renderPlan, videoFile, audioFile, outputPath string, progress *renderProgress) error {
	if progress != nil {
		if window, present := PreviewFromContext(progress.ctx); present {
			return writePreviewOutput(window, plan, videoFile, audioFile, outputPath, progress)
		}
	}
	switch {
	case plan.hasVideo && plan.hasAudio:
		if err := muxVideoAudio(videoFile, audioFile, outputPath, plan.totalDuration, plan.output, progress); err != nil {
			return fmt.Errorf("mux error: %w", err)
		}
	case plan.hasVideo:
		if err := encodeVideo(videoFile, outputPath, plan.totalDuration, plan.output, progress); err != nil {
			return fmt.Errorf("video encode error: %w", err)
		}
	case plan.hasAudio:
		if err := encodeAudio(audioFile, outputPath, plan.totalDuration, plan.output, progress); err != nil {
			return fmt.Errorf("audio encode error: %w", err)
		}
	}
	return nil
}
