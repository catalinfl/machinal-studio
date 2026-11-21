package jobqueue

import (
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func TestInlineCompilationHasDurableFreeReceiptsWithoutQueueAccess(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	calls := 0
	task := func(ctx context.Context, job Job) Result {
		calls++
		if credits.WorkflowPolicyFromContext(ctx) != credits.MCPFree || ID(ctx) == "" || job.Input.Billed {
			t.Error("inline compilation was not free and identified")
		}
		return Result{StatusCode: 200, ContentType: "application/json", Body: json.RawMessage(`{"file":"compiled.scene.json","cost":{"knownCredits":0}}`)}
	}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice"); return c.Next() })
	app.Post("/compile", func(c *fiber.Ctx) error { return InlineCompile(c, task) })
	submit := func(body string) (int, string) {
		request := httptest.NewRequest("POST", "/compile", strings.NewReader(body))
		request.Header.Set("X-Session-Id", "u_alice")
		request.Header.Set("Idempotency-Key", "one-source")
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, string(data)
	}
	status, first := submit(`{"component":"source"}`)
	if status != 200 {
		t.Fatal(status, first)
	}
	status, second := submit(`{"component":"source"}`)
	if status != 200 || second != first || calls != 1 {
		t.Fatal("inline retry did work again", status, calls, second)
	}
	status, _ = submit(`{"component":"changed source"}`)
	if status != 409 || calls != 1 {
		t.Fatal("changed source reused a receipt", status, calls)
	}
}
