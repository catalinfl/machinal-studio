package scenes

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"ffmpeg-go-server/internal/core/editor/subtitles"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const jobTimeout = 30 * time.Minute
const statusWait = 25 * time.Second

type Runner struct {
	mu      sync.RWMutex
	jobs    map[string]Job
	cancels map[string]context.CancelFunc
	slots   chan struct{}
	compile func(context.Context, string, Config, compilationMedia) (string, error)
	changes map[string]chan struct{}
}

func NewRunner() *Runner {
	return &Runner{jobs: make(map[string]Job), cancels: make(map[string]context.CancelFunc), slots: make(chan struct{}, 1), compile: compileValidatedRemote, changes: make(map[string]chan struct{})}
}

func (r *Runner) Create(c *fiber.Ctx) error {
	if len(c.Body()) > maxRequestBytes {
		return fiber.ErrRequestEntityTooLarge
	}
	var request Request
	if err := json.Unmarshal(c.Body(), &request); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid scene request")
	}
	request.Prompt = strings.TrimSpace(request.Prompt)
	if err := request.validate(); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	provider, err := configuredProvider()
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, err.Error())
	}
	if request.Model != "" {
		provider.Model = request.Model
	}
	if os.Getenv("SCENE_SERVICE_URL") == "" {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Scene compilation is not configured. Set SCENE_SERVICE_URL.")
	}
	if err := rendererReady(c.UserContext()); err != nil {
		log.Printf("scene renderer unavailable: %v", err)
		return fiber.NewError(fiber.StatusServiceUnavailable, "The scene compiler is unavailable. Start the scene-renderer service and try again.")
	}
	select {
	case r.slots <- struct{}{}:
	default:
		return fiber.NewError(fiber.StatusTooManyRequests, "Scene generation is busy. Try again shortly.")
	}
	session := sessions.FromRequest(c)
	root, err := sessions.Touch(session)
	if err != nil {
		<-r.slots
		return media.AssetError(c, err)
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		<-r.slots
		return fiber.ErrInternalServerError
	}
	job := Job{ID: hex.EncodeToString(random[:]), Status: "queued", Message: "Preparing your scene", Scenes: []Scene{}}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(c.UserContext()), jobTimeout)
	r.mu.Lock()
	r.cancels[session+"/"+job.ID] = cancel
	r.mu.Unlock()
	job = r.update(session, job)
	credits.Detach(c.UserContext())
	go r.execute(ctx, cancel, session, root, request, provider, job)
	return c.Status(fiber.StatusAccepted).JSON(job)
}

func (r *Runner) execute(ctx context.Context, cancel context.CancelFunc, session, root string, request Request, provider Provider, job Job) {
	defer credits.Finish(ctx)
	defer func() {
		cancel()
		<-r.slots
		r.mu.Lock()
		delete(r.cancels, session+"/"+job.ID)
		r.mu.Unlock()
	}()
	go keepSession(ctx, session)
	progress := func(status, message string, ratio float64) {
		job.Status, job.Message, job.Progress = status, message, ratio
		job = r.update(session, job)
	}
	err := r.generate(ctx, session, root, request, provider, &job, progress)
	if err != nil {
		log.Printf("scene job %s failed: %v", job.ID, err)
		if errors.Is(ctx.Err(), context.Canceled) {
			job.Status, job.Message = "cancelled", "Generation stopped. Completed scenes are still available."
		} else {
			transcribing := job.Status == "transcribing"
			job.Status, job.Message = "failed", generationFailure(err)
			if transcribing && len(job.Scenes) == 0 && request.AudioFile != "" && job.Transcript == "" {
				job.Message = "We could not transcribe this recording. Check the audio and try again."
			}
		}
	} else {
		job.Status, job.Message, job.Progress = "completed", "Scenes ready to add to your video", 1
	}
	if err := saveJSON(filepath.Join(root, "scene_job_"+job.ID+".json"), job); err != nil {
		log.Printf("save scene job: %v", err)
	}
	r.update(session, job)
}

func (r *Runner) generate(ctx context.Context, session, root string, request Request, provider Provider, job *Job, progress func(string, string, float64)) error {
	if request.SourceFile != "" {
		return r.generateEdit(ctx, session, root, request, provider, job, progress)
	}
	images, err := loadSceneImages(ctx, session, root, request.Images)
	if err != nil {
		return err
	}
	request.Images = images
	videos, err := loadSceneVideos(ctx, session, root, request.Videos)
	if err != nil {
		return err
	}
	request.Videos = videos
	cues := request.NarrationCues
	voiceDuration := 0.0
	if request.AudioFile != "" {
		progress("transcribing", "Transcribing your narration", 0.05)
		media.WarmSession(ctx, session, root, request.AudioFile)
		metadata, err := loadVoice(ctx, root, request.AudioFile)
		if err != nil {
			return err
		}
		voiceDuration = metadata.Duration
		cues, err = subtitles.TranscribeWindow(ctx, root, request.AudioFile, 0, voiceDuration, request.Language)
		if err != nil {
			return fmt.Errorf("transcribe scene narration: %w", err)
		}
		texts := make([]string, 0, len(cues))
		for _, cue := range cues {
			texts = append(texts, cue.Text)
		}
		job.Transcript = strings.TrimSpace(strings.Join(texts, " "))
		if job.Transcript == "" {
			return fmt.Errorf("recording contains no recognized speech")
		}
	}
	progress("planning", "Designing scenes around your ideas", 0.15)
	plan := []Definition{{Title: defaultSceneTitle(request.Text, request.Prompt), Brief: request.Prompt, End: request.Duration}}
	if request.AudioFile != "" {
		var err error
		plan, err = provider.plan(ctx, request, cues, voiceDuration)
		if err != nil {
			return err
		}
	}
	for i, definition := range plan {
		if err := ctx.Err(); err != nil {
			return err
		}
		definition.Cues = relativeCues(cues, definition)
		progress("generating", fmt.Sprintf("Creating scene %d of %d · %s", i+1, len(plan), definition.Title), 0.2+0.75*float64(i)/float64(len(plan)))
		scene, err := r.prepareScene(ctx, root, request, provider, job.ID, i, definition, voiceDuration, func() {
			progress("compiling", fmt.Sprintf("Preparing live preview %d of %d", i+1, len(plan)), 0.2+0.75*(float64(i)+0.8)/float64(len(plan)))
		})
		if err != nil {
			return err
		}
		if err := r.persistScene(ctx, session, root, request, scene); err != nil {
			return err
		}
		job.Scenes = append(job.Scenes, scene)
		progress("compiling", fmt.Sprintf("Scene %d of %d ready", i+1, len(plan)), 0.2+0.75*float64(i+1)/float64(len(plan)))
	}
	return nil
}

func (r *Runner) prepareScene(ctx context.Context, root string, request Request, provider Provider, jobID string, index int, d Definition, voiceDuration float64, compiling func()) (Scene, error) {
	return r.prepareSceneSource(ctx, root, request, provider, jobID, index, d, voiceDuration, nil, compiling)
}

func (r *Runner) prepareSceneSource(ctx context.Context, root string, request Request, provider Provider, jobID string, index int, d Definition, voiceDuration float64, base *LiveSource, compiling func()) (Scene, error) {
	id := fmt.Sprintf("%s_%02d", jobID, index+1)
	filename := "ai_scene_" + id + ".scene.json"
	previous := ""
	if base != nil {
		previous = base.Component
	}
	component, err := provider.component(ctx, request, d, previous, "")
	if err != nil {
		return Scene{}, err
	}
	config := configFor(request, d)
	media := compilationMedia{Images: imageSources(request.Images), Videos: videoSources(request.Videos)}
	if base != nil {
		media.Images, media.Videos = base.Images, base.Videos
		media.Parameters = base.Parameters
		media.Models = base.Models
		config.CaptionSafeBottom = max(config.CaptionSafeBottom, base.Config.CaptionSafeBottom)
	}
	compiling()
	javascript, compileErr := r.compile(ctx, component.Component, config, media)
	var rejected *componentError
	if errors.As(compileErr, &rejected) && ctx.Err() == nil {
		component, err = provider.component(ctx, request, d, component.Component, compileErr.Error())
		if err != nil {
			return Scene{}, err
		}
		javascript, compileErr = r.compile(ctx, component.Component, config, media)
	}
	if compileErr != nil {
		return Scene{}, compileErr
	}
	d.Component, d.Explanation = component.Component, component.Explanation
	source := LiveSource{Version: 1, Title: d.Title, Component: component.Component, Explanation: component.Explanation, Text: request.Text, VisualMode: request.VisualMode, JavaScript: javascript, Config: config, Images: imageSources(request.Images), Videos: videoSources(request.Videos), EnvironmentVersion: previewEnvironmentVersion}
	if base != nil {
		source.Images, source.Videos, source.Audio = base.Images, base.Videos, base.Audio
		source.Parameters = base.Parameters
		source.Models = base.Models
	}
	if request.AudioFile != "" {
		source.Audio = &Narration{File: request.AudioFile, Start: d.Start, Duration: voiceDuration}
	}
	if err := saveJSON(filepath.Join(root, filename), source); err != nil {
		return Scene{}, err
	}
	asset, err := SourceAsset(root, filename, id)
	if err != nil {
		return Scene{}, err
	}
	return Scene{ID: id, Definition: d, Asset: asset, Source: &source}, nil
}

func (r *Runner) persistScene(ctx context.Context, session, root string, request Request, scene Scene) error {
	definition := struct {
		Request Request `json:"request"`
		Scene   Scene   `json:"scene"`
	}{request, scene}
	path := filepath.Join(root, scene.Asset.File+".meta.json")
	if err := saveJSON(path, definition); err != nil {
		return fmt.Errorf("save scene component: %w", err)
	}
	user := sessions.S3Prefix(session)
	if user == "" || !objectstore.Enabled() {
		return nil
	}
	for _, name := range []string{scene.Asset.File + ".meta.json", scene.Asset.File} {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			return fmt.Errorf("read scene for storage: %w", err)
		}
		if err := objectstore.Shared().Put(ctx, objectstore.SceneKey(user, name), bytes.NewReader(data), int64(len(data)), "application/json"); err != nil {
			return fmt.Errorf("store scene: %w", err)
		}
	}
	return nil
}

func (r *Runner) update(session string, job Job) Job {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.jobs) >= 32 {
		for key, value := range r.jobs {
			if terminal(value.Status) {
				delete(r.jobs, key)
				delete(r.changes, key)
			}
		}
	}
	job.Scenes = append([]Scene{}, job.Scenes...)
	key := session + "/" + job.ID
	job.Revision = r.jobs[key].Revision + 1
	r.jobs[key] = job
	if changed := r.changes[key]; changed != nil {
		close(changed)
	}
	r.changes[key] = make(chan struct{})
	log.Printf("scene job %s: %s progress=%.2f scenes=%d", job.ID, job.Status, job.Progress, len(job.Scenes))
	return job
}

var jobIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func terminal(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled"
}

func (r *Runner) Status(c *fiber.Ctx) error {
	id, session := c.Params("id"), sessions.FromRequest(c)
	if !jobIDPattern.MatchString(id) {
		return fiber.ErrNotFound
	}
	r.mu.RLock()
	job, exists := r.jobs[session+"/"+id]
	changed := r.changes[session+"/"+id]
	r.mu.RUnlock()
	if exists {
		if c.Query("revision") == fmt.Sprint(job.Revision) && !terminal(job.Status) {
			timer := time.NewTimer(statusWait)
			defer timer.Stop()
			select {
			case <-changed:
			case <-timer.C:
			case <-c.UserContext().Done():
				return c.UserContext().Err()
			}
			r.mu.RLock()
			job = r.jobs[session+"/"+id]
			r.mu.RUnlock()
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.JSON(job)
	}
	root, err := sessions.Touch(session)
	if err != nil {
		return media.AssetError(c, err)
	}
	data, err := os.ReadFile(filepath.Join(root, "scene_job_"+id+".json"))
	if os.IsNotExist(err) {
		return fiber.ErrNotFound
	}
	if err != nil {
		return media.AssetError(c, err)
	}
	if err := json.Unmarshal(data, &job); err != nil {
		return fiber.ErrInternalServerError
	}
	return c.JSON(job)
}

func generationFailure(err error) string {
	var video *sceneVideoError
	if errors.As(err, &video) {
		return video.message
	}
	var image *sceneImageError
	if errors.As(err, &image) {
		return image.message
	}
	var result *providerResultError
	if errors.As(err, &result) {
		return result.Error()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "The AI request timed out. Try again or choose a faster scene model."
	}
	return "We could not finish generating these scenes. Check the scene diagnostics and retry the failed stage without discarding the requested art direction."
}

func (r *Runner) Cancel(c *fiber.Ctx) error {
	id, session := c.Params("id"), sessions.FromRequest(c)
	if !jobIDPattern.MatchString(id) {
		return fiber.ErrNotFound
	}
	r.mu.RLock()
	cancel := r.cancels[session+"/"+id]
	_, exists := r.jobs[session+"/"+id]
	r.mu.RUnlock()
	if !exists {
		return fiber.ErrNotFound
	}
	if cancel != nil {
		cancel()
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func keepSession(ctx context.Context, session string) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := sessions.Touch(session); err != nil {
				log.Printf("refresh scene session: %v", err)
			}
		}
	}
}

func saveJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode scene provenance: %w", err)
	}
	if err := os.WriteFile(path+".tmp", data, 0600); err != nil {
		return fmt.Errorf("write scene provenance: %w", err)
	}
	if err := os.Rename(path+".tmp", path); err != nil {
		return fmt.Errorf("publish scene provenance: %w", err)
	}
	return nil
}
