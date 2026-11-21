package projects

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"
)

func TestAutosavePreservesRawStateWithoutRetainingRequestBody(t *testing.T) {
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	state := []byte(`{"schemaVersion":1, "timeline":{"textItems":[{"text":"  Știință\n<&> țară", "words":[{"text":"Știință","start":0.25,"end":1.5}]}],"documentSession":{"future":"` + strings.Repeat("x", 1<<20) + `"}}, "media":[], "unknown":{"keep":true}}`)
	app := fiber.New(fiber.Config{BodyLimit: MaxStateBytes})
	app.Post("/projects/:projectID", func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice"); return c.Next() }, store.SaveHandler)
	handler := app.Handler()
	var ctx fasthttp.RequestCtx
	ctx.Request.SetRequestURI("/projects/" + project.ID)
	ctx.Request.Header.SetMethod("POST")
	ctx.Request.Header.SetContentType("application/json")
	ctx.Request.SetBodyString(fmt.Sprintf(`{"name":"Film","version":1,"state":%s}`, state))
	handler(&ctx)
	if ctx.Response.StatusCode() != 200 {
		t.Fatalf("save failed: %s", ctx.Response.Body())
	}
	if len(ctx.Request.Body()) != 0 {
		t.Fatal("large autosave buffer retained on an idle request")
	}
	ctx.Request.SetBodyString("request buffer reused")
	saved, err := store.Get("alice", project.ID)
	if err != nil || !bytes.Equal(saved.State, state) {
		t.Fatal("save changed exact state bytes or retained the request buffer", err)
	}
	if summary, err := store.GetSummary("alice", project.ID); err != nil || summary.Version != 2 {
		t.Fatal("streamed save broke bounded summary reads", err)
	}
	for _, invalid := range []json.RawMessage{[]byte(`{"schemaVersion":1,"timeline":`), []byte(`{"schemaVersion":2,"timeline":{}}`), []byte(`{"schemaVersion":1}`)} {
		if _, err := store.Update("alice", project.ID, project.Name, saved.Version, invalid); err == nil {
			t.Fatal("invalid JSON/state accepted")
		}
	}
	reloaded, err := store.Get("alice", project.ID)
	if err != nil || reloaded.Version != saved.Version || !bytes.Equal(reloaded.State, state) {
		t.Fatal("invalid save changed the published snapshot", err)
	}
}

func TestProjectWriterRejectsInvalidStateBeforePublishing(t *testing.T) {
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	path, err := store.path("alice", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	project.State = json.RawMessage(`{}},"injected":true`)
	if err := store.write("alice", project); err == nil {
		t.Fatal("malformed state published")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("failed write changed the original project", err)
	}
}

func TestUpdateResultOwnsItsState(t *testing.T) {
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	state := json.RawMessage(`{"schemaVersion":1,"timeline":{}}`)
	saved, err := store.Update("alice", project.ID, project.Name, project.Version, state)
	if err != nil {
		t.Fatal(err)
	}
	state[0] = '!'
	if !json.Valid(saved.State) {
		t.Fatal("public Update result aliases caller memory")
	}
}

func BenchmarkProjectAutosaveHTTP(b *testing.B) {
	store := testStore(b.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		b.Fatal(err)
	}
	state := `{"schemaVersion":1,"timeline":{"channels":[],"documentSession":{"payload":"` + strings.Repeat("x", 8<<20) + `"}},"media":[]}`
	app := fiber.New(fiber.Config{BodyLimit: MaxStateBytes})
	app.Post("/projects/:projectID", func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice"); return c.Next() }, store.SaveHandler)
	handler := app.Handler()
	var ctx fasthttp.RequestCtx
	b.ReportAllocs()
	b.SetBytes(int64(len(state)))
	for b.Loop() {
		b.StopTimer()
		body := fmt.Sprintf(`{"name":"Film","version":%d,"state":%s}`, project.Version, state)
		ctx.Request.Reset()
		ctx.Response.Reset()
		ctx.Request.SetRequestURI("/projects/" + project.ID)
		ctx.Request.Header.SetMethod("POST")
		ctx.Request.Header.SetContentType("application/json")
		ctx.Request.SetBodyString(body)
		b.StartTimer()
		handler(&ctx)
		b.StopTimer()
		if ctx.Response.StatusCode() != 200 {
			b.Fatalf("save failed: %s", ctx.Response.Body())
		}
		if err := json.Unmarshal(ctx.Response.Body(), &project.Summary); err != nil {
			b.Fatal(err)
		}
		b.StartTimer()
	}
}
