package media

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/delivery"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

type DeliveryLinks struct {
	links     *delivery.Store
	cloud     func() downloadStore
	authorize func(*fiber.Ctx, delivery.Record) error
	now       func() time.Time
}

func NewDeliveryLinks(links *delivery.Store, authorize func(*fiber.Ctx, delivery.Record) error) *DeliveryLinks {
	return &DeliveryLinks{links: links, authorize: authorize, cloud: func() downloadStore { return objectstore.Shared() }, now: time.Now}
}

type deliveryInput struct {
	File              string `json:"file"`
	Storage           string `json:"storage"`
	RequirePublicLink bool   `json:"requirePublicLink,omitempty"`
}

const maxDeliveryInputBytes = 1024

func parseDeliveryInput(c *fiber.Ctx) (deliveryInput, error) {
	var input deliveryInput
	decoder := json.NewDecoder(bytes.NewReader(c.Body()))
	decoder.DisallowUnknownFields()
	if len(c.Body()) > maxDeliveryInputBytes || decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
		return input, fiber.ErrBadRequest
	}
	if input.Storage != "s3" && input.Storage != "volume" {
		return input, fiber.NewError(fiber.StatusBadRequest, "storage must be s3 or volume")
	}
	return input, nil
}

func (h *DeliveryLinks) Create(c *fiber.Ctx) error {
	deliveryHeaders(c)
	input, err := parseDeliveryInput(c)
	if err != nil {
		return err
	}
	origin, err := deliveryOrigin(c)
	if err != nil {
		return err
	}
	if input.RequirePublicLink && loopbackDeliveryOrigin(origin) {
		return fiber.NewError(fiber.StatusServiceUnavailable, "This delivery origin is loopback-only. Configure PUBLIC_API_URL with a reachable HTTPS API origin for links opened on another device. No link was issued; do not rerender the existing video.")
	}
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrUnauthorized
	}
	if err := h.verifyFile(c, root, session, input); err != nil {
		return err
	}
	keyID, _ := c.Locals("machinalAPIKey").(string)
	link, err := h.links.Create(delivery.Record{Owner: auth.UserID(c), KeyID: keyID,
		ProjectID: c.Params("projectID"), File: input.File, Storage: input.Storage})
	if err != nil {
		return deliveryError(err)
	}
	descriptor := fiber.Map{
		"id": link.ID, "filename": link.File, "method": "GET", "storage": link.Storage,
		"url": origin + "/deliveries/" + link.Token, "expiresAt": link.ExpiresAt.Format(time.RFC3339),
		"authentication": "none; this opaque link grants temporary access to this file only. Do not attach the application API key.",
		"public":         false, "bearerUrl": true,
		"reachability": "configured-origin",
	}
	if loopbackDeliveryOrigin(origin) {
		descriptor["reachability"] = "same-machine"
		descriptor["warning"] = "This link opens only on the machine running the local API. For a phone or another computer, configure PUBLIC_API_URL with a reachable HTTPS origin and request a fresh link for the same file; never rerender."
	}
	return c.Status(fiber.StatusCreated).JSON(descriptor)
}

func (h *DeliveryLinks) verifyFile(c *fiber.Ctx, root, session string, input deliveryInput) error {
	if len(input.File) > 255 {
		return fiber.ErrBadRequest
	}
	if _, err := validateDeleteName(root, input.File); err != nil {
		return err
	}
	if input.Storage == "s3" {
		cloud := h.cloud()
		if !cloud.Enabled() {
			return fiber.NewError(fiber.StatusServiceUnavailable, "Cloud downloads are not configured. No storage fallback was used.")
		}
		_, err := findPreviewObject(c.UserContext(), input.File, sessions.S3Prefixes(session), cloud)
		if errors.Is(err, os.ErrNotExist) {
			return fiber.ErrNotFound
		}
		if err != nil {
			return fiber.NewError(fiber.StatusServiceUnavailable, "Cloud file verification is unavailable.")
		}
		return nil
	}
	file, err := openDeliveryFile(root, input.File)
	if err != nil {
		return fiber.ErrNotFound
	}
	if err := file.Close(); err != nil {
		return fiber.ErrInternalServerError
	}
	return nil
}

func openDeliveryFile(root, name string) (*os.File, error) {
	directory, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer directory.Close()
	file, err := directory.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, os.ErrNotExist
	}
	return file, nil
}

func (h *DeliveryLinks) Download(c *fiber.Ctx) error {
	deliveryHeaders(c)
	link, err := h.links.Get(c.Params("token"))
	if err != nil {
		return deliveryError(err)
	}
	if err := h.authorize(c, link.Record); err != nil {
		return err
	}
	root, session := sessions.ResolveRoot(c)
	if session == "" {
		return fiber.ErrNotFound
	}
	if link.Storage == "s3" {
		return h.redirectCloud(c, link, session)
	}
	return sendDeliveryFile(c, root, link.File)
}

func (h *DeliveryLinks) redirectCloud(c *fiber.Ctx, link delivery.Link, session string) error {
	cloud := h.cloud()
	if !cloud.Enabled() {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Cloud downloads are unavailable.")
	}
	object, err := findPreviewObject(c.UserContext(), link.File, sessions.S3Prefixes(session), cloud)
	if err != nil {
		return AssetError(c, err)
	}
	remaining := link.ExpiresAt.Sub(h.now())
	if remaining < time.Second {
		return fiber.ErrNotFound
	}
	url, err := cloud.PresignDownload(object.Key, min(downloadURLLifetime, remaining))
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Could not start the cloud download.")
	}
	c.Set(fiber.HeaderLocation, url)
	return c.SendStatus(fiber.StatusFound)
}

func sendDeliveryFile(c *fiber.Ctx, root, name string) error {
	file, err := openDeliveryFile(root, name)
	if err != nil {
		return AssetError(c, err)
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return fiber.ErrNotFound
	}
	c.Set(fiber.HeaderContentDisposition, mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Set(fiber.HeaderContentType, contentType)
	if c.Method() == fiber.MethodHead {
		file.Close()
		c.Response().Header.SetContentLength(int(info.Size()))
		return nil
	}
	return c.SendStream(&assetStream{Reader: file, file: file}, int(info.Size()))
}

func (h *DeliveryLinks) Revoke(c *fiber.Ctx) error {
	deliveryHeaders(c)
	if err := h.links.Revoke(auth.UserID(c), c.Params("projectID"), c.Params("linkID")); err != nil {
		return deliveryError(err)
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func deliveryHeaders(c *fiber.Ctx) {
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Set("Referrer-Policy", "no-referrer")
	c.Set("X-Robots-Tag", "noindex, nofollow")
	c.Set("X-Content-Type-Options", "nosniff")
}

func deliveryError(err error) error {
	if errors.Is(err, delivery.ErrNotFound) {
		return fiber.ErrNotFound
	}
	if errors.Is(err, delivery.ErrLimit) {
		return fiber.NewError(fiber.StatusTooManyRequests, "Too many active download links. Revoke unused links or wait for expiry.")
	}
	return fiber.NewError(fiber.StatusServiceUnavailable, "Download links are temporarily unavailable.")
}
