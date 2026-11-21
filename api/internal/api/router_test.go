package api

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"testing"
	"time"

	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/platform/mcpserver"

	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"
)

func TestUploadRequestConfig(t *testing.T) {
	tests := []struct {
		name, method, uri string
		wantTimeout       time.Duration
	}{
		{"upload", "POST", "/upload", uploadReadTimeout},
		{"upload with session", "POST", "/upload?session=u_user123", uploadReadTimeout},
		{"other route", "POST", "/render", 0},
		{"similar path", "POST", "/upload-other", 0},
		{"different method", "GET", "/upload", 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var header fasthttp.RequestHeader
			header.SetMethod(tt.method)
			header.SetRequestURI(tt.uri)
			config := uploadRequestConfig(&header)
			if config.ReadTimeout != tt.wantTimeout {
				t.Fatalf("read timeout = %s, want %s", config.ReadTimeout, tt.wantTimeout)
			}
			wantBody := jobqueue.MaxInputBytes
			if tt.wantTimeout == uploadReadTimeout {
				wantBody = 0
			}
			if config.MaxRequestBodySize != wantBody || config.WriteTimeout != 0 {
				t.Fatalf("other request limits changed: %+v", config)
			}
		})
	}
}

func TestSlowUploadSurvivesOrdinaryReadTimeout(t *testing.T) {
	app := fiber.New(fiber.Config{ReadTimeout: 50 * time.Millisecond})
	app.Post("/upload", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return err
		}
		return c.SendString(file.Filename)
	})
	app.Server().HeaderReceived = uploadRequestConfig
	app.Handler()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- app.Server().Serve(listener) }()
	t.Cleanup(func() {
		if err := app.ShutdownWithTimeout(time.Second); err != nil {
			t.Errorf("shut down server: %v", err)
		}
		if err := <-serveDone; err != nil {
			t.Errorf("serve upload: %v", err)
		}
	})

	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, err := form.CreateFormFile("file", "slow.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("video data")); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}

	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := fmt.Fprintf(conn, "POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Type: %s\r\nContent-Length: %d\r\nConnection: close\r\n\r\n", form.FormDataContentType(), body.Len()); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write(body.Bytes()[:16]); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	if _, err := conn.Write(body.Bytes()[16:]); err != nil {
		t.Fatal(err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	message, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || string(message) != "slow.mp4" {
		t.Fatalf("slow upload response = %d %q, want 200 slow.mp4", response.StatusCode, message)
	}
}

func TestMCPRequestBodyIsBoundedBeforeBuffering(t *testing.T) {
	for _, method := range []string{"POST", "GET", "DELETE"} {
		for _, path := range []string{"/mcp", "/MCP/", "/mcp///"} {
			var header fasthttp.RequestHeader
			header.SetMethod(method)
			header.SetRequestURI(path + "?ignored=true")
			config := uploadRequestConfig(&header)
			if config.MaxRequestBodySize != mcpserver.MaxRequestBytes || config.ReadTimeout != 0 {
				t.Fatalf("MCP request config: %+v", config)
			}
		}
	}
}

func TestBillingTransportHasSmallBoundsAndValidatesProxyNetworks(t *testing.T) {
	for _, item := range []struct {
		path  string
		limit int
	}{
		{"/billing/paypal/orders", 4096}, {"/BILLING/PAYPAL/WEBHOOK/", 1 << 20},
	} {
		var header fasthttp.RequestHeader
		header.SetMethod("POST")
		header.SetRequestURI(item.path)
		if config := uploadRequestConfig(&header); config.MaxRequestBodySize != item.limit {
			t.Fatal(item.path, config)
		}
	}
	if values, err := trustedProxies(""); err != nil || len(values) != 0 {
		t.Fatal(values, err)
	}
	if values, err := trustedProxies("127.0.0.1,10.0.0.0/24"); err != nil || len(values) != 2 {
		t.Fatal(values, err)
	}
	if _, err := trustedProxies("*"); err == nil {
		t.Fatal("wildcard proxy trusted")
	}
	for _, network := range []string{"0.0.0.0/0", "::/0"} {
		if _, err := trustedProxies(network); err == nil {
			t.Fatal("universal proxy network trusted", network)
		}
	}
}

func TestMCPTransportRejectsOversizedContentLengthWithoutReadingBody(t *testing.T) {
	app := fiber.New(fiber.Config{BodyLimit: 2 * mcpserver.MaxRequestBytes})
	app.Post("/mcp", func(*fiber.Ctx) error {
		t.Error("oversized body reached MCP handler")
		return nil
	})
	app.Server().HeaderReceived = uploadRequestConfig
	app.Handler()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- app.Server().Serve(listener) }()
	t.Cleanup(func() {
		if err := app.ShutdownWithTimeout(time.Second); err != nil {
			t.Error(err)
		}
		if err := <-done; err != nil {
			t.Error(err)
		}
	})
	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := fmt.Fprintf(conn, "POST /MCP/ HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n", mcpserver.MaxRequestBytes+1); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatal("transport body limit was not enforced", response.StatusCode)
	}
}
