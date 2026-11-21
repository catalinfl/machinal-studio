package objectstore

import (
	"bytes"
	"context"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestInternalTransfersAndPublicDownloadsUseDifferentSignedHosts(t *testing.T) {
	_, server := newFakeS3()
	defer server.Close()
	client := New(Config{Endpoint: server.URL, PublicEndpoint: "https://public.example", Region: "auto", Bucket: "bucket", AccessKey: "key", SecretKey: "secret"})
	payload := []byte("render bytes")
	key := RenderKey("p_project", "render_test.mp4")
	if err := client.Put(context.Background(), key, bytes.NewReader(payload), int64(len(payload)), "video/mp4"); err != nil {
		t.Fatal(err)
	}
	body, _, _, err := client.Get(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	if err := body.Close(); err != nil {
		t.Fatal(err)
	}
	internal, err := client.PresignGet(key, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	public, err := client.PresignDownload(key, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(internal, server.URL+"/") || !strings.HasPrefix(public, "https://public.example/") {
		t.Fatal("internal/public endpoint selection failed")
	}
	i, _ := url.Parse(internal)
	p, _ := url.Parse(public)
	if i.Query().Get("X-Amz-Signature") == p.Query().Get("X-Amz-Signature") {
		t.Fatal("public host must be signed, not rewritten after signing")
	}
	if p.Query().Get("X-Amz-Expires") != "900" {
		t.Fatal("wrong signed download expiration")
	}
}

func TestFromEnvKeepsPublicAndInternalEndpointsSeparate(t *testing.T) {
	t.Setenv("S3_ENDPOINT", "https://public.example/")
	t.Setenv("S3_INTERNAL_ENDPOINT", "http://s3.private:9000/")
	config := FromEnv()
	if config.Endpoint != "http://s3.private:9000" || config.PublicEndpoint != "https://public.example" {
		t.Fatal(config.Endpoint, config.PublicEndpoint)
	}
	t.Setenv("S3_INTERNAL_ENDPOINT", "")
	config = FromEnv()
	if config.Endpoint != config.PublicEndpoint {
		t.Fatal("legacy single-endpoint configuration changed")
	}
}
