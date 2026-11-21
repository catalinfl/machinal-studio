package media

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestLegacyUploadDoesNotAcceptModelAttachments(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "subject.glb")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("glTF")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Post("/upload", Upload)
	request := httptest.NewRequest(http.MethodPost, "/upload", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatal("legacy media pipeline accepted GLB", response.StatusCode)
	}
}
