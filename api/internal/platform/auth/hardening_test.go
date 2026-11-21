package auth

import (
	"net/http/httptest"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/sessions"
	"github.com/gofiber/fiber/v2"
)

func TestUnownedTrackedSessionDoesNotGrantAuthenticatedWriteAccess(t *testing.T) {
	id := sessions.NewID()
	if _, err := sessions.Touch(id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sessions.Evict(id) })
	app := fiber.New()
	app.Post("/write", func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice"); return c.Next() }, RequireOwnedSession, func(c *fiber.Ctx) error { return c.SendStatus(204) })
	request := httptest.NewRequest("POST", "/write", nil)
	request.Header.Set("X-Session-Id", id)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("unowned legacy session accepted a write", response.StatusCode)
	}
}

func TestAuthCacheHasAHardSizeBoundEvenWhenEntriesAreFresh(t *testing.T) {
	authCacheMu.Lock()
	saved := authCache
	authCache = make(map[string]authCacheEntry)
	authCacheMu.Unlock()
	t.Cleanup(func() { authCacheMu.Lock(); authCache = saved; authCacheMu.Unlock() })
	for i := range maxAuthCacheEntries + 100 {
		authCachePut(string(rune(i)), authCacheEntry{expires: time.Now().Add(time.Hour)})
	}
	if len(authCache) > maxAuthCacheEntries {
		t.Fatal("auth cache is unbounded", len(authCache))
	}
}
