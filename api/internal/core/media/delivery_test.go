package media

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/delivery"
	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

type deliveryCloud struct {
	enabled bool
	signed  int
	key     string
}

func TestLoopbackDeliveryIsExplicitAndCrossDeviceRequestsDoNotIssueLinks(t *testing.T) {
	app, _, _ := deliveryFixture(t)
	t.Setenv("PUBLIC_API_URL", "http://127.0.0.1:8080")
	descriptor := issueDelivery(t, app, `{"file":"render_test.mp4","storage":"s3"}`, 201)
	if descriptor["reachability"] != "same-machine" || !strings.Contains(descriptor["warning"].(string), "phone") {
		t.Fatal("loopback link presented as portable", descriptor)
	}
	issueDelivery(t, app, `{"file":"render_test.mp4","storage":"s3","requirePublicLink":true}`, 503)
	t.Setenv("PUBLIC_API_URL", "https://api.example")
	descriptor = issueDelivery(t, app, `{"file":"render_test.mp4","storage":"s3","requirePublicLink":true}`, 201)
	if descriptor["reachability"] != "configured-origin" || descriptor["warning"] != nil || !strings.HasPrefix(descriptor["url"].(string), "https://api.example/") {
		t.Fatal(descriptor)
	}
}

func (s *deliveryCloud) Enabled() bool { return s.enabled }
func (s *deliveryCloud) Head(_ context.Context, key string) (objectstore.Object, error) {
	s.key = key
	return objectstore.Object{Key: key, Size: 100}, nil
}
func (s *deliveryCloud) PresignDownload(key string, ttl time.Duration) (string, error) {
	s.signed++
	s.key = key
	return "https://s3.example/video?X-Amz-Credential=id&X-Amz-Signature=temporary", nil
}

func deliveryFixture(t *testing.T) (*fiber.App, *deliveryCloud, *bool) {
	t.Helper()
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	t.Setenv("PUBLIC_API_URL", "https://api.example")
	allowed := true
	cloud := &deliveryCloud{enabled: true}
	handler := NewDeliveryLinks(delivery.NewStore(), func(c *fiber.Ctx, record delivery.Record) error {
		if !allowed || record.Owner != "alice" || record.KeyID != "alice_key" || record.ProjectID != "p_delivery" {
			return fiber.ErrNotFound
		}
		c.Request().Header.Set("X-Session-Id", "p_delivery")
		return nil
	})
	handler.cloud = func() downloadStore { return cloud }
	app := fiber.New()
	app.Post("/v1/projects/:projectID/media/delivery-links", func(c *fiber.Ctx) error {
		c.Locals("pbUserId", "alice")
		c.Locals("machinalAPIKey", "alice_key")
		c.Request().Header.Set("X-Session-Id", "p_delivery")
		return c.Next()
	}, handler.Create)
	app.Get("/deliveries/:token", handler.Download)
	return app, cloud, &allowed
}

func issueDelivery(t *testing.T, app *fiber.App, body string, status int) map[string]any {
	t.Helper()
	request := httptest.NewRequest("POST", "/v1/projects/p_delivery/media/delivery-links", strings.NewReader(body))
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != status {
		data, _ := io.ReadAll(response.Body)
		t.Fatalf("issue status=%d, want=%d, body=%s", response.StatusCode, status, data)
	}
	if status != http.StatusCreated {
		return nil
	}
	var descriptor map[string]any
	if err := json.NewDecoder(response.Body).Decode(&descriptor); err != nil {
		t.Fatal(err)
	}
	return descriptor
}

func deliveryRequest(method, target string) *http.Request {
	request := httptest.NewRequest(method, target, nil)
	// Fiber's test serializer needs origin-form URIs to preserve the Host header.
	request.RequestURI = request.URL.RequestURI()
	return request
}

func TestCloudDeliveryIssuesOpaqueLinkAndSignsOnlyAtRedemption(t *testing.T) {
	app, cloud, allowed := deliveryFixture(t)
	descriptor := issueDelivery(t, app, `{"file":"render_test.mp4","storage":"s3"}`, 201)
	url := descriptor["url"].(string)
	if !strings.HasPrefix(url, "https://api.example/deliveries/") || strings.Contains(url, "Amz") || cloud.signed != 0 {
		t.Fatal("raw cloud credentials exposed while issuing a link", descriptor, cloud)
	}
	response, err := app.Test(deliveryRequest("GET", url))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 302 || cloud.signed != 1 || cloud.key != "p_delivery/renders/render_test.mp4" || !strings.HasPrefix(response.Header.Get("Location"), "https://s3.example/") {
		t.Fatal("cloud bytes were proxied or wrong scope used", response.StatusCode, cloud)
	}
	if response.Header.Get("Referrer-Policy") != "no-referrer" || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("bearer redirect can be cached/leaked by referrer")
	}
	*allowed = false
	response, err = app.Test(deliveryRequest("GET", url))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 || cloud.signed != 1 {
		t.Fatal("revoked access still issued cloud redirects")
	}
}

func TestVolumeDeliveryNeverNeedsS3OrAnApplicationKeyOnDownload(t *testing.T) {
	app, cloud, _ := deliveryFixture(t)
	cloud.enabled = false
	root, err := storage.EnsureUserDir("p_delivery")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "clip.mp4"), []byte("approved-video"), 0600); err != nil {
		t.Fatal(err)
	}
	descriptor := issueDelivery(t, app, `{"file":"clip.mp4","storage":"volume"}`, 201)
	for _, method := range []string{"GET", "HEAD"} {
		response, err := app.Test(deliveryRequest(method, descriptor["url"].(string)))
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || cloud.signed != 0 || method == "GET" && string(data) != "approved-video" {
			t.Fatal("volume delivery failed", method, response.StatusCode, string(data), err)
		}
	}
	issueDelivery(t, app, `{"file":"clip.mp4","storage":"s3"}`, 503)
	issueDelivery(t, app, `{"file":"missing.mp4","storage":"volume"}`, 404)
	issueDelivery(t, app, `{"file":"../secret.mp4","storage":"volume"}`, 400)
	issueDelivery(t, app, `{"file":"clip.mp4","storage":"volume","url":"https://evil.example"}`, 400)
}

func TestDeliveryOriginRejectsUntrustedHostsAndAllowsLoopbackDevelopment(t *testing.T) {
	for _, test := range []struct {
		configured string
		requestURL string
		status     int
	}{
		{"https://api.example", "http://evil.example", 200},
		{"http://api.example", "http://localhost:8080", 503},
		{"https://user:secret@api.example", "http://localhost:8080", 503},
		{"https://api.example/path", "http://localhost:8080", 503},
		{"", "http://evil.example", 503},
		{"", "http://127.0.0.1:8080", 200},
	} {
		t.Setenv("PUBLIC_API_URL", test.configured)
		app := fiber.New()
		app.Get("/", func(c *fiber.Ctx) error {
			origin, err := deliveryOrigin(c)
			if err != nil {
				return err
			}
			return c.SendString(origin)
		})
		response, err := app.Test(deliveryRequest("GET", test.requestURL))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != test.status {
			t.Fatal(test, response.StatusCode)
		}
	}
}
