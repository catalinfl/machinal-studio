package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"ffmpeg-go-server/internal/platform/soundlibrary"

	"github.com/gofiber/fiber/v2"
)

type soundImportResult struct {
	File           string             `json:"file"`
	Bytes          int                `json:"bytes"`
	SHA256         string             `json:"sha256"`
	Storage        string             `json:"storage"`
	Reused         bool               `json:"reused"`
	ProvenanceFile string             `json:"provenanceFile"`
	Sound          soundlibrary.Sound `json:"sound"`
	AudioVerified  bool               `json:"audioVerified"`
}

func validSoundVersion(value string) bool {
	return len(value) == len("sha256:")+sha256.Size*2 && strings.HasPrefix(value, "sha256:") && strings.Trim(strings.TrimPrefix(value, "sha256:"), "0123456789abcdef") == ""
}

func storeSound(ctx context.Context, root, session string, sound soundlibrary.Sound, body []byte) (soundImportResult, error) {
	if len(body) == 0 || len(body) > soundlibrary.MaxAudioBytes || !soundlibrary.ValidID(sound.ID) || !soundlibrary.AllowedLicense(sound.License) || !sound.Importable || !validSoundVersion(sound.SourceVersion) {
		return soundImportResult{}, fiber.NewError(fiber.StatusBadGateway, "Invalid sound import content or provenance.")
	}
	switch sound.Filetype {
	case "mp3", "wav", "ogg", "flac":
	default:
		return soundImportResult{}, fiber.ErrUnsupportedMediaType
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(body))
	name := "sound_" + sound.ID + "_" + digest + "." + sound.Filetype
	// Include metadata identity so changed licence/attribution cannot silently
	// replace the provenance of identical audio bytes.
	provenance := ".sound_" + digest + "_" + strings.TrimPrefix(sound.SourceVersion, "sha256:") + ".json"
	result := soundImportResult{File: name, Bytes: len(body), SHA256: digest, Storage: "volume", ProvenanceFile: provenance, Sound: sound}
	metadata, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return soundImportResult{}, fiber.ErrInternalServerError
	}
	reused, err := reuseLocalCopy(ctx, root, name, "sha256:"+digest, int64(len(body)))
	if err != nil {
		return soundImportResult{}, err
	}
	metadataReused, err := soundBytesPresent(root, provenance, metadata)
	if err != nil {
		return soundImportResult{}, err
	}
	additional := 0
	if !metadataReused {
		additional += len(metadata)
	}
	if !reused {
		additional += len(body)
	}
	if err := checkUploadQuota(root, session, int64(additional)); err != nil {
		return soundImportResult{}, err
	}
	if _, err := publishSoundBytes(ctx, root, provenance, metadata, false); err != nil {
		return soundImportResult{}, err
	}
	if !reused {
		if _, err := publishSoundBytes(ctx, root, name, body, true); err != nil {
			return soundImportResult{}, err
		}
	}
	result.Reused = reused
	return result, nil
}

func publishSoundBytes(ctx context.Context, directory, name string, body []byte, audio bool) (bool, error) {
	if ctx.Err() != nil {
		return false, fiber.ErrRequestTimeout
	}
	if reused, err := soundBytesPresent(directory, name, body); err != nil || reused {
		return reused, err
	}
	tmp, err := os.CreateTemp(directory, ".sound-import-*")
	if err != nil {
		return false, fiber.ErrInternalServerError
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if _, err := tmp.Write(body); err != nil {
		return false, fiber.ErrInternalServerError
	}
	if err := tmp.Close(); err != nil {
		return false, fiber.ErrInternalServerError
	}
	if audio {
		if err := validateUploadContent(tmp.Name(), name); err != nil {
			return false, err
		}
	}
	if ctx.Err() != nil {
		return false, fiber.ErrRequestTimeout
	}
	if err := os.Link(tmp.Name(), filepath.Join(directory, name)); err != nil {
		return false, fiber.NewError(fiber.StatusConflict, "Cannot publish sound without overwriting; existing project files were preserved.")
	}
	return false, nil
}

func soundBytesPresent(directory, name string, body []byte) (bool, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return false, fiber.ErrServiceUnavailable
	}
	defer root.Close()
	if info, err := root.Lstat(name); err == nil {
		if !info.Mode().IsRegular() || info.Size() != int64(len(body)) {
			return false, fiber.ErrConflict
		}
		file, err := root.Open(name)
		if err != nil {
			return false, fiber.ErrConflict
		}
		defer file.Close()
		current, err := io.ReadAll(io.LimitReader(file, int64(len(body))+1))
		if err != nil || !bytes.Equal(current, body) {
			return false, fiber.ErrConflict
		}
		return true, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, fiber.ErrConflict
	}
	return false, nil
}
