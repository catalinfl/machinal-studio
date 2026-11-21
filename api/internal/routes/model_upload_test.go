package routes

import (
	"bytes"
	"encoding/binary"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/scenecontract"
	"ffmpeg-go-server/internal/platform/storage"
)

func uploadModelFixture(metadata string) []byte {
	metadata += strings.Repeat(" ", (4-len(metadata)%4)%4)
	data := make([]byte, 32+len(metadata))
	for offset, value := range map[int]uint32{0: 0x46546c67, 4: 2, 8: uint32(len(data)), 12: uint32(len(metadata)), 16: 0x4e4f534a, 20 + len(metadata): 4, 24 + len(metadata): 0x004e4942} {
		binary.LittleEndian.PutUint32(data[offset:offset+4], value)
	}
	copy(data[20:], metadata)
	return data
}

func TestAPIModelUploadsAreOwnedBoundedVolumeOnlyAndContentValidated(t *testing.T) {
	fixture := newMCPFixture(t)
	valid := uploadModelFixture(`{"asset":{"version":"2.0"},"buffers":[{"byteLength":4}]}`)
	root := filepath.Join(storage.DataDir, fixture.project.SessionID)
	for _, test := range []struct {
		name, key string
		data      []byte
		status    int
	}{
		{"foreign.glb", mcpBobKey, valid, 404},
		{"invalid.glb", mcpAliceKey, []byte("not a GLB"), 415},
		{"external.glb", mcpAliceKey, uploadModelFixture(`{"asset":{"version":"2.0"},"buffers":[{"uri":"https://example.invalid/model.bin"}]}`), 415},
		{"animated.glb", mcpAliceKey, uploadModelFixture(`{"asset":{"version":"2.0"},"animations":[{}]}`), 415},
		{"oversized.glb", mcpAliceKey, make([]byte, scenecontract.MaxModelBytes+1), 413},
		{"approved.GLB", mcpAliceKey, valid, 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("file", test.name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(test.data); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/v1/projects/"+fixture.project.ID+"/upload", &body)
			request.Header.Set("Authorization", "Bearer "+test.key)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			response, err := fixture.app.Test(request, 10000)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			result, err := io.ReadAll(response.Body)
			if err != nil || response.StatusCode != test.status {
				t.Fatal(response.StatusCode, string(result), err)
			}
			stored, err := os.ReadFile(filepath.Join(root, test.name))
			if test.status == 200 {
				if err != nil || !bytes.Equal(stored, valid) || !strings.Contains(string(result), `"storage":"volume"`) {
					t.Fatal("model lost bytes/storage scope", err, string(result))
				}
			} else if !os.IsNotExist(err) {
				t.Fatal("rejected upload persisted", err)
			}
		})
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".upload-") {
			t.Fatal("rejected model left staged bytes", entry.Name())
		}
	}
}
