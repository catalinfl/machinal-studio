package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestImageRouteRequiresAIEditToken(t *testing.T) {
	// AI_EDIT_TOKEN is dead config (never enforced; auth is via PB + paid).
	// This guards the login requirement on the image route.
	app := fiber.New()
	registerEditorRoutes(app)

	request := httptest.NewRequest(http.MethodPost, "/ai/images", nil)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.StatusCode, fiber.StatusUnauthorized)
	}
}
