package projects

import (
	"errors"
	"io"
	"os"

	"ffmpeg-go-server/internal/platform/auth"
	"github.com/gofiber/fiber/v2"
)

func (s *Store) textAssetRequest(c *fiber.Ctx) (string, string, textAssetReference, error) {
	owner, project := auth.UserID(c), c.Params("projectID")
	_, err := s.GetSummary(owner, project)
	return owner, project, textAssetReference{ID: c.Params("assetID"), Key: c.Query("key")}, err
}

func (s *Store) SaveTextAssetHandler(c *fiber.Ctx) error {
	defer c.Request().ReleaseBody(maxRetainedSaveBody)
	owner, project, reference, err := s.textAssetRequest(c)
	if err == nil {
		err = s.saveTextAsset(owner, project, reference, c.Body())
	}
	if err != nil {
		return projectError(c, err)
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *Store) GetTextAssetHandler(c *fiber.Ctx) error {
	owner, project, reference, err := s.textAssetRequest(c)
	if err != nil {
		return projectError(c, err)
	}
	path, err := s.textAssetPath(owner, project, reference)
	if err != nil {
		return projectError(c, err)
	}
	file, err := openSnapshotFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return projectError(c, ErrNotFound)
	}
	if err != nil {
		return projectError(c, err)
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > MaxStateBytes {
		file.Close()
		return projectError(c, ErrInvalid)
	}
	cloud := s.textAssetCloud()
	if cloud.Enabled() || cloudTextDeliveryRequired() {
		file.Close()
		return redirectTextAsset(c, owner, project, reference, path, cloud)
	}
	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSONCharsetUTF8)
	c.Set(fiber.HeaderCacheControl, "private, no-cache")
	c.Set(fiber.HeaderETag, `"`+reference.ID+`"`)
	if c.Get(fiber.HeaderIfNoneMatch) == c.GetRespHeader(fiber.HeaderETag) {
		file.Close()
		return c.SendStatus(fiber.StatusNotModified)
	}
	stream := &projectStream{Reader: io.LimitReader(file, info.Size()), size: info.Size(), files: []*os.File{file}}
	return c.SendStream(stream, int(stream.size))
}
