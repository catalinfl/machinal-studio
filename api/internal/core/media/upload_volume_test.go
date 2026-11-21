package media

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

func TestAPIUploadStoresOnlyOnVolumeEvenWhenS3IsUnavailable(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); w.WriteHeader(503) }))
	defer server.Close()
	shared := objectstore.Shared()
	previousConfig := shared.Config
	shared.Config = objectstore.Config{Endpoint: server.URL, Region: "auto", Bucket: "bucket", AccessKey: "test", SecretKey: "secret"}
	t.Cleanup(func() { shared.Config = previousConfig })
	app := fiber.New()
	app.Post("/v1/upload", func(c *fiber.Ctx) error {
		c.Locals("machinalAPIKey", "key")
		c.Request().Header.Set("X-Session-Id", "p_volume_upload")
		return Upload(c)
	})
	payload := []byte("\x89PNG\r\n\x1a\nlocal source bytes")
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "animal.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/v1/upload", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode, string(data))
	}
	stored, err := os.ReadFile(filepath.Join(storage.DataDir, "p_volume_upload", "animal.png"))
	if err != nil || !bytes.Equal(stored, payload) {
		t.Fatal("source not stored on volume", err)
	}
	if requests.Load() != 0 {
		t.Fatal("API source was sent to S3")
	}
}
