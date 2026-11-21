package sceneasset

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"strings"

	"ffmpeg-go-server/editengine/document"
)

const maxManifestBytes = 4 << 20

// Imported preserves scene provenance beside the ordinary editengine asset.
type Imported struct {
	Asset document.Asset
	Scene json.RawMessage
}

type manifest struct {
	Version  int             `json:"version"`
	SHA256   string          `json:"sha256"`
	Size     int64           `json:"size"`
	Duration float64         `json:"duration"`
	Width    int             `json:"width"`
	Height   int             `json:"height"`
	FPS      float64         `json:"fps"`
	Frames   int             `json:"frames"`
	HasAudio bool            `json:"hasAudio"`
	Scene    json.RawMessage `json:"scene"`
}

// Import verifies a staged application-owned file against a renderer manifest.
// The renderer's absolute filename is never used to access application storage.
func Import(root, filename, id string, source io.Reader) (Imported, error) {
	if strings.TrimSpace(id) == "" || strings.TrimSpace(filename) == "" {
		return Imported{}, fmt.Errorf("asset ID and staged filename are required")
	}
	result, err := decodeManifest(source)
	if err != nil {
		return Imported{}, err
	}
	storage, err := os.OpenRoot(root)
	if err != nil {
		return Imported{}, fmt.Errorf("open scene asset storage: %w", err)
	}
	defer storage.Close()
	file, err := storage.Open(filename)
	if err != nil {
		return Imported{}, fmt.Errorf("open staged scene asset: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return Imported{}, fmt.Errorf("verify scene asset: %w", err)
	}
	if size != result.Size || hex.EncodeToString(hash.Sum(nil)) != result.SHA256 {
		return Imported{}, fmt.Errorf("scene asset bytes do not match the manifest")
	}
	return Imported{
		Asset: document.Asset{ID: id, File: filename, Kind: "video", Version: "sha256:" + result.SHA256, Duration: document.Seconds(result.Duration), Width: result.Width, Height: result.Height, HasAudio: result.HasAudio},
		Scene: result.Scene,
	}, nil
}

func decodeManifest(source io.Reader) (manifest, error) {
	data, err := io.ReadAll(io.LimitReader(source, maxManifestBytes+1))
	if err != nil {
		return manifest{}, fmt.Errorf("read scene asset manifest: %w", err)
	}
	if len(data) > maxManifestBytes {
		return manifest{}, fmt.Errorf("scene asset manifest exceeds %d bytes", maxManifestBytes)
	}
	var result manifest
	if err := json.Unmarshal(data, &result); err != nil {
		return result, fmt.Errorf("decode scene asset manifest: %w", err)
	}
	if result.Version != 1 || result.Size <= 0 || len(result.SHA256) != sha256.Size*2 {
		return result, fmt.Errorf("invalid scene asset identity")
	}
	if _, err := hex.DecodeString(result.SHA256); err != nil {
		return result, fmt.Errorf("invalid scene asset fingerprint: %w", err)
	}
	if result.Width <= 0 || result.Height <= 0 || result.Frames <= 0 || !finite(result.FPS) || result.FPS <= 0 || !finite(result.Duration) || result.Duration <= 0 || result.Duration > document.MaxTime.Seconds() {
		return result, fmt.Errorf("invalid scene asset dimensions or duration")
	}
	if math.Abs(result.Duration-float64(result.Frames)/result.FPS) > 0.000001 {
		return result, fmt.Errorf("scene asset duration does not match frame count")
	}
	if err := validateScene(result); err != nil {
		return result, err
	}
	return result, nil
}

func validateScene(result manifest) error {
	var scene struct {
		Version int    `json:"version"`
		SceneID string `json:"sceneId"`
		Config  struct {
			Width  int     `json:"width"`
			Height int     `json:"height"`
			FPS    float64 `json:"fps"`
			Frames int     `json:"durationInFrames"`
		} `json:"config"`
	}
	if err := json.Unmarshal(result.Scene, &scene); err != nil {
		return fmt.Errorf("decode scene provenance: %w", err)
	}
	if scene.Version != 1 || scene.SceneID == "" || scene.Config.Width != result.Width || scene.Config.Height != result.Height || scene.Config.FPS != result.FPS || scene.Config.Frames != result.Frames {
		return fmt.Errorf("scene provenance does not match the asset")
	}
	return nil
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
