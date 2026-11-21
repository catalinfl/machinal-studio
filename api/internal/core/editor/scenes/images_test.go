package scenes

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

func transparentImage(t *testing.T) []byte {
	t.Helper()
	canvas := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	canvas.SetNRGBA(1, 0, color.NRGBA{R: 255, A: 255})
	var data bytes.Buffer
	if err := png.Encode(&data, canvas); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestSceneImagesPreserveOriginalAlphaAndValidateContent(t *testing.T) {
	root := t.TempDir()
	data := transparentImage(t)
	if err := os.WriteFile(filepath.Join(root, "product.png"), data, 0600); err != nil {
		t.Fatal(err)
	}
	input := SceneImage{ID: "image_1", File: "product.png", Name: "Product.png", Description: "Product cutout on the right", Width: 999}
	loaded, err := readSceneImage(root, input)
	if err != nil || loaded.Width != 2 || loaded.Height != 1 {
		t.Fatalf("image: %+v %v", loaded, err)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(loaded.DataURL, "data:image/png;base64,"))
	if err != nil || !bytes.Equal(data, decoded) {
		t.Fatal("embedded originals were changed")
	}
	for _, filename := range []string{"fake.png", "empty.png"} {
		content := []byte("<svg><script>bad</script></svg>")
		if filename == "empty.png" {
			content = nil
		}
		if err := os.WriteFile(filepath.Join(root, filename), content, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := readSceneImage(root, SceneImage{File: filename}); err == nil {
			t.Fatalf("accepted %s", filename)
		}
	}
	if _, err := readSceneImage(root, SceneImage{File: "../product.png"}); err == nil {
		t.Fatal("accepted traversal")
	}
	if err := validateImageInputs([]SceneImage{input, input}); err == nil {
		t.Fatal("accepted duplicate image IDs")
	}
	if err := validateImageSources(map[string]string{"image_1": "https://external.test/image.png"}); err == nil {
		t.Fatal("accepted external media")
	}
}

func TestImageMetadataReachesAIAndOriginalsReachSavedSceneAndExport(t *testing.T) {
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(transparentImage(t))
	attachment := SceneImage{ID: "image_1", File: "original.png", Name: "Product.png", Width: 2, Height: 1, Description: "Product on the right", DataURL: dataURL}
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openrouter.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		input := request.Messages[1].TextContent()
		if !strings.Contains(input, "Product on the right") || !strings.Contains(input, `"width":2`) || strings.Contains(input, "base64") {
			t.Error("AI must receive directions and dimensions, without embedded bytes")
		}
		if !strings.Contains(request.Messages[0].TextContent(), "LOCAL coordinates") || !strings.Contains(request.Messages[0].TextContent(), "$props()") {
			t.Error("missing anchor or image contract")
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": `<script>let { images } = $props();</script><img src={images.image_1} alt="Product" />`}}}})
	}))
	defer providerServer.Close()
	provider := Provider{Model: "test", Client: openrouter.Client{APIKey: "test", BaseURL: providerServer.URL, HTTPClient: providerServer.Client()}}
	runner := NewRunner()
	runner.compile = func(_ context.Context, _ string, _ Config, media compilationMedia) (string, error) {
		if media.Images["image_1"] != dataURL {
			t.Fatal("layout inspection lost the original attached image")
		}
		return "preview bundle", nil
	}
	root := t.TempDir()
	scene, err := runner.prepareScene(context.Background(), root, Request{Width: 320, Height: 180, FPS: 30, Images: []SceneImage{attachment}}, provider, strings.Repeat("a", 32), 0, Definition{Title: "Product", Brief: "Product enters", End: 1}, 0, func() {})
	if err != nil {
		t.Fatal(err)
	}
	// Removing the upload must not break the scene: its original bytes are embedded.
	saved, err := ReadSource(root, scene.Asset.File)
	if err != nil || saved.Images["image_1"] != dataURL {
		t.Fatalf("saved media missing: %v", err)
	}
	exported := false
	renderServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Images map[string]string `json:"images"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		exported = input.Images["image_1"] == dataURL
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte("test render diagnostic"))
	}))
	defer renderServer.Close()
	t.Setenv("SCENE_SERVICE_URL", renderServer.URL)
	if err := Materialize(context.Background(), root, scene.Asset.File, filepath.Join(root, "video.mp4")); err == nil || !exported {
		t.Fatalf("export lost its images: %v", err)
	}
}
