package compositions

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/composition"

	"github.com/gofiber/fiber/v2"
)

func TestHTTPValidationReportsRecipeTypeAndTimelineErrors(t *testing.T) {
	app := fiber.New()
	app.Post("/validate", Validate)
	for _, test := range []struct {
		name    string
		source  string
		status  int
		path    string
		message string
	}{
		{
			name:   "numeric compatibility pin",
			source: "document:\n  version: 2\n  mode: assemble\n  catalogVersion: 1\n",
			status: http.StatusBadRequest, path: "catalogVersion", message: `quote the value as "1"`,
		},
		{
			name: "timeline end used as source outPoint",
			source: `document:
  version: 2
  mode: assemble
  tracks:
    - id: main
      type: video
      clips:
        - {id: a, assetId: photo, start: 2.8, inPoint: 0, outPoint: 7.57}
        - {id: b, assetId: photo, start: 7.22, inPoint: 0, outPoint: 7.39}
  transitions:
    - {id: x1, trackId: main, leftClipId: a, rightClipId: b, preset: cross-dissolve, duration: 0.35}
assets:
  - {id: photo, file: fixture.jpg, kind: image, version: example-only}
`,
			status: http.StatusUnprocessableEntity, path: "transitions[0].duration", message: "timeline overlap 3.15s",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewBufferString(test.source))
			request.Header.Set("Content-Type", "application/yaml")
			response, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			var result composition.Result
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != test.status || result.Composition != nil {
				t.Fatalf("status=%d, result=%+v", response.StatusCode, result)
			}
			for _, diagnostic := range result.Diagnostics {
				if diagnostic.Path == test.path && diagnostic.Severity == "error" && strings.Contains(diagnostic.Message, test.message) {
					return
				}
			}
			t.Fatalf("missing actionable diagnostic: %+v", result.Diagnostics)
		})
	}
}
