package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path"
	"strings"

	"ffmpeg-go-server/editengine/document"

	"github.com/gofiber/fiber/v2"
	_ "golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	MaxLocalInspectionFiles = 6
	localThumbnailEdge      = 480
	maxLocalImageBytes      = 32 << 20
	maxLocalImagePixels     = 16_000_000
	maxLocalThumbnailBytes  = 128 << 10
)

type localImageEvidence struct {
	File          string `json:"file"`
	SourceVersion string `json:"sourceVersion"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	MIMEType      string `json:"mimeType"`
	Data          []byte `json:"data"`
}

func (s *LocalSources) Inspect(c *fiber.Ctx) error {
	var request LocalImportRequest
	if document.DecodeJSON(c.Body(), &request) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid local inspection request.")
	}
	if err := validateLocalSelections(request.Files, MaxLocalInspectionFiles); err != nil {
		return err
	}
	root, err := s.open(c, request.RootID)
	if err != nil {
		return err
	}
	defer root.Close()
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return fiber.NewError(fiber.StatusTooManyRequests, "Local image inspection is busy. No import or rendering was started.")
	}
	ctx, cancel := context.WithTimeout(c.UserContext(), localOperationTimeout)
	defer cancel()
	images := []localImageEvidence{}
	for _, selected := range request.Files {
		image, err := inspectLocalImage(ctx, root, selected)
		if err != nil {
			return err
		}
		images = append(images, image)
	}
	return c.JSON(fiber.Map{"images": images, "rootId": request.RootID, "originalsReadOnly": true, "uploaded": false, "credits": 0, "alphaVerified": false, "motionVerified": false})
}

func inspectLocalImage(ctx context.Context, root *os.Root, selected LocalSelection) (localImageEvidence, error) {
	if !strings.Contains("|.jpg|.jpeg|.png|.webp|.gif|.bmp|", "|"+strings.ToLower(path.Ext(selected.File))+"|") {
		return localImageEvidence{}, fiber.NewError(fiber.StatusUnsupportedMediaType, "Local inspection supports raster images only, not video/audio playback.")
	}
	file, info, err := openLocalPath(root, selected.File, false)
	if err != nil {
		return localImageEvidence{}, err
	}
	defer file.Close()
	if info.Size() <= 0 || info.Size() > maxLocalImageBytes {
		return localImageEvidence{}, fiber.NewError(fiber.StatusRequestEntityTooLarge, fmt.Sprintf("Local image inspection is limited to %d bytes per image.", maxLocalImageBytes))
	}
	data, err := io.ReadAll(localContextReader{ctx, io.LimitReader(file, info.Size()+1)})
	if err != nil || int64(len(data)) != info.Size() {
		return localImageEvidence{}, fiber.NewError(fiber.StatusConflict, "Local image changed or inspection was cancelled.")
	}
	version := fmt.Sprintf("sha256:%x", sha256.Sum256(data))
	if selected.SourceVersion != "" && selected.SourceVersion != version {
		return localImageEvidence{}, fiber.NewError(fiber.StatusConflict, "Local image changed since the requested sourceVersion.")
	}
	thumbnail, width, height, err := localThumbnail(data)
	if err != nil {
		return localImageEvidence{}, err
	}
	return localImageEvidence{File: selected.File, SourceVersion: version, Width: width, Height: height, MIMEType: "image/jpeg", Data: thumbnail}, nil
}

func localThumbnail(data []byte) ([]byte, int, int, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return nil, 0, 0, fiber.NewError(fiber.StatusUnsupportedMediaType, "Unsupported or invalid local image.")
	}
	if config.Width > maxLocalImagePixels/config.Height {
		return nil, 0, 0, fiber.NewError(fiber.StatusRequestEntityTooLarge, fmt.Sprintf("Local image inspection is limited to %d decoded pixels.", maxLocalImagePixels))
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, 0, 0, fiber.NewError(fiber.StatusUnsupportedMediaType, "Local image could not be decoded.")
	}
	width, height := config.Width, config.Height
	if edge := max(width, height); edge > localThumbnailEdge {
		width = max(1, width*localThumbnailEdge/edge)
		height = max(1, height*localThumbnailEdge/edge)
	}
	thumbnail := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.CatmullRom.Scale(thumbnail, thumbnail.Bounds(), source, source.Bounds(), draw.Src, nil)
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, thumbnail, &jpeg.Options{Quality: 75}); err != nil || encoded.Len() > maxLocalThumbnailBytes {
		return nil, 0, 0, fiber.NewError(fiber.StatusRequestEntityTooLarge, "Local image thumbnail exceeds the bounded response size.")
	}
	return encoded.Bytes(), config.Width, config.Height, nil
}
