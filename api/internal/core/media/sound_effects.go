package media

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/soundlibrary"

	"github.com/gofiber/fiber/v2"
)

type SoundLibrary interface {
	Search(context.Context, soundlibrary.Search) (soundlibrary.SearchResult, error)
	Lookup(context.Context, string) (soundlibrary.Sound, error)
	Download(context.Context, soundlibrary.Sound) ([]byte, error)
}

type SoundEffects struct{ Library SoundLibrary }

const maxSoundImportRequestBytes = 1024
const soundImportTimeout = time.Minute

type SoundImportRequest struct {
	ID            string `json:"id"`
	SourceVersion string `json:"sourceVersion"`
}

func (s *SoundEffects) Search(c *fiber.Ctx) error {
	input := soundlibrary.Search{Query: c.Query("query"), License: c.Query("license"), Page: c.QueryInt("page", 1), Limit: c.QueryInt("limit", 8)}
	if _, err := input.Normalize(); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	result, err := s.Library.Search(c.UserContext(), input)
	if err != nil {
		return soundFailure(c, err)
	}
	return c.JSON(result)
}

func (s *SoundEffects) Import(c *fiber.Ctx) error {
	if len(c.Body()) > maxSoundImportRequestBytes {
		return fiber.ErrRequestEntityTooLarge
	}
	var input SoundImportRequest
	if err := document.DecodeJSON(c.Body(), &input); err != nil || !soundlibrary.ValidID(input.ID) || !validSoundVersion(input.SourceVersion) {
		return fiber.NewError(fiber.StatusBadRequest, "Use the exact Openverse ID and sourceVersion from search_sound_effects.")
	}
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	release := sessions.UseWorkspace(session)
	defer release()
	ctx, cancel := context.WithTimeout(c.UserContext(), soundImportTimeout)
	defer cancel()
	sound, err := s.Library.Lookup(ctx, input.ID)
	if err != nil {
		return soundFailure(c, err)
	}
	if sound.SourceVersion != input.SourceVersion {
		return fiber.NewError(fiber.StatusConflict, "Sound metadata/licence changed. Search again and review the changed source before importing.")
	}
	if !sound.Importable {
		return fiber.NewError(fiber.StatusUnprocessableEntity, "This sound has no supported direct Freesound preview. No fallback or generation was attempted.")
	}
	// Never queue downloaded bodies behind a potentially large source upload.
	lock, _ := uploadLocks.LoadOrStore(session, &sync.Mutex{})
	if !lock.(*sync.Mutex).TryLock() {
		c.Set("Retry-After", "5")
		return fiber.NewError(fiber.StatusTooManyRequests, "Project import/upload is busy; retry this exact sound import later.")
	}
	defer lock.(*sync.Mutex).Unlock()
	body, err := s.Library.Download(ctx, sound)
	if err != nil {
		return soundFailure(c, err)
	}
	result, err := storeSound(ctx, root, session, sound, body)
	if err != nil {
		return err
	}
	return c.JSON(result)
}

func soundFailure(c *fiber.Ctx, err error) error {
	var failure *soundlibrary.Failure
	if errors.As(err, &failure) {
		if failure.RetryAfter != "" {
			c.Set("Retry-After", failure.RetryAfter)
		}
		return fiber.NewError(failure.Status, failure.Error())
	}
	return fiber.NewError(fiber.StatusBadGateway, fmt.Sprintf("Sound source unavailable or unsupported: %s", err.Error()))
}
