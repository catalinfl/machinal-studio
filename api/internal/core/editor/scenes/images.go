package scenes

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/storage"
	_ "golang.org/x/image/webp"
)

const (
	maxSceneImages      = 4
	maxImageBytes       = 5 << 20
	maxImagePixels      = 40_000_000
	maxImageDescription = 600
)

var imageID = regexp.MustCompile(`^image_[1-4]$`)

type sceneImageError struct {
	message string
	cause   error
}

func (err *sceneImageError) Error() string { return err.message + ": " + err.cause.Error() }
func (err *sceneImageError) Unwrap() error { return err.cause }

type SceneImage struct {
	ID          string `json:"id"`
	File        string `json:"file"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Width       int    `json:"width,omitempty"`
	Height      int    `json:"height,omitempty"`
	DataURL     string `json:"-"`
}

func validateImageInputs(images []SceneImage) error {
	if len(images) > maxSceneImages {
		return fmt.Errorf("attach at most %d images", maxSceneImages)
	}
	seen := make(map[string]bool)
	for _, item := range images {
		if !imageID.MatchString(item.ID) || seen[item.ID] {
			return fmt.Errorf("each scene image needs a unique image_1 through image_%d ID", maxSceneImages)
		}
		seen[item.ID] = true
		if item.File == "" || len(item.File) > 255 || strings.ContainsAny(item.File, `/\`) || item.File == "." || item.File == ".." {
			return fmt.Errorf("choose an uploaded image filename")
		}
		if strings.TrimSpace(item.Name) == "" || len(item.Name) > 255 || utf8.RuneCountInString(item.Description) > maxImageDescription {
			return fmt.Errorf("each image needs a name and directions of at most %d characters", maxImageDescription)
		}
	}
	return nil
}

func loadSceneImages(ctx context.Context, session, root string, inputs []SceneImage) ([]SceneImage, error) {
	images := make([]SceneImage, 0, len(inputs))
	for _, input := range inputs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		media.WarmSession(ctx, session, root, input.File)
		loaded, err := readSceneImage(root, input)
		if err != nil {
			return nil, &sceneImageError{message: fmt.Sprintf("Could not use %q. Choose a valid JPEG, PNG or WebP image up to %d MB and %d million pixels.", input.Name, maxImageBytes>>20, maxImagePixels/1_000_000), cause: err}
		}
		images = append(images, loaded)
	}
	return images, nil
}

func readSceneImage(root string, input SceneImage) (SceneImage, error) {
	path, err := storage.SafeJoinIn(root, input.File)
	if err != nil {
		return SceneImage{}, fmt.Errorf("resolve scene image: %w", err)
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return SceneImage{}, fmt.Errorf("image does not exist")
	}
	if info.Size() > maxImageBytes {
		return SceneImage{}, fmt.Errorf("choose images smaller than %d MB each", maxImageBytes>>20)
	}
	file, err := os.Open(path)
	if err != nil {
		return SceneImage{}, fmt.Errorf("open scene image: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxImageBytes+1))
	if err != nil {
		return SceneImage{}, fmt.Errorf("read scene image: %w", err)
	}
	if len(data) == 0 || len(data) > maxImageBytes {
		return SceneImage{}, fmt.Errorf("image is empty or exceeds %d MB", maxImageBytes>>20)
	}
	mediaType := http.DetectContentType(data)
	if mediaType != "image/png" && mediaType != "image/jpeg" && mediaType != "image/webp" {
		return SceneImage{}, fmt.Errorf("choose a JPEG, PNG or WebP image")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return SceneImage{}, fmt.Errorf("decode scene image: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxImagePixels {
		return SceneImage{}, fmt.Errorf("image must contain at most %d million pixels", maxImagePixels/1_000_000)
	}
	input.Width, input.Height = config.Width, config.Height
	input.DataURL = "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(data)
	return input, nil
}

func imageSources(images []SceneImage) map[string]string {
	if len(images) == 0 {
		return nil
	}
	sources := make(map[string]string, len(images))
	for _, image := range images {
		sources[image.ID] = image.DataURL
	}
	return sources
}

func validateImageSources(images map[string]string) error {
	if len(images) > maxSceneImages {
		return fmt.Errorf("scene contains too many images")
	}
	for id, source := range images {
		allowed := strings.HasPrefix(source, "data:image/png;base64,") || strings.HasPrefix(source, "data:image/jpeg;base64,") || strings.HasPrefix(source, "data:image/webp;base64,")
		if !imageID.MatchString(id) || !allowed || len(source) > base64.StdEncoding.EncodedLen(maxImageBytes)+64 {
			return fmt.Errorf("scene contains an invalid embedded image")
		}
	}
	return nil
}
