package projects

import (
	"encoding/json"
	"errors"
	"log"
	"path/filepath"
	"time"

	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func NewStore() *Store {
	return &Store{Root: filepath.Join(storage.DataDir, ".projects"), Presentations: NewPresentationStore(), Now: time.Now, Session: func(owner, id string) string {
		if id == "default" {
			return "u_" + owner
		}
		return id
	}}
}

func (s *Store) activate(owner string, project Summary) error {
	if err := sessions.BindProject(project.SessionID, owner); err != nil {
		return err
	}
	_, err := sessions.TouchOwned(project.SessionID, owner)
	return err
}

func (s *Store) ListHandler(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	items, err := s.EnsureInitial(auth.UserID(c))
	if err != nil {
		return projectError(c, err)
	}
	return c.JSON(items)
}

func (s *Store) CreateHandler(c *fiber.Ctx) error {
	var input struct {
		Name string `json:"name"`
	}
	if len(c.Body()) > 4096 || c.BodyParser(&input) != nil {
		return projectError(c, ErrInvalid)
	}
	project, err := s.Create(auth.UserID(c), input.Name)
	if err == nil {
		err = s.activate(auth.UserID(c), project.Summary)
	}
	if err != nil {
		return projectError(c, err)
	}
	return sendProject(c, project, fiber.StatusCreated)
}

func (s *Store) GetHandler(c *fiber.Ctx) error {
	project, err := s.Get(auth.UserID(c), c.Params("projectID"))
	if err == nil {
		err = s.activate(auth.UserID(c), project.Summary)
	}
	if err != nil {
		return projectError(c, err)
	}
	presentation := Presentation{}
	warning := ""
	if s.Presentations != nil {
		presentation, err = s.Presentations.Load(c.UserContext(), auth.UserID(c), project.SessionID)
		if err != nil {
			log.Printf("load project presentation %s: %v", project.ID, err)
			warning = "The prepared composition could not be loaded. Your saved timeline is safe; reload the project to retry."
		}
	}
	project.Presentation = &presentation
	project.PresentationWarning = warning
	prepared := presentation.Prepared
	if prepared == nil {
		prepared = presentation.LastRender
	}
	if warning == "" && prepared != nil && prepared.Document != nil && prepared.Composition != nil {
		updated, applyErr := s.ApplyPrepared(auth.UserID(c), project.SessionID, *prepared)
		if applyErr != nil {
			log.Printf("prepare project timeline %s: %v", project.ID, applyErr)
			project.PresentationWarning = "The prepared timeline could not be saved. Reload the project to retry; existing edits were kept."
		} else {
			updated.Presentation = project.Presentation
			project = updated
		}
	}
	return sendProject(c, project, fiber.StatusOK)
}

func sendProject(c *fiber.Ctx, project Project, status int) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	token := ""
	if sessions.IsLegacySession(project.SessionID) {
		var err error
		token, err = sessions.MediaToken(project.SessionID)
		if err != nil {
			return projectError(c, err)
		}
	}
	return c.Status(status).JSON(struct {
		Project
		MediaToken string `json:"mediaToken,omitempty"`
	}{Project: project, MediaToken: token})
}

func (s *Store) ScopeAPI(c *fiber.Ctx) error {
	project, err := s.Get(auth.UserID(c), c.Params("projectID"))
	if err == nil {
		err = s.activate(auth.UserID(c), project.Summary)
	}
	if err != nil {
		return projectError(c, err)
	}
	// External callers select an owned project, never an arbitrary media session.
	c.Request().Header.Set("X-Session-Id", project.SessionID)
	return c.Next()
}

func (s *Store) SaveHandler(c *fiber.Ctx) error {
	if len(c.Body()) > MaxStateBytes {
		return c.SendStatus(fiber.StatusRequestEntityTooLarge)
	}
	var input struct {
		Name    string          `json:"name"`
		Version int             `json:"version"`
		State   json.RawMessage `json:"state"`
	}
	if c.BodyParser(&input) != nil {
		return projectError(c, ErrInvalid)
	}
	project, err := s.Update(auth.UserID(c), c.Params("projectID"), input.Name, input.Version, input.State)
	if err != nil {
		return projectError(c, err)
	}
	return c.JSON(project.Summary)
}

func projectError(c *fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, ErrNotFound):
		return c.Status(fiber.StatusNotFound).SendString(err.Error())
	case errors.Is(err, ErrConflict):
		return c.Status(fiber.StatusConflict).SendString(err.Error())
	case errors.Is(err, ErrInvalid):
		return c.Status(fiber.StatusBadRequest).SendString("Enter a project name of 1–120 characters and valid project data.")
	default:
		log.Printf("projects: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Could not save or load the project. Please retry.")
	}
}
