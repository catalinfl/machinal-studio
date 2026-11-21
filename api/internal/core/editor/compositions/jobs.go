package compositions

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/render/ffmpeg"
	"ffmpeg-go-server/editengine/render/textprepare"
	"ffmpeg-go-server/internal/core/editor/render"
	"ffmpeg-go-server/internal/core/media"
	"ffmpeg-go-server/internal/integrations/openrouter"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

type RenderJob struct {
	ID               string      `json:"id"`
	Status           string      `json:"status"`
	Progress         float64     `json:"progress"`
	Message          string      `json:"message,omitempty"`
	CompositionID    string      `json:"compositionId"`
	DocumentRevision string      `json:"documentRevision"`
	Filename         string      `json:"filename,omitempty"`
	CreatedAt        time.Time   `json:"createdAt"`
	Cost             *RenderCost `json:"cost,omitempty"`
}

type renderManifest struct {
	Job         RenderJob               `json:"job"`
	Document    document.Document       `json:"document"`
	Composition composition.Composition `json:"composition"`
	Input       *compiler.Input         `json:"input,omitempty"`
}

type JobRunner struct {
	mu     sync.RWMutex
	jobs   map[string]RenderJob
	slots  chan struct{}
	render func(context.Context, string, composition.Composition, func(float64, string)) (ffmpeg.Output, error)
}

func NewJobRunner() *JobRunner {
	return &JobRunner{jobs: make(map[string]RenderJob), slots: make(chan struct{}, 2),
		render: func(ctx context.Context, root string, resolved composition.Composition, progress func(float64, string)) (ffmpeg.Output, error) {
			return (ffmpeg.Renderer{Root: root, Progress: progress}).Render(ctx, resolved)
		}}
}

func (runner *JobRunner) Create(c *fiber.Ctx) error {
	input, parsed, err := ParseProject(c.Body())
	if err != nil {
		return parseError(c, err)
	}
	result := WithPositions(engine.Compile(input), parsed)
	if result.Composition == nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(result)
	}
	return runner.create(c, result)
}

func (runner *JobRunner) GenerateAndCreate(c *fiber.Ctx) error {
	if meter := credits.FromContext(c.UserContext()); meter != nil {
		meter.DeferredUsage = true
	}
	input, parsed, err := ParseProject(c.Body())
	if err != nil {
		return parseError(c, err)
	}
	static := input
	static.Assets = nil
	checked := engine.Validate(static)
	if HasErrors(checked) {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(WithPositions(checked, parsed))
	}
	select {
	case runner.slots <- struct{}{}:
	default:
		return fiber.NewError(fiber.StatusTooManyRequests, "render workers are busy; retry later")
	}
	return runner.enqueue(c, renderManifest{Input: &input})
}

func (runner *JobRunner) create(c *fiber.Ctx, result composition.Result) error {
	if _, err := result.Composition.PreparedText.Resolve(result.Composition.TextItems, result.Composition.Output); err != nil {
		return fiber.NewError(fiber.StatusUnprocessableEntity, err.Error())
	}
	select {
	case runner.slots <- struct{}{}:
	default:
		return fiber.NewError(fiber.StatusTooManyRequests, "render workers are busy; retry later")
	}
	return runner.enqueue(c, renderManifest{Document: *result.Document, Composition: *result.Composition})
}

func (runner *JobRunner) enqueue(c *fiber.Ctx, manifest renderManifest) error {
	session := sessions.FromRequest(c)
	root, err := sessions.Touch(session)
	if err != nil {
		log.Printf("provision render workspace: %v", err)
		<-runner.slots
		return media.AssetError(c, err)
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		<-runner.slots
		return fiber.NewError(fiber.StatusInternalServerError, "cannot create render job")
	}
	job := RenderJob{ID: hex.EncodeToString(random[:]), Status: "queued", CompositionID: manifest.Composition.ID,
		DocumentRevision: manifest.Document.Revision, CreatedAt: time.Now().UTC()}
	manifest.Job = job
	if err := saveManifest(root, manifest); err != nil {
		log.Printf("save queued render manifest: %v", err)
		<-runner.slots
		return media.AssetError(c, err)
	}
	runner.update(session, job)
	credits.Detach(c.UserContext())
	go runner.execute(context.WithoutCancel(c.UserContext()), session, root, manifest)
	c.Set(fiber.HeaderLocation, c.Path()+"/"+job.ID)
	return c.Status(fiber.StatusAccepted).JSON(job)
}

func (runner *JobRunner) execute(parent context.Context, session, root string, manifest renderManifest) {
	defer func() { <-runner.slots }()
	ctx, cancel := context.WithTimeout(parent, 2*time.Hour)
	defer cancel()
	defer openrouter.FinishUsage(ctx)
	go keepRenderSession(ctx, session)
	job := manifest.Job
	job.Status = "running"
	runner.update(session, job)
	if manifest.Input != nil {
		job.Message = "Preparing sources, recipe actions and text"
		runner.update(session, job)
		result, err := prepareAutomationRender(ctx, *manifest.Input, root, session)
		if err != nil {
			job.Status, job.Message = "failed", err.Error()
			manifest.Job = job
			if err := saveManifest(root, manifest); err != nil {
				log.Printf("save failed render %s: %v", job.ID, err)
			}
			runner.update(session, job)
			return
		}
		manifest.Document, manifest.Composition = *result.Document, *result.Composition
		job.CompositionID, job.DocumentRevision = result.Composition.ID, result.Document.Revision
	}
	for _, asset := range manifest.Composition.Assets {
		media.WarmSession(ctx, session, root, asset.File)
	}
	var output ffmpeg.Output
	err := credits.ChargeRender(ctx, manifest.Composition.Duration.Seconds())
	if err == nil {
		output, err = runner.render(ctx, root, manifest.Composition, func(ratio float64, message string) {
			job.Progress, job.Message = ratio, message
			runner.update(session, job)
		})
	}
	if err == nil && manifest.Input != nil {
		if publishErr := objectstore.PublishFile(ctx, output.Path, objectstore.RenderKey(sessions.S3Prefix(session), output.Filename)); publishErr != nil {
			log.Printf("publish render %s: %v", job.ID, publishErr)
			err = fmt.Errorf("Cloud persistence failed. The local render was kept; retry when storage is available.")
		}
	}
	if err != nil {
		credits.RefundRender(ctx)
		job.Status, job.Message = "failed", err.Error()
		log.Printf("composition render %s failed: %v", job.ID, err)
	} else {
		job.Cost = completedRenderCost(ctx)
		job.Status, job.Progress, job.Filename, job.Message = "completed", 1, output.Filename, "Render complete"
		s3user := sessions.S3Prefix(session)
		if manifest.Input == nil {
			objectstore.BackgroundPut(s3user, output.Path, objectstore.RenderKey(s3user, output.Filename))
		}
	}
	manifest.Job = job
	if err := saveManifest(root, manifest); err != nil {
		log.Printf("save render manifest %s: %v", job.ID, err)
	}
	runner.update(session, job)
}

func prepareAutomationRender(ctx context.Context, input compiler.Input, root, session string) (composition.Result, error) {
	if needsTextService(input) && !textprepare.Configured() {
		return engine.CompileDraft(input), fmt.Errorf("Text preparation is not configured. Set SCENE_SERVICE_URL before generating a captioned video, or supply renderer-prepared text for existing captions.")
	}
	input, err := ResolveProjectAssets(ctx, input, root, session)
	if err != nil {
		return composition.Result{}, fmt.Errorf("Source media is missing or invalid. Upload its original into this project first.")
	}
	result, err := CompileGenerated(ctx, input, root, session)
	if err != nil {
		return result, fmt.Errorf("Recipe generation failed. Check the generation service configuration.")
	}
	if result.Composition == nil {
		messages := make([]string, 0, len(result.Diagnostics)+len(result.Requirements))
		for _, item := range result.Diagnostics {
			messages = append(messages, item.Path+": "+item.Message)
		}
		for _, item := range result.Requirements {
			messages = append(messages, item.Message)
		}
		return result, fmt.Errorf("Recipe needs attention: %s", strings.Join(messages, "; "))
	}
	known := make(map[string]bool, len(input.Assets))
	for _, asset := range input.Assets {
		known[asset.File] = true
	}
	for _, asset := range result.Composition.Assets {
		if known[asset.File] {
			continue
		}
		path, err := storage.SafeJoinIn(root, asset.File)
		if err != nil {
			return result, fmt.Errorf("Generated source could not be published.")
		}
		if err := objectstore.PublishFile(ctx, path, objectstore.Key(sessions.S3Prefix(session), asset.File)); err != nil {
			log.Printf("publish generated source: %v", err)
			return result, fmt.Errorf("Cloud persistence failed for a generated source. Retry after storage is available.")
		}
	}
	if window, present := render.PreviewFromContext(ctx); present {
		working, err := render.PreviewTextComposition(*result.Composition, window)
		if err != nil {
			return result, err
		}
		result.Composition = &working
	}
	if err := textprepare.Prepare(ctx, result.Composition); err != nil {
		result.Recovery = recoveryEnvelope(*result.Document, input.Bindings, result.Composition.Assets)
		return result, fmt.Errorf("Text preparation is unavailable. Configure the text service or export preparedText from the editor.")
	}
	return result, nil
}

func (runner *JobRunner) update(session string, job RenderJob) {
	runner.mu.Lock()
	defer runner.mu.Unlock()
	// Completed status remains available on disk; only live/recent jobs occupy memory.
	if len(runner.jobs) >= 256 {
		for key, existing := range runner.jobs {
			if existing.Status == "completed" || existing.Status == "failed" {
				delete(runner.jobs, key)
			}
		}
	}
	runner.jobs[session+"/"+job.ID] = job
}

var jobIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (runner *JobRunner) Status(c *fiber.Ctx) error {
	id, session := c.Params("id"), sessions.FromRequest(c)
	if !jobIDPattern.MatchString(id) {
		return fiber.ErrNotFound
	}
	root, err := sessions.Touch(session)
	if err != nil {
		return media.AssetError(c, err)
	}
	runner.mu.RLock()
	job, exists := runner.jobs[session+"/"+id]
	runner.mu.RUnlock()
	if exists {
		return c.JSON(job)
	}
	data, err := os.ReadFile(filepath.Join(root, "composition_job_"+id+".json"))
	if os.IsNotExist(err) {
		return fiber.ErrNotFound
	}
	if err != nil {
		return media.AssetError(c, err)
	}
	var manifest renderManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "render manifest is unreadable")
	}
	job = manifest.Job
	if job.Status == "queued" || job.Status == "running" {
		job.Status, job.Message = "failed", "Render interrupted by a server restart. Submit the saved document again."
	}
	return c.JSON(job)
}

func keepRenderSession(ctx context.Context, session string) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := sessions.Touch(session); err != nil {
				log.Printf("refresh render session: %v", err)
			}
		}
	}
}

func saveManifest(root string, manifest renderManifest) error {
	data, err := json.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("encode render manifest: %w", err)
	}
	file, err := os.CreateTemp(root, "manifest_*.tmp")
	if err != nil {
		return fmt.Errorf("create render manifest: %w", err)
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(file.Name(), filepath.Join(root, "composition_job_"+manifest.Job.ID+".json")); err != nil {
		return fmt.Errorf("publish render manifest: %w", err)
	}
	return nil
}
