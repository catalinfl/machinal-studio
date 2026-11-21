package projects

import (
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
	stream, err := s.openResponse(c.UserContext(), auth.UserID(c), c.Params("projectID"))
	if err != nil {
		return projectError(c, err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSONCharsetUTF8)
	return c.SendStream(stream, int(stream.size))
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
	project, err := s.GetSummary(auth.UserID(c), c.Params("projectID"))
	if err == nil {
		err = s.activate(auth.UserID(c), project)
	}
	if err != nil {
		return projectError(c, err)
	}
	// External callers select an owned project, never an arbitrary media session.
	c.Request().Header.Set("X-Session-Id", project.SessionID)
	return c.Next()
}

func (s *Store) SaveHandler(c *fiber.Ctx) error {
	// Do not keep multi-megabyte autosaves attached to idle keep-alive requests.
	defer c.Request().ReleaseBody(maxRetainedSaveBody)
	if len(c.Body()) > MaxStateBytes {
		return c.SendStatus(fiber.StatusRequestEntityTooLarge)
	}
	var input struct {
		Name    string       `json:"name"`
		Version int          `json:"version"`
		State   borrowedJSON `json:"state"`
	}
	if c.BodyParser(&input) != nil {
		return projectError(c, ErrInvalid)
	}
	project, err := s.update(auth.UserID(c), c.Params("projectID"), input.Name, input.Version, []byte(input.State))
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
