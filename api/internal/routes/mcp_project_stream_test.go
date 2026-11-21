package routes

import (
	"errors"
	"io"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/mcpserver"
	"github.com/valyala/fasthttp"
)

func TestInternalAPICallerOnlyReadsBoundedProjectJSONStreams(t *testing.T) {
	for _, test := range []struct {
		name, method, path, contentType, body string
		declared                              int
		allowed                               bool
	}{
		{"owned project JSON", "GET", "/v1/projects/p_film", "application/json", `{"state":null}`, -1, true},
		{"trailing slash", "GET", "/v1/projects/p_film/", "application/json; charset=utf-8", `{}`, 2, true},
		{"media bytes", "GET", "/v1/projects/p_film/download", "video/mp4", "bytes", -1, false},
		{"other JSON stream", "GET", "/v1/projects/p_film/media", "application/json", `{}`, -1, false},
		{"wrong content type", "GET", "/v1/projects/p_film", "video/mp4", "bytes", -1, false},
		{"post stream", "POST", "/v1/projects/p_film", "application/json", `{}`, -1, false},
		{"declared oversized", "GET", "/v1/projects/p_film", "application/json", `{}`, mcpserver.MaxResultBytes + 1, false},
		{"undeclared oversized", "GET", "/v1/projects/p_film", "application/json", strings.Repeat("x", mcpserver.MaxResultBytes+1), -1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var response fasthttp.Response
			defer response.Reset()
			response.Header.SetContentType(test.contentType)
			response.SetBodyStream(io.NopCloser(strings.NewReader(test.body)), test.declared)
			data, err := internalAPIResponseBody(&response, mcpserver.Request{Method: test.method, Path: test.path})
			if test.allowed {
				if err != nil || string(data) != test.body {
					t.Fatalf("project JSON not read: %v", err)
				}
			} else if !errors.Is(err, mcpserver.ErrResultTooLarge) {
				t.Fatalf("unapproved or oversized stream accepted: %v", err)
			}
		})
	}
}
