package imagegen

import (
	"context"
	"encoding/json"
)

// GeneratedImage describes a provider image saved to the data directory.
type GeneratedImage struct {
	ID        string
	Name      string
	MediaType string
	Width     int
	Height    int
	Extension string
}

// GenerateImage runs the full provider flow without an HTTP context so the
// composition orchestrator can execute image.generate jobs declared in YAML.
func GenerateImage(ctx context.Context, dataDir string, safeJoin safeJoinFunc, prompt, model, aspect, background, quality string) (GeneratedImage, error) {
	payload := map[string]string{"prompt": prompt}
	if model != "" {
		payload["model"] = model
	}
	if aspect != "" {
		payload["aspect"] = aspect
	}
	if background != "" {
		payload["background"] = background
	}
	if quality != "" {
		payload["quality"] = quality
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return GeneratedImage{}, err
	}
	request, err := parseRequest(body)
	if err != nil {
		return GeneratedImage{}, err
	}
	resolved, err := resolveImageModel(request)
	if err != nil {
		return GeneratedImage{}, err
	}
	config, err := loadOpenRouterConfig()
	if err != nil {
		return GeneratedImage{}, err
	}
	providerRequest, err := buildImageProviderRequest(request, resolved, safeJoin)
	if err != nil {
		return GeneratedImage{}, err
	}
	if !acquireRequestSlot() {
		return GeneratedImage{}, requestError(429, "AI image generation is busy. Please try again later.")
	}
	defer releaseRequestSlot()
	imageBytes, metadata, err := fetchProviderImage(ctx, config, providerRequest)
	if err != nil {
		return GeneratedImage{}, err
	}
	id, name, err := saveGeneratedImage(dataDir, safeJoin, imageBytes, metadata.extension)
	if err != nil {
		return GeneratedImage{}, err
	}
	return GeneratedImage{ID: id, Name: name, MediaType: metadata.mediaType,
		Width: metadata.width, Height: metadata.height, Extension: metadata.extension}, nil
}
