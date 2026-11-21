package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/internal/core/editor/compositions"
	"ffmpeg-go-server/internal/platform/jobqueue"
)

const generationFixture = `{"id":"0123456789abcdef0123456789abcdef","status":"completed","statusCode":200,"result":{"document":{"version":2,"mode":"assemble","tracks":[],"texts":[{"id":"titlu","text":"Știință și creație","start":0,"duration":3}]},"composition":{"assets":[]},"diagnostics":[],"requirements":[],"summary":"Complete"}}`

func TestJobResultReturnsReusableUnicodeYAMLWithoutDuplicateComposition(t *testing.T) {
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		if request.Path != "/v1/projects/owned/jobs/"+testJobID+"?view=result" {
			t.Fatal(request.Path)
		}
		var job jobqueue.Job
		if err := json.Unmarshal([]byte(generationFixture), &job); err != nil {
			t.Fatal(err)
		}
		body, err := json.Marshal(job.View())
		if err != nil {
			t.Fatal(err)
		}
		return Response{StatusCode: 200, Body: body}, nil
	})
	result, output := callTool(t, handler, "get_job_result", map[string]any{"projectId": "owned", "jobId": testJobID})
	if result.IsError {
		t.Fatal(result)
	}
	data := output.Data.(map[string]any)
	recipe, _ := data["recipeYaml"].(string)
	input, _, err := compositions.ParseProject([]byte(recipe))
	if err != nil || input.Document.Texts[0].Text != "Știință și creație" {
		t.Fatalf("resolved YAML changed Unicode or cannot be parsed: %s, %v", recipe, err)
	}
	for _, key := range []string{"result", "document", "bindings", "composition", "recovery"} {
		if _, exists := data[key]; exists {
			t.Fatal("full result duplicated alongside YAML", key)
		}
	}
}

func TestRenderContinuesAnOwnedJobWithoutResendingTheRecipe(t *testing.T) {
	calls := 0
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		calls++
		if request.Method == http.MethodGet {
			return Response{StatusCode: 200, Body: []byte(generationFixture)}, nil
		}
		if request.Path != "/v1/projects/owned/renders" || request.ContentType != "application/yaml" || request.IdempotencyKey != "continue-1" {
			t.Fatalf("wrong continuation: %+v", request)
		}
		if _, _, err := compositions.ParseProject(request.Body); err != nil {
			t.Fatal(err)
		}
		return Response{StatusCode: 202, Body: []byte(`{"status":"queued"}`)}, nil
	})
	result, _ := callTool(t, handler, "render_video", map[string]any{"projectId": "owned", "sourceJobId": testJobID, "idempotencyKey": "continue-1", "userApproved": false})
	if !result.IsError || calls != 0 {
		t.Fatal("continuation accessed sources or spent without approval")
	}
	result, _ = callTool(t, handler, "render_video", map[string]any{"projectId": "owned", "sourceJobId": testJobID, "idempotencyKey": "continue-1", "userApproved": true})
	if result.IsError || calls != 2 {
		t.Fatal(result, calls)
	}
}

func TestJobStatusSupportsBoundedServerWaitAndLegacyFullResult(t *testing.T) {
	path, err := jobStatusPath(jobStatusInput{jobInput: jobInput{ProjectID: "owned", JobID: testJobID}, WaitSeconds: 25, AfterRevision: 7})
	if err != nil || !strings.Contains(path, "afterRevision=7&view=summary&wait=25") {
		t.Fatal(path, err)
	}
	_, err = jobStatusPath(jobStatusInput{jobInput: jobInput{ProjectID: "owned", JobID: testJobID}, WaitSeconds: 26})
	if err == nil {
		t.Fatal("accepted unbounded wait")
	}
	var data any
	if err := json.Unmarshal([]byte(generationFixture), &data); err != nil {
		t.Fatal(err)
	}
	data.(map[string]any)["status"] = "running"
	if _, err := resolvedRecipe(data); err == nil {
		t.Fatal("continued unfinished work")
	}
}

func TestResolvedSequenceRecipeRetainsBindingsAndCompilesIdentically(t *testing.T) {
	input, _, err := compositions.ParseProject([]byte(`document:
  version: 2
  mode: assemble
  inputs:
    shots: {kind: video, multiple: true}
  sequence:
    use: shots
    each:
      take: {from: 0, duration: 3}
bindings:
  shots: [shot]
assets:
  - id: shot
    file: shot.mp4
    version: fixture-v1
    kind: video
    duration: 10
    width: 1920
    height: 1080
`))
	if err != nil {
		t.Fatal(err)
	}
	first := compiler.New().Compile(input)
	if first.Composition == nil {
		t.Fatalf("initial compilation: %+v", first)
	}
	encoded, err := json.Marshal(map[string]any{"status": "completed", "result": first})
	if err != nil {
		t.Fatal(err)
	}
	var data any
	if err := json.Unmarshal(encoded, &data); err != nil {
		t.Fatal(err)
	}
	recipe, err := resolvedRecipe(data)
	if err != nil {
		t.Fatal(err)
	}
	replayed, _, err := compositions.ParseProject([]byte(recipe))
	if err != nil {
		t.Fatal(err)
	}
	second := compiler.New().Compile(replayed)
	if second.Composition == nil || second.Composition.ID != first.Composition.ID {
		t.Fatalf("resolved YAML lost sequence bindings: %+v\n%s", second, recipe)
	}
}
