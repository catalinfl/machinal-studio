package scenes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const MaxInspectionFrames = 6
const maxInspectionRequestBytes = 4096
const maxInspectionResponseBytes = 1536 << 10
const inspectionTimeout = 95 * time.Second

var sourceVersionPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type InspectRequest struct {
	File          string `json:"file"`
	SourceVersion string `json:"sourceVersion"`
	Frames        []int  `json:"frames"`
}

func (input InspectRequest) Validate() error {
	if !IsSource(input.File) || !sourceVersionPattern.MatchString(input.SourceVersion) {
		return errors.New("provide a named live scene and its sourceVersion from get_scene_source or asset metadata")
	}
	if len(input.Frames) < 1 || len(input.Frames) > MaxInspectionFrames {
		return fmt.Errorf("choose between 1 and %d distinct frame indices", MaxInspectionFrames)
	}
	seen := make(map[int]bool, len(input.Frames))
	for _, frame := range input.Frames {
		if frame < 0 || frame >= maxSceneSeconds*60 || seen[frame] {
			return errors.New("frame indices must be distinct and inside the scene")
		}
		seen[frame] = true
	}
	return nil
}

func decodeInspectionRequest(body []byte) (InspectRequest, error) {
	var input InspectRequest
	if len(body) > maxInspectionRequestBytes {
		return input, fiber.ErrRequestEntityTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return input, fiber.ErrBadRequest
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return input, fiber.ErrBadRequest
	}
	if err := input.Validate(); err != nil {
		return input, fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	return input, nil
}

func ClientInspect(c *fiber.Ctx) error {
	input, err := decodeInspectionRequest(c.Body())
	if err != nil {
		return err
	}
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	ctx, cancel := context.WithTimeout(c.UserContext(), inspectionTimeout)
	defer cancel()
	media.WarmSession(ctx, session, root, input.File)
	source, version, err := readSourceVersion(root, input.File)
	if err != nil {
		return media.AssetError(c, err)
	}
	if version != input.SourceVersion {
		return fiber.NewError(fiber.StatusConflict, "Scene source changed; read its current sourceVersion before inspecting.")
	}
	for _, frame := range input.Frames {
		if frame >= source.Config.Frames {
			return fiber.NewError(fiber.StatusBadRequest, "Frame index exceeds this scene's duration.")
		}
	}
	evidence, err := inspectRemote(ctx, source, input.Frames)
	if err != nil {
		return fiber.NewError(fiber.StatusBadGateway, "Scene inspection failed; check the scene service. No provider or video encoding was invoked.")
	}
	c.Set(fiber.HeaderCacheControl, "private, no-store")
	return c.JSON(fiber.Map{"file": input.File, "sourceVersion": version, "evidence": evidence,
		"cost": freeCompilationCost()})
}

func inspectRemote(ctx context.Context, source LiveSource, frames []int) (json.RawMessage, error) {
	body, err := json.Marshal(struct {
		Component string `json:"component"`
		Config    Config `json:"config"`
		compilationMedia
		Frames []int `json:"frames"`
	}{source.Component, source.Config, source.compilationMedia(), frames})
	if err != nil {
		return nil, fmt.Errorf("encode scene inspection: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(os.Getenv("SCENE_SERVICE_URL"), "/")+"/inspect", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create scene inspection: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+os.Getenv("SCENE_SERVICE_TOKEN"))
	response, err := rendererHTTP.Do(request)
	if err != nil {
		return nil, fmt.Errorf("contact scene inspection: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxInspectionResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read scene inspection: %w", err)
	}
	if response.StatusCode != http.StatusOK || len(data) > maxInspectionResponseBytes || !json.Valid(data) {
		return nil, fmt.Errorf("scene inspection returned invalid evidence or HTTP %d", response.StatusCode)
	}
	return json.RawMessage(data), nil
}
