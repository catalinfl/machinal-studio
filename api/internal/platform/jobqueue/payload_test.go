package jobqueue

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/storage"
)

func payloadFixture(t *testing.T, id string, body []byte) Input {
	t.Helper()
	if err := savePayload(id, body); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(body)
	return Input{Payload: id, Digest: hex.EncodeToString(digest[:])}
}

func TestLargePayloadStaysOutsidePocketBaseAndRequiresItsChecksum(t *testing.T) {
	old := storage.DataDir
	storage.DataDir = t.TempDir()
	defer func() { storage.DataDir = old }()
	body := bytes.Repeat([]byte("A"), (8<<20)+1)
	input := payloadFixture(t, strings.Repeat("a", 32), body)
	metadata, err := json.Marshal(input)
	if err != nil || len(metadata) > 1024 {
		t.Fatal("large request was embedded in PocketBase metadata", len(metadata), err)
	}
	got, err := loadPayload(input)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatal("large saved/prepared-text input was not preserved", err)
	}
	input.Digest = strings.Repeat("0", 64)
	if _, err := loadPayload(input); err == nil {
		t.Fatal("damaged input accepted")
	}
	input.Payload = "../credits.db"
	if _, err := loadPayload(input); err == nil {
		t.Fatal("payload traversal accepted")
	}
}

func TestCleanupPreservesActiveInputsAndReclaimsOnlyOldUnreferencedFiles(t *testing.T) {
	old := storage.DataDir
	storage.DataDir = t.TempDir()
	defer func() { storage.DataDir = old }()
	active, orphan, recent := strings.Repeat("a", 32), strings.Repeat("b", 32), strings.Repeat("c", 32)
	for _, id := range []string{active, orphan, recent} {
		payloadFixture(t, id, []byte("saved body"))
		if id != recent {
			past := time.Now().Add(-2 * orphanPayloadAge)
			if err := os.Chtimes(filepath.Join(payloadDirectory(), id), past, past); err != nil {
				t.Fatal(err)
			}
		}
	}
	cleanPayloads([]Job{{ID: active}})
	for _, id := range []string{active, recent} {
		if _, err := os.Stat(filepath.Join(payloadDirectory(), id)); err != nil {
			t.Fatalf("needed input %s removed: %v", id, err)
		}
	}
	if _, err := os.Stat(filepath.Join(payloadDirectory(), orphan)); !os.IsNotExist(err) {
		t.Fatal("old orphan was not reclaimed", err)
	}
}
