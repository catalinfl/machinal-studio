package projects

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

type captionDeliveryCloud struct {
	enabled    bool
	publishErr error
	signErr    error
	keys       []string
}

func (s *captionDeliveryCloud) Enabled() bool { return s.enabled }

func (s *captionDeliveryCloud) EnsurePublished(_ context.Context, _, key, _ string) error {
	s.keys = append(s.keys, key)
	return s.publishErr
}

func (s *captionDeliveryCloud) PresignDownload(_ string, ttl time.Duration) (string, error) {
	if ttl != textAssetDownloadLifetime {
		return "", errors.New("incorrect download lifetime")
	}
	return "https://storage.example/private-cache?temporary-signature=test", s.signErr
}

func TestCaptionCloudDeliveryNeverStreamsRasterBytesThroughAPI(t *testing.T) {
	for _, item := range []struct {
		name   string
		cloud  captionDeliveryCloud
		status int
	}{
		{"redirect", captionDeliveryCloud{enabled: true}, 302},
		{"unconfigured", captionDeliveryCloud{}, 503},
		{"publication failure", captionDeliveryCloud{enabled: true, publishErr: errors.New("unavailable")}, 503},
		{"signing failure", captionDeliveryCloud{enabled: true, signErr: errors.New("unavailable")}, 503},
	} {
		t.Run(item.name, func(t *testing.T) {
			t.Setenv("MEDIA_DELIVERY_MODE", "cloud")
			store := testStore(t.TempDir())
			store.textCloud = func() textAssetCloud { return &item.cloud }
			project, err := store.Create("alice", "Film")
			if err != nil {
				t.Fatal(err)
			}
			data, reference := textAssetFixture()
			if err := store.saveTextAsset("alice", project.ID, reference, data); err != nil {
				t.Fatal(err)
			}
			owner := "alice"
			app := fiber.New()
			app.Get("/projects/:projectID/text-assets/:assetID", func(c *fiber.Ctx) error { c.Locals("pbUserId", owner); return c.Next() }, store.GetTextAssetHandler)
			url := "/projects/" + project.ID + "/text-assets/" + reference.ID + "?key=" + reference.Key
			response, err := app.Test(httptest.NewRequest("GET", url, nil))
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if response.StatusCode != item.status || bytes.Contains(body, []byte("exact-PNG-bytes")) || len(body) > 512 {
				t.Fatalf("caption bytes leaked through API: status=%d body=%q", response.StatusCode, body)
			}
			if item.status == 302 && (response.Header.Get("Location") == "" || response.Header.Get("Cache-Control") != "no-store" || !strings.HasPrefix(item.cloud.keys[0], "alice/projects/"+project.ID+"/text-assets/")) {
				t.Fatal("missing private project-scoped cloud redirect")
			}
			calls := len(item.cloud.keys)
			owner = "bob"
			foreign, err := app.Test(httptest.NewRequest("GET", url, nil))
			if err != nil {
				t.Fatal(err)
			}
			foreign.Body.Close()
			if foreign.StatusCode != 404 || len(item.cloud.keys) != calls {
				t.Fatal("foreign project accessed cloud caption images")
			}
		})
	}
}
