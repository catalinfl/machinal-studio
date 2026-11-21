package speech

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/integrations/openrouter"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"
	"ffmpeg-go-server/internal/utils"

	"github.com/gofiber/fiber/v2"
)

const (
	maxRequestBody   = 24 << 10
	maxInputRunes    = 4000
	maxReferenceSize = 15 << 20
	// 240s covers slow TTS providers on long inputs without hanging forever.
	providerTimeout = 240 * time.Second

	maxReferenceNameLength = 255

	defaultSpeechModel = "fish-audio/s2.1-pro"
	voxtralSpeechModel = "mistralai/voxtral-mini-tts-2603"

	// Fixed PCM contract for providers that return raw audio: 24kHz mono
	// s16le re-encoded to 192k MP3 for uniform downstream handling.
	pcmSampleRate = "24000"
	pcmChannels   = "1"
	mp3Bitrate    = "192k"

	speechFileWords      = 2
	speechFileTokenRunes = 20
	speechIDPrefixLen    = 8
)

// speechFormat is the closed set of provider audio encodings handled here.
type speechFormat string

const (
	speechFormatMP3 speechFormat = "mp3"
	speechFormatPCM speechFormat = "pcm"
)

type Request struct {
	Input               string `json:"input"`
	Language            string `json:"language,omitempty"`
	Instructions        string `json:"instructions,omitempty"`
	Model               string `json:"model,omitempty"`
	Voice               string `json:"voice,omitempty"`
	ReferenceName       string `json:"referenceName,omitempty"`
	ReferenceTranscript string `json:"referenceTranscript,omitempty"`
}

type generateRequest = Request

type generateResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	MediaType    string `json:"mediaType"`
	SourceMode   string `json:"sourceMode"`
	GenerationID string `json:"generationId,omitempty"`
	Language     string `json:"language,omitempty"`
}

type speechModel = Model

// sharedHTTPClient is reused across requests so connections are pooled
// instead of opening a fresh pool per TTS call.
var sharedHTTPClient = &http.Client{Timeout: providerTimeout}

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

type safeJoinFunc func(string) (string, error)

// Generate resolves the session-scoped data directory then delegates to generate.
func Generate(c *fiber.Ctx) error {
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return generate(c, storage.DataDir, storage.SafeJoin)
	}
	var probe struct {
		ReferenceName string `json:"referenceName"`
	}
	// Best-effort: a malformed body just skips session warming; parseRequest
	// below performs the strict validation.
	_ = json.Unmarshal(c.Body(), &probe)
	if probe.ReferenceName != "" {
		media.WarmSession(c.UserContext(), session, root, probe.ReferenceName)
	}
	return generate(c, root, func(name string) (string, error) {
		return storage.SafeJoinUser(session, name)
	})
}

func generate(c *fiber.Ctx, dataDir string, safeJoin safeJoinFunc) error {
	request, err := parseRequest(c.Body())
	if err != nil {
		return sendHandlerError(c, err)
	}
	model, err := resolveModel(request)
	if err != nil {
		return sendHandlerError(c, err)
	}
	providerRequest, err := buildSpeechProviderRequest(request, model, safeJoin)
	if err != nil {
		return sendHandlerError(c, err)
	}
	config, err := loadOpenRouterConfig()
	if err != nil {
		return sendHandlerError(c, err)
	}
	audio, generationID, err := fetchProviderAudio(c.UserContext(), config, providerRequest, dataDir)
	if err != nil {
		return sendHandlerError(c, err)
	}
	id, name, err := saveGeneratedSpeech(dataDir, safeJoin, audio, request.Input)
	if err != nil {
		return sendHandlerError(c, err)
	}
	return c.JSON(generateResponse{
		ID:           id,
		Name:         name,
		MediaType:    "audio/mpeg",
		SourceMode:   "proxy",
		GenerationID: generationID,
		Language:     request.Language,
	})
}

func buildSpeechProviderRequest(request generateRequest, model speechModel, safeJoin safeJoinFunc) (openrouter.SpeechRequest, error) {
	providerRequest := openrouter.SpeechRequest{
		Model:          model.ID,
		Input:          request.Input,
		Voice:          request.Voice,
		ResponseFormat: string(model.responseFormat()),
	}
	if providerRequest.Voice == "" {
		providerRequest.Voice = model.DefaultVoice
	}
	if model.Instructions {
		providerRequest.Instructions = speechInstructions(request)
	}
	if model.Family == "gemini" {
		providerRequest.Provider = geminiLanguageProvider(request.Language, providerRequest.Voice)
	}
	if request.ReferenceName == "" {
		return providerRequest, nil
	}
	dataURL, err := referenceAudioDataURL(request.ReferenceName, safeJoin)
	if err != nil {
		return openrouter.SpeechRequest{}, err
	}
	providerRequest.InputReferences = append(providerRequest.InputReferences, openrouter.SpeechInputReference{
		Type:       "input_audio",
		InputAudio: &openrouter.SpeechInputAudio{Data: dataURL},
	})
	if request.ReferenceTranscript != "" {
		providerRequest.InputReferences = append(providerRequest.InputReferences, openrouter.SpeechInputReference{
			Type: "text",
			Text: request.ReferenceTranscript,
		})
	}
	return providerRequest, nil
}

func fetchProviderAudio(ctx context.Context, config openRouterConfig, providerRequest openrouter.SpeechRequest, dataDir string) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(ctx, providerTimeout)
	defer cancel()
	providerResponse, err := newOpenRouterClient(config).GenerateSpeech(ctx, providerRequest)
	if err != nil {
		return nil, "", gatewayError("speech provider unavailable", err)
	}
	audio, err := normalizeSpeechAudio(ctx, dataDir, providerResponse.Data, providerResponse.MediaType, speechFormat(providerRequest.ResponseFormat), utils.RunFFmpegContext)
	if err != nil {
		return nil, "", gatewayError("cannot process generated speech", err)
	}
	return audio, providerResponse.GenerationID, nil
}

func (model speechModel) responseFormat() speechFormat {
	if model.ResponseFormat != "" {
		return model.ResponseFormat
	}
	return speechFormatMP3
}

func parseRequest(body []byte) (generateRequest, error) {
	if len(body) > maxRequestBody {
		return generateRequest{}, requestError(fiber.StatusRequestEntityTooLarge, "speech request too large")
	}
	var request generateRequest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return generateRequest{}, requestError(fiber.StatusBadRequest, "invalid JSON: "+err.Error())
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return generateRequest{}, requestError(fiber.StatusBadRequest, "invalid JSON: request must contain one object")
	}
	request.Input = strings.TrimSpace(request.Input)
	request.Model = strings.TrimSpace(request.Model)
	request.Voice = strings.TrimSpace(request.Voice)
	request.ReferenceName = strings.TrimSpace(request.ReferenceName)
	request.ReferenceTranscript = strings.TrimSpace(request.ReferenceTranscript)
	request.Instructions = strings.TrimSpace(request.Instructions)
	if utf8.RuneCountInString(request.Instructions) > maxInputRunes {
		return generateRequest{}, requestError(fiber.StatusBadRequest, "speech instructions are too long")
	}
	if request.Input == "" {
		return generateRequest{}, requestError(fiber.StatusBadRequest, "field 'input' is required")
	}
	if !utf8.ValidString(request.Input) || utf8.RuneCountInString(request.Input) > maxInputRunes {
		return generateRequest{}, requestError(fiber.StatusBadRequest, fmt.Sprintf("field 'input' must contain at most %d characters", maxInputRunes))
	}
	if len(request.ReferenceName) > maxReferenceNameLength {
		return generateRequest{}, requestError(fiber.StatusBadRequest, fmt.Sprintf("field 'referenceName' must contain at most %d characters", maxReferenceNameLength))
	}
	if utf8.RuneCountInString(request.ReferenceTranscript) > maxInputRunes {
		return generateRequest{}, requestError(fiber.StatusBadRequest, fmt.Sprintf("field 'referenceTranscript' must contain at most %d characters", maxInputRunes))
	}
	var err error
	request.Language, err = speechLanguage(request.Input, request.Language)
	if err != nil {
		return generateRequest{}, err
	}
	return request, nil
}

func resolveModel(request generateRequest) (speechModel, error) {
	modelID := request.Model
	if modelID == "" {
		modelID = defaultSpeechModel
		if request.Language == "ro" && request.ReferenceName == "" {
			modelID = geminiSpeechModel
		}
	}
	index := slices.IndexFunc(speechModels, func(model speechModel) bool { return model.ID == modelID })
	if index < 0 {
		return speechModel{}, requestError(fiber.StatusBadRequest, "field 'model' is not an available speech model")
	}
	model := speechModels[index]
	if request.ReferenceName != "" && !model.Cloning {
		return speechModel{}, requestError(fiber.StatusBadRequest, "the selected model does not support voice cloning")
	}
	if request.ReferenceName == "" && len(model.Voices) > 0 && !(model.DefaultVoice != "" && request.Voice == "") && !slices.Contains(model.Voices, request.Voice) {
		return speechModel{}, requestError(fiber.StatusBadRequest, "field 'voice' is not available for the selected model")
	}
	if err := validateSpeechLanguage(request, model); err != nil {
		return speechModel{}, err
	}
	return model, nil
}

func referenceAudioDataURL(name string, safeJoin safeJoinFunc) (string, error) {
	path, err := safeJoin(name)
	if err != nil {
		return "", requestError(fiber.StatusBadRequest, "invalid referenceName")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", requestError(fiber.StatusBadRequest, "voice reference does not exist")
	}
	if info.Size() > maxReferenceSize {
		return "", requestError(fiber.StatusRequestEntityTooLarge, fmt.Sprintf("voice reference exceeds %d MiB limit", maxReferenceSize>>20))
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return "", requestError(fiber.StatusBadRequest, "cannot read voice reference")
	}
	mediaType := referenceMediaType(name, data)
	if mediaType == "" {
		return "", requestError(fiber.StatusUnsupportedMediaType, "voice reference must be MP3 audio")
	}
	return "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func referenceMediaType(name string, data []byte) string {
	if strings.ToLower(filepath.Ext(name)) != ".mp3" {
		return ""
	}
	detected := http.DetectContentType(data)
	if strings.HasPrefix(detected, "text/") || strings.Contains(detected, "json") || strings.Contains(detected, "html") {
		return ""
	}
	return "audio/mpeg"
}

func validateMP3(data []byte, mediaType string) error {
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if mediaType != "" && mediaType != "audio/mpeg" && mediaType != "audio/mp3" && mediaType != "application/octet-stream" {
		return fmt.Errorf("OpenRouter returned unsupported speech format %q", mediaType)
	}
	if len(data) < 3 {
		return fmt.Errorf("OpenRouter returned invalid MP3 audio")
	}
	if string(data[:3]) == "ID3" || data[0] == 0xff && data[1]&0xe0 == 0xe0 {
		return nil
	}
	return fmt.Errorf("OpenRouter returned invalid MP3 audio")
}

type ffmpegRunner func(context.Context, ...string) error

func normalizeSpeechAudio(ctx context.Context, dataDir string, data []byte, mediaType string, responseFormat speechFormat, runFFmpeg ffmpegRunner) ([]byte, error) {
	if err := validateMP3(data, mediaType); err == nil {
		return data, nil
	} else if responseFormat != speechFormatPCM {
		return nil, err
	}

	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if mediaType != "" && mediaType != "audio/pcm" && mediaType != "audio/l16" && mediaType != "application/octet-stream" {
		return nil, fmt.Errorf("OpenRouter returned unsupported speech format %q", mediaType)
	}
	if len(data) < 2 || len(data)%2 != 0 {
		return nil, fmt.Errorf("OpenRouter returned invalid PCM audio")
	}

	input, err := os.CreateTemp(dataDir, ".ai-voice-*.pcm")
	if err != nil {
		return nil, fmt.Errorf("prepare PCM conversion: %w", err)
	}
	inputPath := input.Name()
	outputPath := inputPath + ".mp3"
	defer os.Remove(inputPath)
	defer os.Remove(outputPath)
	if _, err := input.Write(data); err != nil {
		input.Close()
		return nil, fmt.Errorf("write PCM audio: %w", err)
	}
	if err := input.Close(); err != nil {
		return nil, fmt.Errorf("close PCM audio: %w", err)
	}

	if err := runFFmpeg(ctx,
		"-hide_banner", "-loglevel", "error",
		"-f", "s16le", "-ar", pcmSampleRate, "-ac", pcmChannels, "-i", inputPath,
		"-vn", "-c:a", "libmp3lame", "-b:a", mp3Bitrate, "-y", outputPath,
	); err != nil {
		return nil, fmt.Errorf("convert generated PCM to MP3: %w", err)
	}
	converted, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("read converted speech: %w", err)
	}
	if err := validateMP3(converted, "audio/mpeg"); err != nil {
		return nil, fmt.Errorf("validate converted speech: %w", err)
	}
	return converted, nil
}

func speechFileName(input, id string) string {
	short := id
	if len(short) > speechIDPrefixLen {
		short = short[:speechIDPrefixLen]
	}
	words := strings.Fields(input)
	cleaned := make([]string, 0, speechFileWords)
	for _, word := range words {
		var builder strings.Builder
		for _, r := range strings.ToLower(word) {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				builder.WriteRune(r)
			}
		}
		token := builder.String()
		if token == "" {
			continue
		}
		if runes := []rune(token); len(runes) > speechFileTokenRunes {
			token = string(runes[:speechFileTokenRunes])
		}
		cleaned = append(cleaned, token)
		if len(cleaned) == speechFileWords {
			break
		}
	}
	if len(cleaned) == 0 {
		return "voice_" + short + ".mp3"
	}
	return "voice_" + strings.Join(cleaned, "_") + "_" + short + ".mp3"
}

func saveGeneratedSpeech(dataDir string, safeJoin safeJoinFunc, data []byte, input string) (string, string, error) {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", "", fmt.Errorf("generate speech id: %w", err)
	}
	id := hex.EncodeToString(random[:])
	name := speechFileName(input, id)
	outputPath, err := safeJoin(name)
	if err != nil {
		return "", "", fmt.Errorf("resolve generated speech path: %w", err)
	}
	// safeJoin is injected (and mocked in tests), so it cannot be the sole
	// ownership boundary: re-assert containment here before touching disk.
	if filepath.Dir(outputPath) != filepath.Clean(dataDir) {
		return "", "", fmt.Errorf("generated speech path is outside data directory")
	}
	temporary, err := os.CreateTemp(dataDir, ".ai-voice-*")
	if err != nil {
		return "", "", fmt.Errorf("create temporary speech file: %w", err)
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		if !committed {
			temporary.Close()
			os.Remove(temporaryPath)
		}
	}()
	if _, err := temporary.Write(data); err != nil {
		return "", "", fmt.Errorf("write generated speech to temp file: %w", err)
	}
	// Keep 0600 from CreateTemp: session audio is private, no need for 0644.
	if err := temporary.Sync(); err != nil {
		return "", "", fmt.Errorf("sync generated speech file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return "", "", fmt.Errorf("close generated speech file: %w", err)
	}
	if err := os.Rename(temporaryPath, outputPath); err != nil {
		return "", "", fmt.Errorf("commit generated speech file: %w", err)
	}
	committed = true
	return id, name, nil
}

func requestError(status int, message string) error {
	return &handlerError{status: status, message: message}
}

func gatewayError(message string, cause error) error {
	return &handlerError{status: fiber.StatusBadGateway, message: message, cause: cause}
}

func sendHandlerError(c *fiber.Ctx, err error) error {
	var responseError *handlerError
	if errors.As(err, &responseError) {
		return c.Status(responseError.status).SendString(responseError.message)
	}
	return c.Status(fiber.StatusInternalServerError).SendString("speech request failed")
}

type openRouterConfig struct {
	APIKey  string
	BaseURL string
	Referer string
	Title   string
}

func loadOpenRouterConfig() (openRouterConfig, error) {
	config := openRouterConfig{
		APIKey:  strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")),
		BaseURL: strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")),
		Referer: strings.TrimSpace(os.Getenv("OPENROUTER_HTTP_REFERER")),
		Title:   strings.TrimSpace(os.Getenv("OPENROUTER_APP_NAME")),
	}
	if config.Title == "" {
		config.Title = "machinal"
	}
	if config.APIKey == "" {
		return config, requestError(fiber.StatusServiceUnavailable, "speech generation is not configured: set OPENROUTER_API_KEY")
	}
	return config, nil
}

func newOpenRouterClient(config openRouterConfig) openrouter.Client {
	return openrouter.Client{
		APIKey:     config.APIKey,
		BaseURL:    config.BaseURL,
		Referer:    config.Referer,
		Title:      config.Title,
		HTTPClient: sharedHTTPClient,
	}
}
