package objectstore

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestPublishFileAcknowledgesOnlyStoredBytes(t *testing.T) {
	fake, server := newFakeS3()
	defer server.Close()
	client := testClient(t, fake, server)
	path := filepath.Join(t.TempDir(), "source.mp4")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := client.PublishFile(context.Background(), path, "project/source.mp4"); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	stored := string(fake.objects["project/source.mp4"])
	fake.mu.Unlock()
	if stored != "original" {
		t.Fatal("publication returned before the original was stored")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := client.PublishFile(ctx, path, "project/canceled.mp4"); err == nil {
		t.Fatal("canceled storage upload was acknowledged")
	}
}
