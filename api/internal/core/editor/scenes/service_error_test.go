package scenes

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestRendererInfrastructureDiagnosticSurvivesEveryClientPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Scene-Error-Code", "scene_renderer_permission_denied")
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, "untrusted /private/path secret")
	}))
	defer server.Close()
	t.Setenv("SCENE_SERVICE_URL", server.URL)
	_, compileErr := compileRemote(context.Background(), "<p>Scene</p>", Config{})
	_, renderErr := renderRemote(context.Background(), "<p>Scene</p>", Config{}, nil, nil, filepath.Join(t.TempDir(), "unused.mp4"))
	for _, err := range []error{compileErr, renderErr, rendererReady(context.Background())} {
		message := PublicServiceDiagnostic(fmt.Errorf("materialize scene: %w", err))
		if !strings.Contains(message, "EACCES") || !strings.Contains(message, "Rebuild") || strings.Contains(message, "secret") || strings.Contains(message, "/private") {
			t.Fatalf("missing safe infrastructure cause: %q (%v)", message, err)
		}
	}
}

func TestUnknownInfrastructureCodesCannotExposeServiceBody(t *testing.T) {
	response := &http.Response{StatusCode: http.StatusServiceUnavailable, Header: http.Header{}}
	response.Header.Set("X-Scene-Error-Code", "private secret")
	if err := rendererServiceError(response); err != nil {
		t.Fatalf("untrusted diagnostic accepted: %v", err)
	}
	if got := PublicServiceDiagnostic(fmt.Errorf("private secret")); got != "" {
		t.Fatalf("untrusted diagnostic exposed: %s", got)
	}
}
