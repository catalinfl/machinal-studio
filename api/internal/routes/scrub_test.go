package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

func TestScrubRangeRequestsDoNotExhaustAPIQuota(t *testing.T) {
	id := sessions.NewID()
	if _, err := sessions.TouchOwned(id, "seek-owner"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sessions.Evict(id) })
	app := fiber.New()
	registerEditorRoutes(app)

	const seekRequests = 50
	for i := 0; i < seekRequests; i++ {
		// A registered read capability reaches validation without requiring FFmpeg.
		request := httptest.NewRequest(http.MethodGet, "/scrub-proxy?session="+id+"&aspect=invalid", nil)
		request.Header.Set("Range", "bytes=0-1")
		response, err := app.Test(request)
		if err != nil {
			t.Fatalf("request %d: %v", i+1, err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("request %d: status = %d, want proxy validation status %d", i+1, response.StatusCode, http.StatusBadRequest)
		}
	}
}
