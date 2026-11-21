package imagegen

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/integrations/openrouter"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

const (
	maxRequestBody     = 16 << 10
	maxPromptRunes     = 4000
	maxSourceImageSize = 16 << 20
	maxOutputImageSize = 24 << 20
	// 240s covers slow image providers without hanging the editor forever.
	providerTimeout     = 240 * time.Second
	maxSourceNameLength = 255

	defaultImageModel = "openai/gpt-image-2.6-sunburst"
)

// Closed sets for request validation. Wire values stay plain strings at the
// provider boundary; these types only guard internal comparisons.
type imageAspect string

const (
	aspectAuto imageAspect = "auto"
	aspect1x1  imageAspect = "1:1"
	aspect3x2  imageAspect = "3:2"
	aspect2x3  imageAspect = "2:3"
	aspect4x3  imageAspect = "4:3"
	aspect3x4  imageAspect = "3:4"
	aspect4x5  imageAspect = "4:5"
	aspect16x9 imageAspect = "16:9"
	aspect9x16 imageAspect = "9:16"
	aspect21x9 imageAspect = "21:9"
)

type imageBackground string

const (
	backgroundAuto        imageBackground = "auto"
	backgroundTransparent imageBackground = "transparent"
	backgroundOpaque      imageBackground = "opaque"
)

type imageQuality string

const (
	qualityAuto   imageQuality = "auto"
	qualityLow    imageQuality = "low"
	qualityMedium imageQuality = "medium"
	qualityHigh   imageQuality = "high"
)

var allowedAspects = []string{"auto", "1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "16:9", "9:16", "21:9"}
var allowedBackgrounds = []string{"auto", "transparent", "opaque"}
var allowedQualities = []string{"auto", "low", "medium", "high"}

var requestSlots = make(chan struct{}, ConcurrencyLimit())

// sharedHTTPClient is reused across requests so generations share one pooled
// transport instead of building a client per call.
var sharedHTTPClient = &http.Client{Timeout: providerTimeout}

type generateRequest struct {
	Prompt     string `json:"prompt"`
	SourceName string `json:"sourceName,omitempty"`
	Model      string `json:"model,omitempty"`
	Aspect     string `json:"aspect,omitempty"`
	Background string `json:"background,omitempty"`
	Quality    string `json:"quality,omitempty"`
}

type generateResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	MediaType  string `json:"mediaType"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	SourceMode string `json:"sourceMode"`
	Warning    string `json:"warning,omitempty"`
}

type openRouterConfig struct {
	APIKey  string
	BaseURL string
	Referer string
	Title   string
}

type imageModel struct {
	ID          string
	Resolution  string
	Quality     string
	Aspects     []string
	Backgrounds []string
	Formats     []string
}

// Image model catalog: data, not logic. Add models here without touching
// the request flow below.
var imageModels = []imageModel{
	{
		ID:          defaultImageModel,
		Quality:     "low",
		Aspects:     []string{"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"},
		Backgrounds: []string{"auto", "transparent", "opaque"},
	},
	{
		ID:          "openai/gpt-image-2.5-flare",
		Quality:     "low",
		Aspects:     []string{"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"},
		Backgrounds: []string{"auto", "transparent", "opaque"},
	},
	{
		ID:          "openai/gpt-image-2",
		Quality:     "low",
		Aspects:     []string{"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"},
		Backgrounds: []string{"auto", "opaque"},
	},
	{
		ID:      "black-forest-labs/flux.2-klein-4b",
		Aspects: []string{"1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "auto"},
		Formats: []string{"png", "jpeg"},
	},
	{
		ID:         "krea/krea-2-medium-turbo",
		Resolution: "1K",
		Aspects:    []string{"1:1", "4:3", "3:2", "16:9", "4:5", "2:3", "9:16"},
	},
	{
		ID:          "sourceful/riverflow-v2.5-fast",
		Resolution:  "1K",
		Aspects:     []string{"1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "auto"},
		Backgrounds: []string{"auto", "opaque"},
		Formats:     []string{"jpeg"},
	},
	{
		ID:      "google/gemini-2.5-flash-image",
		Aspects: []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "9:16", "16:9", "21:9"},
	},
	{
		ID:         "qwen/qwen-image-3",
		Resolution: "1K",
		Aspects:    []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "9:16", "16:9"},
	},
	{
		ID:         "bytedance-seed/seedream-5-0-lite",
		Resolution: "2K",
		Aspects:    []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "9:16", "16:9", "21:9", "auto"},
	},
	{
		ID:      "recraft/recraft-v4.1",
		Aspects: []string{"1:1", "4:3", "3:4", "16:9", "9:16", "auto"},
	},
	{
		ID:         "x-ai/grok-imagine-image-2.0",
		Resolution: "1K",
		Quality:    "low",
		Aspects:    []string{"1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "auto"},
	},
}

type safeJoinFunc func(string) (string, error)

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

// Generate resolves the session-scoped data directory then delegates to generate.
func Generate(c *fiber.Ctx) error {
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return generate(c, storage.DataDir, storage.SafeJoin)
	}
	var probe struct {
		SourceName string `json:"sourceName"`
	}
	// Best-effort: a malformed body just skips session warming; parseRequest
	// below performs the strict validation.
	_ = json.Unmarshal(c.Body(), &probe)
	if probe.SourceName != "" {
		media.WarmSession(c.UserContext(), session, root, probe.SourceName)
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

	model, err := resolveImageModel(request)
	if err != nil {
		return sendHandlerError(c, err)
	}

	config, err := loadOpenRouterConfig()
	if err != nil {
		return sendHandlerError(c, err)
	}

	providerRequest, err := buildImageProviderRequest(request, model, safeJoin)
	if err != nil {
		return sendHandlerError(c, err)
	}

	if !acquireRequestSlot() {
		return sendHandlerError(c, requestError(fiber.StatusTooManyRequests, "AI image generation is busy. Please try again later."))
	}
	defer releaseRequestSlot()

	imageBytes, metadata, err := fetchProviderImage(c.UserContext(), config, providerRequest)
	if err != nil {
		return sendHandlerError(c, err)
	}
	warning := transparentWarning(request.Background, imageBytes, metadata.mediaType)

	id, name, err := saveGeneratedImage(dataDir, safeJoin, imageBytes, metadata.extension)
	if err != nil {
		return sendHandlerError(c, err)
	}

	return c.JSON(generateResponse{
		ID:         id,
		Name:       name,
		MediaType:  metadata.mediaType,
		Width:      metadata.width,
		Height:     metadata.height,
		SourceMode: "proxy",
		Warning:    warning,
	})
}

func buildImageProviderRequest(request generateRequest, model imageModel, safeJoin safeJoinFunc) (openrouter.ImageRequest, error) {
	providerRequest := openrouter.ImageRequest{
		Model:       model.ID,
		Prompt:      request.Prompt,
		Resolution:  model.Resolution,
		AspectRatio: request.Aspect,
		Quality:     model.Quality,
	}
	if slices.Contains(model.Backgrounds, request.Background) {
		providerRequest.Background = request.Background
	}
	if request.Background == string(backgroundTransparent) && slices.Contains(model.Formats, "png") {
		providerRequest.OutputFormat = "png"
	}
	if request.SourceName == "" {
		return providerRequest, nil
	}
	dataURL, err := sourceImageDataURL(request.SourceName, safeJoin)
	if err != nil {
		return openrouter.ImageRequest{}, err
	}
	providerRequest.InputReferences = []openrouter.ImageInputReference{
		openrouter.DataURLImageReference(dataURL),
	}
	return providerRequest, nil
}

func fetchProviderImage(ctx context.Context, config openRouterConfig, providerRequest openrouter.ImageRequest) ([]byte, rasterMetadata, error) {
	ctx, cancel := context.WithTimeout(ctx, providerTimeout)
	defer cancel()
	providerResponse, err := newOpenRouterClient(config).GenerateImage(ctx, providerRequest)
	if err != nil {
		return nil, rasterMetadata{}, gatewayError("image provider unavailable", err)
	}
	if len(providerResponse.Data) == 0 || providerResponse.Data[0].B64JSON == "" {
		return nil, rasterMetadata{}, gatewayError("image provider returned no data", nil)
	}

	imageBytes, err := base64.StdEncoding.DecodeString(providerResponse.Data[0].B64JSON)
	if err != nil {
		return nil, rasterMetadata{}, gatewayError("image provider returned invalid data", err)
	}
	if len(imageBytes) == 0 || len(imageBytes) > maxOutputImageSize {
		return nil, rasterMetadata{}, gatewayError("image provider returned an invalid size", nil)
	}

	metadata, err := validateOutputRaster(imageBytes, providerResponse.Data[0].MediaType)
	if err != nil {
		// Validation messages describe the image format mismatch only
		// (no provider internals), so they are safe to return verbatim.
		return nil, rasterMetadata{}, &handlerError{status: fiber.StatusBadGateway, message: err.Error(), cause: err}
	}
	return imageBytes, metadata, nil
}

func transparentWarning(background string, imageBytes []byte, mediaType string) string {
	if background == string(backgroundTransparent) && (mediaType != "image/png" || requireTransparentPixel(imageBytes) != nil) {
		return "The provider returned an opaque image, so it was kept without transparency."
	}
	return ""
}

func acquireRequestSlot() bool {
	select {
	case requestSlots <- struct{}{}:
		return true
	default:
		return false
	}
}

func releaseRequestSlot() {
	<-requestSlots
}

func parseRequest(body []byte) (generateRequest, error) {
	if len(body) > maxRequestBody {
		return generateRequest{}, requestError(fiber.StatusRequestEntityTooLarge, "image request too large")
	}

	var request generateRequest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return generateRequest{}, requestError(fiber.StatusBadRequest, "invalid JSON: "+err.Error())
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return generateRequest{}, requestError(fiber.StatusBadRequest, "invalid JSON: request must contain one object")
	}

	request.Prompt = strings.TrimSpace(request.Prompt)
	request.SourceName = strings.TrimSpace(request.SourceName)
	request.Model = strings.TrimSpace(request.Model)
	request.Aspect = strings.TrimSpace(request.Aspect)
	request.Background = strings.TrimSpace(request.Background)
	request.Quality = strings.TrimSpace(request.Quality)

	if request.Prompt == "" {
		return generateRequest{}, badRequest("field 'prompt' is required")
	}
	if !utf8.ValidString(request.Prompt) || utf8.RuneCountInString(request.Prompt) > maxPromptRunes {
		return generateRequest{}, badRequest(fmt.Sprintf("field 'prompt' must contain at most %d characters", maxPromptRunes))
	}
	if request.SourceName != "" && len(request.SourceName) > maxSourceNameLength {
		return generateRequest{}, badRequest(fmt.Sprintf("field 'sourceName' must contain at most %d characters", maxSourceNameLength))
	}
	if !oneOfOrEmpty(request.Aspect, allowedAspects...) {
		return generateRequest{}, badRequest("field 'aspect' is not a supported aspect ratio")
	}
	if !oneOfOrEmpty(request.Background, allowedBackgrounds...) {
		return generateRequest{}, badRequest("field 'background' must be one of auto, transparent, or opaque")
	}
	if !oneOfOrEmpty(request.Quality, allowedQualities...) {
		return generateRequest{}, badRequest("field 'quality' must be one of auto, low, medium, or high")
	}

	return request, nil
}

func resolveImageModel(request generateRequest) (imageModel, error) {
	modelID := request.Model
	if modelID == "" {
		modelID = defaultImageModel
	}
	index := slices.IndexFunc(imageModels, func(model imageModel) bool { return model.ID == modelID })
	if index < 0 {
		return imageModel{}, badRequest("field 'model' is not an available image model")
	}
	model := imageModels[index]
	if request.Aspect != "" && !slices.Contains(model.Aspects, request.Aspect) {
		return imageModel{}, badRequest("field 'aspect' is not supported by the selected model")
	}
	if request.Background == string(backgroundTransparent) && !slices.Contains(model.Backgrounds, string(backgroundTransparent)) {
		return imageModel{}, badRequest("transparent backgrounds are not supported by the selected model")
	}
	return model, nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return fmt.Errorf("unexpected data after request")
	}
	return nil
}

func oneOfOrEmpty(value string, allowed ...string) bool {
	if value == "" {
		return true
	}

	return slices.Contains(allowed, value)
}

func badRequest(message string) error {
	return &handlerError{status: fiber.StatusBadRequest, message: message}
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
	return c.Status(fiber.StatusInternalServerError).SendString("image request failed")
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
		return config, requestError(fiber.StatusServiceUnavailable, "image generation is not configured: set OPENROUTER_API_KEY")
	}
	return config, nil
}

func newOpenRouterClient(config openRouterConfig) openrouter.Client {
	return openrouter.Client{
		APIKey:     config.APIKey,
		BaseURL:    config.BaseURL,
		Debug:      strings.EqualFold(strings.TrimSpace(os.Getenv("DEBUGGING")), "true"),
		HTTPClient: sharedHTTPClient,
		Referer:    config.Referer,
		Title:      config.Title,
	}
}
