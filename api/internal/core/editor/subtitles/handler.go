package subtitles

import (
	"context"
	"encoding/json"
	"errors"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"
	"ffmpeg-go-server/internal/utils"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ffmpeg-go-server/internal/core/media"

	"github.com/gofiber/fiber/v2"
)

const (
	maxRequestBody     = 16 << 10 // 16KB
	maxOpenRouterAudio = 25 << 20 // 25MB
	defaultBaseURL     = "https://openrouter.ai/api/v1"
	// Caption tuning: at most 4 words per cue, 3s max span, 600ms pause
	// forces a break so cues stay readable at typical speech rates.
	maxCaptionWords    = 4
	maxCaptionDuration = 3 * time.Second
	captionPause       = 600 * time.Millisecond
	// 120s covers slow STT providers on the longest supported extraction.
	transcriptionTimeout = 120 * time.Second
)

type generateRequest struct {
	File     string  `json:"file"`
	Language string  `json:"language,omitempty"`
	Start    float64 `json:"start,omitempty"`
	Duration float64 `json:"duration,omitempty"`
}

type transcriptionSegment struct {
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
	Text    string  `json:"text"`
	Speaker string  `json:"speaker,omitempty"`
}

type TranscriptSegment struct {
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
	Text    string  `json:"text"`
	Speaker string  `json:"speaker,omitempty"`
}

type transcriptionWord struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Word  string  `json:"word"`
}

type transcriptionResponse struct {
	Text     string                 `json:"text"`
	Segments []transcriptionSegment `json:"segments"`
	Words    []transcriptionWord    `json:"words"`
	Error    *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type captionWord struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

type captionCue struct {
	Start float64       `json:"start"`
	End   float64       `json:"end"`
	Text  string        `json:"text"`
	Words []captionWord `json:"words"`
}

type generateResponse struct {
	Cues []captionCue `json:"cues"`
}

type transcriptionRequest struct {
	Model                  string                 `json:"model"`
	InputAudio             transcriptionAudio     `json:"input_audio"`
	Language               string                 `json:"language,omitempty"`
	ResponseFormat         string                 `json:"response_format"`
	TimestampGranularities []string               `json:"timestamp_granularities"`
	Provider               *transcriptionProvider `json:"provider,omitempty"`
}

type transcriptionAudio struct {
	Data   string `json:"data"`
	Format string `json:"format"`
}

type transcriptionProvider struct {
	Only           []string `json:"only"`
	AllowFallbacks bool     `json:"allow_fallbacks"`
}

type openRouterConfig struct {
	APIKey   string
	Model    string
	Provider string
}

type handlerError struct {
	status  int
	message string
	cause   error
}

func (err *handlerError) Error() string {
	if err.cause != nil {
		return err.message + ": " + err.cause.Error()
	}
	return err.message
}

func (err *handlerError) Unwrap() error { return err.cause }

func requestError(status int, message string) error {
	return &handlerError{status: status, message: message}
}

func requestErrorf(status int, cause error, message string) error {
	return &handlerError{status: status, message: message, cause: cause}
}

func sendHandlerError(c *fiber.Ctx, err error) error {
	var responseError *handlerError
	if errors.As(err, &responseError) {
		return c.Status(responseError.status).SendString(responseError.message)
	}
	return c.Status(fiber.StatusInternalServerError).SendString("subtitle request failed")
}

func Generate(c *fiber.Ctx) error {
	if len(c.Body()) > maxRequestBody {
		return c.Status(fiber.StatusRequestEntityTooLarge).SendString("subtitle request too large")
	}

	var request generateRequest
	if err := json.Unmarshal(c.Body(), &request); err != nil {
		return sendHandlerError(c, requestError(fiber.StatusBadRequest, "invalid JSON: "+err.Error()))
	}

	if err := request.validateSubtitlesRequest(); err != nil {
		return sendHandlerError(c, err)
	}

	root, session := sessions.ResolveRoot(c)
	media.WarmSession(c.UserContext(), session, root, request.File)

	ctx, cancel := context.WithTimeout(c.UserContext(), transcriptionTimeout)
	defer cancel()

	transcription, err := fetchTranscription(ctx, root, request, utils.RunFFmpegContext)
	if err != nil {
		return sendHandlerError(c, err)
	}

	cues := buildCaptionCues(transcription)
	if len(cues) == 0 {
		return sendHandlerError(c, requestError(fiber.StatusBadGateway, "OpenRouter returned no timestamped segments"))
	}
	if strings.Contains(strings.ToLower(c.Get("Accept")), "application/json") {
		return c.JSON(generateResponse{Cues: cues})
	}

	// Cue count is display-only here; the SRT body is the response.
	srt, _ := buildSRTFromCues(cues)

	stem := strings.TrimSuffix(
		filepath.Base(request.File),
		filepath.Ext(request.File),
	)

	c.Set("Content-Type", "application/x-subrip; charset=utf-8")
	c.Set(
		"Content-Disposition",
		fmt.Sprintf("attachment; filename=%q", stem+".srt"),
	)

	return c.SendString(srt)
}

// TranscribeMedia exposes the timestamped transcript to other editor features
// while keeping extraction and provider configuration in one package.
func TranscribeMedia(ctx context.Context, root, file string, duration float64) ([]TranscriptSegment, error) {
	request := generateRequest{File: file, Duration: duration}
	if err := request.validateSubtitlesRequest(); err != nil {
		return nil, err
	}
	transcription, err := fetchTranscription(ctx, root, request, utils.RunFFmpegContext)
	if err != nil {
		return nil, err
	}
	return segmentsFromTranscription(transcription)
}

// fetchTranscription is the shared pipeline behind Generate and
// TranscribeMedia: config, audio extraction, provider call, temp cleanup.
func fetchTranscription(ctx context.Context, root string, request generateRequest, runFFmpeg ffmpegRunner) (transcriptionResponse, error) {
	config, err := loadOpenRouterConfig()
	if err != nil {
		return transcriptionResponse{}, err
	}
	inputPath, err := request.validatePath(root)
	if err != nil {
		return transcriptionResponse{}, err
	}
	identity := transcriptIdentity(inputPath, config, resolveTranscriptionLanguage(request.Language))
	if cached, ok := cachedTranscription(identity, request.Start, request.Duration); ok {
		return cached, nil
	}
	audioPath, err := request.prepareAudioPath(ctx, inputPath, runFFmpeg)
	if err != nil {
		return transcriptionResponse{}, err
	}
	defer os.Remove(audioPath)

	transcription, err := requestTranscription(
		ctx,
		audioPath,
		config.APIKey,
		config.Model,
		config.Provider,
		resolveTranscriptionLanguage(request.Language),
	)
	if err != nil {
		return transcriptionResponse{}, requestErrorf(fiber.StatusBadGateway, err, "subtitle provider unavailable")
	}
	storeTranscription(identity, request.Start, request.Duration, transcription)
	return transcription, nil
}

func segmentsFromTranscription(transcription transcriptionResponse) ([]TranscriptSegment, error) {
	segments := make([]TranscriptSegment, 0, len(transcription.Segments))
	for _, segment := range transcription.Segments {
		text := strings.TrimSpace(segment.Text)
		if text == "" || segment.End <= segment.Start {
			continue
		}
		segments = append(segments, TranscriptSegment{
			Start:   segment.Start,
			End:     segment.End,
			Text:    text,
			Speaker: strings.TrimSpace(segment.Speaker),
		})
	}
	if len(segments) == 0 && strings.TrimSpace(transcription.Text) != "" {
		return nil, requestError(fiber.StatusBadGateway, "transcription returned speech without timestamped segments")
	}
	return segments, nil
}

func (request *generateRequest) validateSubtitlesRequest() error {
	request.File = strings.TrimSpace(request.File)
	request.Language = strings.ToLower(strings.TrimSpace(request.Language))

	if request.File == "" {
		return requestError(fiber.StatusBadRequest, "field 'file' is required")
	}

	if !validNumber(request.Start) || !validNumber(request.Duration) || request.Start < 0 || request.Duration < 0 {
		return requestError(fiber.StatusBadRequest, "invalid start or duration")
	}

	if request.Language != "" && !validLanguage(request.Language) {
		return requestError(fiber.StatusBadRequest, "language must be an ISO-639-1 code such as 'ro'")
	}

	return nil
}

func loadOpenRouterConfig() (openRouterConfig, error) {
	config := openRouterConfig{
		APIKey:   strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")),
		Model:    strings.TrimSpace(os.Getenv("OPENROUTER_STT_MODEL")),
		Provider: strings.TrimSpace(os.Getenv("OPENROUTER_STT_PROVIDER")),
	}
	if config.APIKey == "" || config.Model == "" {
		return config, requestError(fiber.StatusServiceUnavailable, "subtitle generation is not configured: set OPENROUTER_API_KEY and OPENROUTER_STT_MODEL")
	}
	return config, nil
}

func (request generateRequest) prepareAudioPath(ctx context.Context, inputPath string, runFFmpeg ffmpegRunner) (string, error) {
	audioFile, err := os.CreateTemp("", "subtitle-audio-*.mp3")
	if err != nil {
		return "", requestErrorf(fiber.StatusUnprocessableEntity, err, "cannot create temporary audio")
	}
	audioPath := audioFile.Name()
	if err := audioFile.Close(); err != nil {
		os.Remove(audioPath)
		return "", requestErrorf(fiber.StatusUnprocessableEntity, err, "cannot prepare temporary audio")
	}
	if err := extractAudio(ctx, runFFmpeg, inputPath, audioPath, request.Start, request.Duration); err != nil {
		os.Remove(audioPath)
		return "", err
	}
	audioInfo, err := os.Stat(audioPath)
	if err != nil || audioInfo.Size() == 0 {
		os.Remove(audioPath)
		return "", requestError(fiber.StatusUnprocessableEntity, "the selected media does not contain usable audio")
	}
	if audioInfo.Size() > maxOpenRouterAudio {
		os.Remove(audioPath)
		return "", requestError(fiber.StatusUnprocessableEntity, fmt.Sprintf("extracted audio exceeds OpenRouter's %d MB limit", maxOpenRouterAudio>>20))
	}
	return audioPath, nil
}

func (request generateRequest) validatePath(root string) (string, error) {
	// SafeJoinIn owns traversal protection; the IsRegular check here only
	// rejects non-media nodes (dirs, symlinks, devices) under the same root.
	inputPath, err := storage.SafeJoinIn(root, request.File)
	if err != nil {
		return "", requestError(fiber.StatusBadRequest, err.Error())
	}

	// Lstat so symlinks are rejected, not followed (was Stat).
	info, err := os.Lstat(inputPath)
	if err != nil || !info.Mode().IsRegular() {
		return "", requestError(fiber.StatusBadRequest, "media file doesn't exist")
	}

	return inputPath, nil
}

func validLanguage(language string) bool {
	if len(language) != 2 {
		return false
	}

	for _, char := range language {
		if char < 'a' || char > 'z' {
			return false
		}
	}

	return true
}

// resolveTranscriptionLanguage prefers the explicit request language and
// falls back to OPENROUTER_STT_LANGUAGE so older clients that omit the field
// still get a stable default instead of provider auto-detection (which is
// English-biased and often mistranscribes Romanian speech as English).
func resolveTranscriptionLanguage(requestLanguage string) string {
	normalized := strings.ToLower(strings.TrimSpace(requestLanguage))
	if validLanguage(normalized) {
		return normalized
	}
	if fallback := strings.ToLower(strings.TrimSpace(os.Getenv("OPENROUTER_STT_LANGUAGE"))); validLanguage(fallback) {
		return fallback
	}
	return ""
}

func validNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func ffmpegNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', 3, 64)
}
