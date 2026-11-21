package scenes

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInspectionRejectsUnsafeAndAmbiguousRequests(t *testing.T) {
	file := "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json"
	version := "sha256:" + strings.Repeat("a", 64)
	for _, body := range []string{
		`{"file":"../../other.scene.json","sourceVersion":"` + version + `","frames":[0]}`,
		`{"file":"` + file + `","sourceVersion":"` + version + `","frames":[0,0]}`,
		`{"file":"` + file + `","sourceVersion":"` + version + `","frames":[-1]}`,
		`{"file":"` + file + `","sourceVersion":"` + version + `","frames":[0],"component":"replacement"}`,
		`{"file":"` + file + `","sourceVersion":"` + version + `","frames":[0]} {}`,
		strings.Repeat("x", maxInspectionRequestBytes+1),
	} {
		if _, err := decodeInspectionRequest([]byte(body)); err == nil {
			t.Fatal("unsafe input accepted", body[:min(100, len(body))])
		}
	}
}

func TestInspectionRejectsOversizeAndInvalidServiceResponses(t *testing.T) {
	for _, response := range []string{`invalid`, strings.Repeat("x", maxInspectionResponseBytes+1)} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(response)) }))
		t.Setenv("SCENE_SERVICE_URL", server.URL)
		_, err := inspectRemote(context.Background(), LiveSource{}, []int{0})
		server.Close()
		if err == nil {
			t.Fatal("invalid/oversized evidence accepted")
		}
	}
}
