package render

import (
	"bytes"
	"cmp"
	"context"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

type textLayerSpan struct {
	start, end int
	item       int
	raster     image.Rectangle
}

type textLayer struct {
	bounds image.Rectangle
	spans  []textLayerSpan
}

type fusedTextInput struct {
	index int
	layer textLayer
}

const (
	// Bound the canvas allocation and PNG packing work independently.
	maxTextLayerPixels       = 2 * 1024 * 1024
	maxTextLayerRasterPixels = 256 * 1024 * 1024
	textLayerMicrosPerSecond = 1_000_000
	minTextLayerStates       = 8
	maxFusedTextLayers       = 4
)

func planFusedTextInputs(items []textItem, width, height, fps, frames int) ([]fusedTextInput, bool) {
	var inputs []fusedTextInput
	packedLayers, packedPixels := 0, int64(0)
	for start := 0; start < len(items); {
		if len(inputs) == maxTextOverlaysPerPass {
			return nil, false
		}
		end := start + 1
		if !textHasCueMotion(items[start]) {
			for end < len(items) && !textHasCueMotion(items[end]) {
				end++
			}
		}
		if end-start >= minTextLayerStates && packedLayers < maxFusedTextLayers {
			layer, ok := planTextLayer(items[start:end], width, height, fps, frames)
			if cost := layer.pixelCost(); ok && packedPixels+cost <= maxTextLayerRasterPixels {
				inputs = append(inputs, fusedTextInput{index: start, layer: layer})
				packedLayers++
				packedPixels += cost
				start = end
				continue
			}
		}
		if len(inputs)+end-start > maxTextOverlaysPerPass {
			return nil, false
		}
		for index := start; index < end; index++ {
			inputs = append(inputs, fusedTextInput{index: index})
		}
		start = end
	}
	return inputs, true
}

func textHasCueMotion(item textItem) bool {
	return item.Animation != "" && item.Animation != "none"
}

func (layer textLayer) pixelCost() int64 {
	return int64(layer.bounds.Dx()) * int64(layer.bounds.Dy()) * int64(len(layer.spans))
}

// Word animation is already rasterized. Cue-level motion and overlapping rasters
// within a run still need separate filters to preserve their placement and order.
func planTextLayer(items []textItem, width, height, fps, totalFrames int) (textLayer, bool) {
	if width%2 != 0 || height%2 != 0 {
		return textLayer{}, false
	}
	canvas := image.Rect(0, 0, width, height)
	var layer textLayer
	for index, item := range items {
		start, end := textOverlayFrameRange(item, fps, totalFrames)
		if end <= start {
			continue
		}
		if textHasCueMotion(item) {
			return textLayer{}, false
		}
		config, err := png.DecodeConfig(bytes.NewReader(item.data))
		if err != nil || config.Width > maxRenderDim || config.Height > maxRenderDim {
			return textLayer{}, false
		}
		// The existing FFmpeg overlay filter aligns positions to the 4:2:0
		// chroma grid, including negative coordinates.
		origin := image.Pt(item.X&^1, item.Y&^1)
		if !origin.In(image.Rect(-config.Width+1, -config.Height+1, canvas.Max.X, canvas.Max.Y)) {
			continue
		}
		raster := image.Rectangle{Min: origin, Max: origin.Add(image.Pt(config.Width, config.Height))}
		visible := raster.Intersect(canvas)
		visible.Max = image.Pt((visible.Max.X+1)&^1, (visible.Max.Y+1)&^1)
		layer.bounds = layer.bounds.Union(visible)
		layer.spans = append(layer.spans, textLayerSpan{start: start, end: end, item: index, raster: raster})
	}
	slices.SortFunc(layer.spans, func(a, b textLayerSpan) int { return cmp.Compare(a.start, b.start) })
	for index := 1; index < len(layer.spans); index++ {
		if layer.spans[index].start < layer.spans[index-1].end {
			return textLayer{}, false
		}
	}
	area := layer.bounds.Dx() * layer.bounds.Dy()
	if area == 0 || area > maxTextLayerPixels || layer.pixelCost() > maxTextLayerRasterPixels {
		return textLayer{}, false
	}
	return layer, true
}

func writeTextLayer(ctx context.Context, work string, layer textLayer, items []textItem, fps, totalFrames int) (string, error) {
	const blank = "caption_blank.png"
	canvas := image.NewNRGBA(image.Rectangle{Max: layer.bounds.Size()})
	encoder := png.Encoder{CompressionLevel: png.BestSpeed, BufferPool: &textLayerPNGBuffer{}}
	if err := writeTextLayerPNG(filepath.Join(work, blank), &encoder, canvas); err != nil {
		return "", err
	}
	var manifest strings.Builder
	manifest.WriteString("ffconcat version 1.0\n")
	appendSpan := func(name string, start, end int) {
		duration := textFrameMicros(end, fps) - textFrameMicros(start, fps)
		fmt.Fprintf(&manifest, "file %s\noption framerate %d\nduration %d.%06d\n", name, fps, duration/textLayerMicrosPerSecond, duration%textLayerMicrosPerSecond)
	}
	cursor := 0
	for _, span := range layer.spans {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if cursor < span.start {
			appendSpan(blank, cursor, span.start)
		}
		name := fmt.Sprintf("caption_%d.png", span.item)
		path := filepath.Join(work, name)
		if err := writeTextLayerRaster(path, &encoder, canvas, span.raster.Sub(layer.bounds.Min), items[span.item].data); err != nil {
			return "", err
		}
		appendSpan(name, span.start, span.end)
		cursor = span.end
	}
	if cursor < totalFrames {
		appendSpan(blank, cursor, totalFrames)
	}
	// The final transparent packet makes framesync hold each previous state
	// through its end even if the overlay decoder reaches EOF early.
	appendSpan(blank, totalFrames, totalFrames+1)
	path := filepath.Join(work, "captions.ffconcat")
	if err := os.WriteFile(path, []byte(manifest.String()), 0o600); err != nil {
		return "", fmt.Errorf("write caption layer manifest: %w", err)
	}
	return path, nil
}

// Each layer is written serially, so a single scratch buffer can serve every PNG.
type textLayerPNGBuffer struct{ buffer *png.EncoderBuffer }

func (pool *textLayerPNGBuffer) Get() *png.EncoderBuffer       { return pool.buffer }
func (pool *textLayerPNGBuffer) Put(buffer *png.EncoderBuffer) { pool.buffer = buffer }

func textFrameMicros(frame, fps int) int64 {
	return (int64(frame)*textLayerMicrosPerSecond + int64(fps)/2) / int64(fps)
}

func writeTextLayerRaster(path string, encoder *png.Encoder, canvas *image.NRGBA, target image.Rectangle, data []byte) error {
	// Every packet has the same dimensions and PNG color type. The RGBA
	// fast case keeps the original Canvas output without decoding it again.
	if target == canvas.Bounds() && len(data) >= 26 && data[24] == 8 && data[25] == 6 {
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return fmt.Errorf("write caption layer raster: %w", err)
		}
		return nil
	}
	raster, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("decode caption layer raster: %w", err)
	}
	clear(canvas.Pix)
	draw.Draw(canvas, target, raster, raster.Bounds().Min, draw.Src)
	return writeTextLayerPNG(path, encoder, canvas)
}

func writeTextLayerPNG(path string, encoder *png.Encoder, canvas *image.NRGBA) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create caption layer raster: %w", err)
	}
	var raster image.Image = canvas
	if canvas.Opaque() {
		raster = alphaTextRaster{canvas}
	}
	encodeErr := encoder.Encode(file, raster)
	closeErr := file.Close()
	if encodeErr != nil {
		return fmt.Errorf("encode caption layer raster: %w", encodeErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close caption layer raster: %w", closeErr)
	}
	return nil
}

type alphaTextRaster struct{ *image.NRGBA }

func (alphaTextRaster) Opaque() bool { return false }

func prepareTextLayer(items []textItem, layer textLayer, fps, frames int, work string, progress *renderProgress) (string, error) {
	if err := os.Mkdir(work, 0o700); err != nil {
		return "", fmt.Errorf("create caption layer work dir: %w", err)
	}
	ctx := context.Background()
	if progress != nil && progress.ctx != nil {
		ctx = progress.ctx
	}
	if progress != nil {
		progress.report(0, "preparing caption layer", true)
	}
	started := time.Now()
	path, err := writeTextLayer(ctx, work, layer, items, fps, frames)
	log.Printf("render_caption_layer states=%d width=%d height=%d elapsed_ms=%d success=%t",
		len(layer.spans), layer.bounds.Dx(), layer.bounds.Dy(), time.Since(started).Milliseconds(), err == nil)
	return path, err
}
