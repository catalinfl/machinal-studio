package imagegen

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const (
	maxImageDimension = 16384
	maxImagePixels    = 64_000_000
)

type rasterMetadata struct {
	mediaType string
	extension string
	width     int
	height    int
}

var outputExtensions = map[string]string{
	"image/png":  "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
}

var sourceMediaTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif":  true,
	"image/bmp":  true,
}

func sourceImageDataURL(name string, safeJoin safeJoinFunc) (string, error) {
	path, err := safeJoin(name)
	if err != nil {
		return "", badRequest("invalid sourceName")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", badRequest("source image does not exist")
	}
	if info.Size() > maxSourceImageSize {
		return "", oversizedSourceError()
	}

	file, err := os.Open(path)
	if err != nil {
		return "", requestErrorWithCause(fiber.StatusBadRequest, err, "cannot read source image")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSourceImageSize+1))
	if err != nil {
		return "", requestErrorWithCause(fiber.StatusBadRequest, err, "cannot read source image")
	}
	if len(data) > maxSourceImageSize {
		return "", oversizedSourceError()
	}
	if len(data) == 0 {
		return "", unsupportedSource()
	}

	mediaType := detectedMediaType(data)
	if !sourceMediaTypes[mediaType] {
		return "", unsupportedSource()
	}
	if _, _, err := rasterDimensions(data, mediaType); err != nil {
		return "", unsupportedSource()
	}

	return "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func oversizedSourceError() error {
	return requestError(fiber.StatusRequestEntityTooLarge, fmt.Sprintf("source image exceeds %d MiB limit", maxSourceImageSize>>20))
}

func requestErrorWithCause(status int, cause error, message string) error {
	return &handlerError{status: status, message: message, cause: cause}
}

func unsupportedSource() error {
	return &handlerError{
		status:  fiber.StatusUnsupportedMediaType,
		message: "sourceName must refer to a valid raster image; SVG is not supported",
	}
}

func validateOutputRaster(data []byte, declaredMediaType string) (rasterMetadata, error) {
	declaredMediaType = normalizedMediaType(declaredMediaType)
	if declaredMediaType != "" {
		if _, allowed := outputExtensions[declaredMediaType]; !allowed {
			return rasterMetadata{}, fmt.Errorf("OpenRouter returned unsupported image format %q; only PNG, JPEG, and WebP are allowed", declaredMediaType)
		}
	}

	mediaType := detectedMediaType(data)
	extension, allowed := outputExtensions[mediaType]
	if !allowed {
		return rasterMetadata{}, fmt.Errorf("OpenRouter returned a non-raster or unsupported image; only PNG, JPEG, and WebP are allowed")
	}
	if declaredMediaType != "" && declaredMediaType != mediaType {
		return rasterMetadata{}, fmt.Errorf("OpenRouter image media type does not match its content")
	}

	width, height, err := rasterDimensions(data, mediaType)
	if err != nil {
		return rasterMetadata{}, fmt.Errorf("OpenRouter returned an invalid %s image: %w", strings.TrimPrefix(mediaType, "image/"), err)
	}
	return rasterMetadata{
		mediaType: mediaType,
		extension: extension,
		width:     width,
		height:    height,
	}, nil
}

func detectedMediaType(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	return normalizedMediaType(http.DetectContentType(data))
}

func normalizedMediaType(mediaType string) string {
	mediaType = strings.ToLower(strings.TrimSpace(strings.Split(mediaType, ";")[0]))
	if mediaType == "image/jpg" {
		return "image/jpeg"
	}
	return mediaType
}

func rasterDimensions(data []byte, mediaType string) (int, int, error) {
	var width, height int
	var err error
	switch mediaType {
	case "image/png", "image/jpeg", "image/gif":
		config, _, decodeErr := image.DecodeConfig(bytes.NewReader(data))
		if decodeErr != nil {
			return 0, 0, fmt.Errorf("decode image config: %w", decodeErr)
		}
		width, height = config.Width, config.Height
	case "image/webp":
		width, height, err = webPDimensions(data)
	case "image/bmp":
		width, height, err = bmpDimensions(data)
	default:
		err = fmt.Errorf("unsupported image type %q", mediaType)
	}
	if err != nil {
		return 0, 0, err
	}
	if width <= 0 || height <= 0 || width > maxImageDimension || height > maxImageDimension || int64(width)*int64(height) > maxImagePixels {
		return 0, 0, fmt.Errorf("invalid image dimensions %dx%d", width, height)
	}
	return width, height, nil
}

func webPDimensions(data []byte) (int, int, error) {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return 0, 0, fmt.Errorf("invalid WebP header")
	}
	riffEnd := int64(binary.LittleEndian.Uint32(data[4:8])) + 8
	if riffEnd < 12 || riffEnd > int64(len(data)) {
		return 0, 0, fmt.Errorf("invalid WebP size")
	}

	for offset := int64(12); offset+8 <= riffEnd; {
		chunkSize := int64(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		payloadStart := offset + 8
		payloadEnd := payloadStart + chunkSize
		if payloadEnd < payloadStart || payloadEnd > riffEnd {
			return 0, 0, fmt.Errorf("invalid WebP chunk")
		}
		payload := data[payloadStart:payloadEnd]
		switch string(data[offset : offset+4]) {
		case "VP8X":
			if len(payload) < 10 {
				return 0, 0, fmt.Errorf("invalid VP8X chunk")
			}
			return 1 + littleEndian24(payload[4:7]), 1 + littleEndian24(payload[7:10]), nil
		case "VP8 ":
			if len(payload) < 10 || !bytes.Equal(payload[3:6], []byte{0x9d, 0x01, 0x2a}) {
				return 0, 0, fmt.Errorf("invalid VP8 chunk")
			}
			width := int(binary.LittleEndian.Uint16(payload[6:8]) & 0x3fff)
			height := int(binary.LittleEndian.Uint16(payload[8:10]) & 0x3fff)
			return width, height, nil
		case "VP8L":
			if len(payload) < 5 || payload[0] != 0x2f {
				return 0, 0, fmt.Errorf("invalid VP8L chunk")
			}
			width := 1 + int(payload[1]) + int(payload[2]&0x3f)<<8
			height := 1 + int(payload[2]>>6) + int(payload[3])<<2 + int(payload[4]&0x0f)<<10
			return width, height, nil
		}
		offset = payloadEnd + chunkSize%2
	}
	return 0, 0, fmt.Errorf("WebP image chunk not found")
}

func littleEndian24(data []byte) int {
	return int(data[0]) | int(data[1])<<8 | int(data[2])<<16
}

func bmpDimensions(data []byte) (int, int, error) {
	if len(data) < 26 || string(data[:2]) != "BM" {
		return 0, 0, fmt.Errorf("invalid BMP header")
	}
	dibSize := binary.LittleEndian.Uint32(data[14:18])
	if dibSize == 12 {
		return int(binary.LittleEndian.Uint16(data[18:20])), int(binary.LittleEndian.Uint16(data[20:22])), nil
	}
	if dibSize < 40 {
		return 0, 0, fmt.Errorf("unsupported BMP header size %d", dibSize)
	}
	width := int(int32(binary.LittleEndian.Uint32(data[18:22])))
	height := int(int32(binary.LittleEndian.Uint32(data[22:26])))
	if width < 0 {
		width = -width
	}
	if height < 0 {
		height = -height
	}
	return width, height, nil
}

func requireTransparentPixel(data []byte) error {
	decoded, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("decode transparency check image: %w", err)
	}
	if format != "png" {
		return fmt.Errorf("transparency check requires PNG, got %s", format)
	}
	bounds := decoded.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, alpha := decoded.At(x, y).RGBA()
			if alpha < 0xffff {
				return nil
			}
		}
	}
	return fmt.Errorf("OpenRouter returned an opaque image for a transparent background request")
}

func saveGeneratedImage(dataDir string, safeJoin safeJoinFunc, data []byte, extension string) (string, string, error) {
	id, err := randomImageID()
	if err != nil {
		return "", "", fmt.Errorf("generate image id: %w", err)
	}
	name := "ai_image_" + id + "." + extension
	outputPath, err := safeJoin(name)
	if err != nil {
		return "", "", fmt.Errorf("resolve generated image path: %w", err)
	}
	// safeJoin is injected (and mocked in tests), so it cannot be the sole
	// ownership boundary: re-assert containment before touching disk.
	if filepath.Dir(outputPath) != filepath.Clean(dataDir) {
		return "", "", fmt.Errorf("generated image path is outside data directory")
	}

	temporary, err := os.CreateTemp(dataDir, ".ai-image-*")
	if err != nil {
		return "", "", fmt.Errorf("create temporary image file: %w", err)
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
		return "", "", fmt.Errorf("write generated image to temp file: %w", err)
	}
	// Keep 0600 from CreateTemp: session images are private.
	if err := temporary.Sync(); err != nil {
		return "", "", fmt.Errorf("sync generated image file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return "", "", fmt.Errorf("close generated image file: %w", err)
	}
	if err := os.Rename(temporaryPath, outputPath); err != nil {
		return "", "", fmt.Errorf("commit generated image file: %w", err)
	}
	committed = true
	return id, name, nil
}

func randomImageID() (string, error) {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", fmt.Errorf("read random image id: %w", err)
	}
	return hex.EncodeToString(random[:]), nil
}
