package scenes

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"ffmpeg-go-server/editengine/scenecontract"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/storage"
)

const maxSceneModels = 2
const modelDataPrefix = "data:model/gltf-binary;base64,"

var modelIDPattern = regexp.MustCompile(`^model_[12]$`)

type SceneModel struct {
	ID   string `json:"id"`
	File string `json:"file"`
	Name string `json:"name"`
}

func validateModelInputs(models []SceneModel) error {
	if len(models) > maxSceneModels {
		return fmt.Errorf("attach at most %d GLB models", maxSceneModels)
	}
	seen := make(map[string]bool)
	for _, model := range models {
		if !modelIDPattern.MatchString(model.ID) || seen[model.ID] {
			return fmt.Errorf("use unique model_1/model_2 attachment IDs")
		}
		seen[model.ID] = true
		if len(model.File) > 255 || strings.ContainsAny(model.File, `/\:`) || !strings.HasSuffix(strings.ToLower(model.File), ".glb") || strings.HasPrefix(model.File, "-") || strings.TrimSpace(model.Name) == "" || len(model.Name) > 255 {
			return fmt.Errorf("choose a named uploaded GLB file, not a path or URL")
		}
	}
	return nil
}

func loadSceneModels(ctx context.Context, session, root string, models []SceneModel) (map[string]string, error) {
	if err := validateModelInputs(models); err != nil {
		return nil, err
	}
	if len(models) == 0 {
		return nil, nil
	}
	result := make(map[string]string, len(models))
	for _, model := range models {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		media.WarmSession(ctx, session, root, model.File)
		data, err := readSceneModel(root, model.File)
		if err != nil {
			return nil, fmt.Errorf("load GLB attachment %s: %w", model.ID, err)
		}
		result[model.ID] = modelDataPrefix + base64.StdEncoding.EncodeToString(data)
	}
	return result, nil
}

func readSceneModel(root, name string) ([]byte, error) {
	path, err := storage.SafeJoinIn(root, name)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("inspect model file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > scenecontract.MaxModelBytes {
		return nil, fmt.Errorf("model must be a regular GLB file of at most %d MiB", scenecontract.MaxModelBytes>>20)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open GLB attachment: %w", err)
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("inspect open GLB attachment: %w", err)
	}
	if !os.SameFile(info, opened) || !opened.Mode().IsRegular() || opened.Size() > scenecontract.MaxModelBytes {
		return nil, fmt.Errorf("GLB attachment changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(file, scenecontract.MaxModelBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read GLB attachment: %w", err)
	}
	if err := scenecontract.ValidateModelContainer(data); err != nil {
		return nil, err
	}
	return data, nil
}

func validateModelSources(models map[string]string) error {
	if len(models) > maxSceneModels {
		return fmt.Errorf("scene contains too many GLB models")
	}
	for id, source := range models {
		if !modelIDPattern.MatchString(id) || !strings.HasPrefix(source, modelDataPrefix) || len(source) > len(modelDataPrefix)+base64.StdEncoding.EncodedLen(scenecontract.MaxModelBytes) {
			return fmt.Errorf("invalid embedded GLB model")
		}
		data, err := base64.StdEncoding.Strict().DecodeString(strings.TrimPrefix(source, modelDataPrefix))
		if err != nil {
			return fmt.Errorf("invalid embedded GLB encoding")
		}
		if err := scenecontract.ValidateModelContainer(data); err != nil {
			return err
		}
	}
	return nil
}
