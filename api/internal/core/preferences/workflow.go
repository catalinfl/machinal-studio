package preferences

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sync"

	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

const (
	maxWorkflowBytes         = 4096
	maxPreferredCaptionWords = 12
)

type WorkflowPreference struct {
	Style           string `json:"style"`
	SceneMode       string `json:"sceneMode"`
	ImagePolicy     string `json:"imagePolicy"`
	CaptionMaxWords int    `json:"captionMaxWords"`
}

type WorkflowPatch struct {
	Style           *string `json:"style,omitempty"`
	SceneMode       *string `json:"sceneMode,omitempty"`
	ImagePolicy     *string `json:"imagePolicy,omitempty"`
	CaptionMaxWords *int    `json:"captionMaxWords,omitempty"`
}

type workflowView struct {
	Preferences WorkflowPreference `json:"preferences"`
	Configured  bool               `json:"configured"`
}

type Workflows struct {
	root func() string
	mu   sync.Mutex
}

func NewWorkflows() *Workflows {
	return &Workflows{root: func() string { return filepath.Join(storage.DataDir, ".workflow-preferences") }}
}

func defaultWorkflow() WorkflowPreference {
	return WorkflowPreference{Style: "auto", SceneMode: "auto", ImagePolicy: "auto", CaptionMaxWords: 4}
}

func readWorkflow(path string) (workflowView, error) {
	view := workflowView{Preferences: defaultWorkflow()}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return view, nil
	}
	if err != nil || len(data) > maxWorkflowBytes || json.Unmarshal(data, &view.Preferences) != nil || !validWorkflow(view.Preferences) {
		return workflowView{}, fiber.NewError(fiber.StatusInternalServerError, "Could not read workflow preferences.")
	}
	view.Configured = true
	return view, nil
}

func (w *Workflows) Get(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	path, err := preferencePath(c, w.root())
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	view, err := readWorkflow(path)
	if err != nil {
		return err
	}
	return c.JSON(view)
}

func (w *Workflows) Save(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	path, err := preferencePath(c, w.root())
	if err != nil {
		return err
	}
	patch, err := decodeWorkflowPatch(c.Body())
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	view, err := readWorkflow(path)
	if err != nil {
		return err
	}
	view.Preferences = patch.apply(view.Preferences)
	if !validWorkflow(view.Preferences) {
		return fiber.NewError(fiber.StatusBadRequest, fmt.Sprintf("Choose a supported style, sceneMode auto/2d/3d, imagePolicy auto/prefer-images/procedural-only and captionMaxWords 1–%d.", maxPreferredCaptionWords))
	}
	if err := writePreference(path, view.Preferences); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Could not save workflow preferences.")
	}
	view.Configured = true
	return c.JSON(view)
}

func decodeWorkflowPatch(body []byte) (WorkflowPatch, error) {
	var patch WorkflowPatch
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if len(body) > maxWorkflowBytes || decoder.Decode(&patch) != nil || decoder.Decode(&struct{}{}) != io.EOF || bytes.Equal(bytes.TrimSpace(body), []byte("null")) {
		return patch, fiber.NewError(fiber.StatusBadRequest, "Provide only non-secret workflow preference fields; credentials and connection URLs belong in the client configuration.")
	}
	return patch, nil
}

func (p WorkflowPatch) apply(value WorkflowPreference) WorkflowPreference {
	if p.Style != nil {
		value.Style = *p.Style
	}
	if p.SceneMode != nil {
		value.SceneMode = *p.SceneMode
	}
	if p.ImagePolicy != nil {
		value.ImagePolicy = *p.ImagePolicy
	}
	if p.CaptionMaxWords != nil {
		value.CaptionMaxWords = *p.CaptionMaxWords
	}
	return value
}

func validWorkflow(value WorkflowPreference) bool {
	styles := []string{"auto", "cinematic", "social", "tutorial", "minimal", "documentary", "travel", "product", "noir", "retro", "cyberpunk", "dreamy", "sports"}
	return slices.Contains(styles, value.Style) && slices.Contains([]string{"auto", "2d", "3d"}, value.SceneMode) &&
		slices.Contains([]string{"auto", "prefer-images", "procedural-only"}, value.ImagePolicy) && value.CaptionMaxWords >= 1 && value.CaptionMaxWords <= maxPreferredCaptionWords
}
