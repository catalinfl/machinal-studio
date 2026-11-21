package scenes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

// JSON escaping can expand a valid 64 KB component by up to six times.
const maxCompileRequestBytes = 512 << 10
const compileTimeout = 5 * time.Minute
const maxExplanationBytes = 4000
const maxSceneTitleBytes = 200

type CompileRequest struct {
	Component       string          `json:"component"`
	Title           string          `json:"title,omitempty" jsonschema:"Concise subject-specific media-bin name, ideally 2-6 words without extensions or technical IDs. Supply a descriptive title for every new scene; edits preserve the existing title when omitted."`
	Explanation     string          `json:"explanation,omitempty"`
	Text            string          `json:"text,omitempty"`
	Duration        float64         `json:"duration"`
	Width           int             `json:"width"`
	Height          int             `json:"height"`
	FPS             float64         `json:"fps"`
	VisualMode      string          `json:"visualMode,omitempty"`
	Transparent     bool            `json:"transparent,omitempty"`
	CaptionSafeArea bool            `json:"captionSafeArea,omitempty"`
	Images          []SceneImage    `json:"images,omitempty"`
	Videos          []SceneVideo    `json:"videos,omitempty"`
	Models          []SceneModel    `json:"models,omitempty"`
	SourceFile      string          `json:"sourceFile,omitempty"`
	Parameters      SceneParameters `json:"parameters,omitempty"`
	ParameterPatch  SceneParameters `json:"parameterPatch,omitempty"`
	SourceVersion   string          `json:"sourceVersion,omitempty"`
	Handoff         *SceneHandoff   `json:"handoff,omitempty"`
}

func (input CompileRequest) request() Request {
	return Request{Prompt: "Client-authored scene", Text: input.Text, Duration: input.Duration,
		Width: input.Width, Height: input.Height, FPS: input.FPS, VisualMode: input.VisualMode,
		Transparent: input.Transparent, CaptionSafeArea: input.CaptionSafeArea, Images: input.Images, Videos: input.Videos}
}

func (input CompileRequest) validate() error {
	if input.isParameterEdit() {
		return input.validateParameterEdit()
	}
	if input.SourceVersion != "" {
		return fmt.Errorf("sourceVersion is used only with parameterPatch or handoff")
	}
	if err := input.Parameters.Validate(); err != nil {
		return err
	}
	if err := validateModelInputs(input.Models); err != nil {
		return err
	}
	if strings.TrimSpace(input.Component) == "" || len(input.Component) > maxComponentBytes {
		return fmt.Errorf("provide complete Svelte source of at most %d bytes", maxComponentBytes)
	}
	if len(input.Title) > maxSceneTitleBytes || len(input.Explanation) > maxExplanationBytes {
		return fmt.Errorf("use a title up to %d bytes and an explanation up to %d bytes", maxSceneTitleBytes, maxExplanationBytes)
	}
	if input.SourceFile != "" && (!IsSource(input.SourceFile) || len(input.Images) > 0 || len(input.Videos) > 0 || len(input.Models) > 0) {
		return fmt.Errorf("sourceFile must be an existing live scene; its attachments are preserved, not replaced")
	}
	return input.request().validate()
}

func decodeCompileRequest(body []byte) (CompileRequest, error) {
	var input CompileRequest
	if len(body) > maxCompileRequestBytes {
		return input, fiber.ErrRequestEntityTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return input, fiber.NewError(fiber.StatusBadRequest, "Invalid scene compilation request.")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return input, fiber.NewError(fiber.StatusBadRequest, "Provide exactly one scene compilation request.")
	}
	if err := input.validate(); err != nil {
		return input, fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	return input, nil
}

func ValidateCompileRequest(c *fiber.Ctx) error {
	if _, err := decodeCompileRequest(c.Body()); err != nil {
		return err
	}
	c.SetUserContext(credits.WithWorkflowPolicy(c.UserContext(), credits.MCPFree))
	return c.Next()
}

func (r *Runner) CompileSource(c *fiber.Ctx) error {
	input, err := decodeCompileRequest(c.Body())
	if err != nil {
		return err
	}
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	ctx, cancel := context.WithTimeout(credits.WithWorkflowPolicy(c.UserContext(), credits.MCPFree), compileTimeout)
	defer cancel()
	jobqueue.Report(ctx, jobqueue.Update{Message: "Validating and compiling client-authored scene"})
	scene, err := r.compileSource(ctx, session, root, input)
	if err != nil {
		return compilationFailure(c, err)
	}
	return c.JSON(fiber.Map{"asset": scene.Asset, "file": scene.Asset.File,
		"title": scene.Title, "explanation": scene.Explanation, "cost": freeCompilationCost()})
}

func (r *Runner) compileSource(ctx context.Context, session, root string, input CompileRequest) (Scene, error) {
	source, err := compilationSource(ctx, session, root, input)
	if err != nil {
		return Scene{}, err
	}
	if input.isParameterEdit() {
		input.Component, input.Text, input.Explanation = source.Component, source.Text, source.Explanation
		input.Duration, input.Width, input.Height, input.FPS = float64(source.Config.Frames)/source.Config.FPS, source.Config.Width, source.Config.Height, source.Config.FPS
		input.VisualMode, input.Transparent = source.VisualMode, source.Config.Transparent
	}
	request := input.request()
	jobqueue.Report(ctx, jobqueue.Update{Progress: 0.25, Message: "Checking scene syntax, runtime and layout"})
	javascript, err := r.compile(ctx, input.Component, source.Config, source.compilationMedia())
	if err != nil {
		return Scene{}, err
	}
	source.Component, source.JavaScript = input.Component, javascript
	source.Explanation, source.EnvironmentVersion = input.Explanation, previewEnvironmentVersion
	if title := strings.TrimSpace(input.Title); title != "" {
		source.Title = title
	}
	if source.Title == "" {
		source.Title = defaultSceneTitle(source.Text, input.Explanation)
	}
	id := jobqueue.ID(ctx)
	if id != "" && !jobIDPattern.MatchString(id) {
		return Scene{}, fmt.Errorf("invalid scene job identity")
	}
	if id == "" {
		id, err = credits.NewID()
		if err != nil {
			return Scene{}, err
		}
	}
	id += "_01"
	filename := "ai_scene_" + id + ".scene.json"
	if err := saveJSON(filepath.Join(root, filename), source); err != nil {
		return Scene{}, err
	}
	asset, err := SourceAsset(root, filename, id)
	if err != nil {
		return Scene{}, err
	}
	scene := Scene{ID: id, Definition: Definition{Title: source.Title, End: asset.Duration.Seconds(), Component: input.Component, Explanation: input.Explanation}, Asset: asset, Source: &source}
	jobqueue.Report(ctx, jobqueue.Update{Progress: 0.9, Message: "Saving reusable scene source"})
	if err := r.persistScene(ctx, session, root, request, scene); err != nil {
		return Scene{}, err
	}
	return scene, nil
}

func compilationSource(ctx context.Context, session, root string, input CompileRequest) (LiveSource, error) {
	if input.isParameterEdit() {
		return parameterEditSource(ctx, session, root, input)
	}
	config := configFor(input.request(), Definition{End: input.Duration})
	if input.SourceFile != "" {
		media.WarmSession(ctx, session, root, input.SourceFile)
		source, err := ReadSource(root, input.SourceFile)
		if err != nil {
			return LiveSource{}, err
		}
		if input.VisualMode != "" && input.VisualMode != source.VisualMode {
			return LiveSource{}, &componentError{diagnostic: "Editing preserves the source visualMode. Use its original mode."}
		}
		config.VisualMode, config.Transparent = source.VisualMode, source.Config.Transparent
		config.CaptionSafeBottom = max(config.CaptionSafeBottom, source.Config.CaptionSafeBottom)
		source.Config = config
		if input.Parameters != nil {
			source.Parameters = input.Parameters
		}
		if input.Text != "" {
			source.Text = input.Text
		}
		return source, nil
	}
	images, err := loadSceneImages(ctx, session, root, input.Images)
	if err != nil {
		return LiveSource{}, err
	}
	videos, err := loadSceneVideos(ctx, session, root, input.Videos)
	if err != nil {
		return LiveSource{}, err
	}
	models, err := loadSceneModels(ctx, session, root, input.Models)
	if err != nil {
		return LiveSource{}, err
	}
	return LiveSource{Version: 1, Config: config, Text: input.Text, VisualMode: input.VisualMode,
		Images: imageSources(images), Videos: videoSources(videos), Parameters: input.Parameters, Models: models}, nil
}

func compilationFailure(c *fiber.Ctx, err error) error {
	if diagnostic := PublicServiceDiagnostic(err); diagnostic != "" {
		return fiber.NewError(fiber.StatusServiceUnavailable, diagnostic)
	}
	var status *fiber.Error
	if errors.As(err, &status) {
		return status
	}
	var rejected *componentError
	if errors.As(err, &rejected) {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
			"diagnostics": []fiber.Map{{"path": "component", "code": "scene_compile_failed", "severity": "error", "message": rejected.diagnostic}},
			"nextStep":    "Correct the Svelte source in the current client and call compile_scene again with a new idempotencyKey. No server AI was called.",
			"cost":        freeCompilationCost(),
		})
	}
	log.Printf("client_scene_compile_failed job=%q error=%q", jobqueue.ID(c.UserContext()), err)
	return fiber.NewError(fiber.StatusBadGateway, "Scene compilation or storage failed. Check the scene service and approved attachments; no server AI was called.")
}

func freeCompilationCost() fiber.Map {
	return fiber.Map{"status": "final", "aiCredits": 0, "renderCredits": 0, "knownCredits": 0}
}

func ClientSource(c *fiber.Ctx) error {
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	filename := c.Query("file")
	if !IsSource(filename) {
		return fiber.ErrBadRequest
	}
	media.WarmSession(c.UserContext(), session, root, filename)
	source, version, err := readSourceVersion(root, filename)
	if err != nil {
		return media.AssetError(c, err)
	}
	imageIDs, videoIDs := make([]string, 0, len(source.Images)), make([]string, 0, len(source.Videos))
	for id := range source.Images {
		imageIDs = append(imageIDs, id)
	}
	for id := range source.Videos {
		videoIDs = append(videoIDs, id)
	}
	slices.Sort(imageIDs)
	slices.Sort(videoIDs)
	modelIDs := make([]string, 0, len(source.Models))
	for id := range source.Models {
		modelIDs = append(modelIDs, id)
	}
	slices.Sort(modelIDs)
	c.Set(fiber.HeaderCacheControl, "private, no-store")
	return c.JSON(fiber.Map{"file": filename, "sourceVersion": version, "title": source.Title, "component": source.Component, "explanation": source.Explanation,
		"text": source.Text, "visualMode": source.VisualMode, "config": source.Config,
		"imageIds": imageIDs, "videoIds": videoIDs, "modelIds": modelIDs, "audio": source.Audio, "parameters": source.Parameters, "handoff": source.Handoff})
}
