package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/core/editor/compositions"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func briefHandler(t *testing.T) http.Handler {
	t.Helper()
	return NewHandler(func(context.Context, http.Header, Request) (Response, error) {
		t.Fatal("brief discovery must not access customer media or call providers")
		return Response{}, nil
	})
}

func TestInitializationStartsWithCollaborativeVideoBrief(t *testing.T) {
	_, envelope := rpc(t, briefHandler(t), "initialize", map[string]any{
		"protocolVersion": "2025-11-25", "capabilities": map[string]any{},
		"clientInfo": map[string]any{"name": "test", "version": "1"},
	})
	var initialized mcp.InitializeResult
	if err := json.Unmarshal(envelope["result"], &initialized); err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{
		"get_editing_reference(topic=brief)", "3–5 short questions", "output resolution",
		"wait for the user's reply", "do not re-ask answered questions", "'you decide'",
		"animated scene", "spending authorization", "Do not put AI-production labels",
		"never present generated media as archival footage or verified evidence",
		"native question tool (OpenCode: question)", "one questions array",
		"not a numbered chat questionnaire", "After the user answers",
		"proceed immediately", "same turn", "Do not ask for a separate plan confirmation",
		"same form", "cancelled form is not consent", "tool-approval controls enabled",
	} {
		if !strings.Contains(initialized.Instructions, content) {
			t.Errorf("initialization lacks brief guidance: %s", content)
		}
	}
}

func TestBriefGuideIsDiscoverableAsToolTopicAndResource(t *testing.T) {
	handler := briefHandler(t)
	_, envelope := rpc(t, handler, "tools/list", map[string]any{})
	var catalog mcp.ListToolsResult
	if err := json.Unmarshal(envelope["result"], &catalog); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tool := range catalog.Tools {
		if tool.Name == "get_editing_reference" {
			found = strings.Contains(tool.Description, "topic=brief")
			for _, content := range []string{"native question tool", "one form", "proceed immediately", "without a separate plan confirmation"} {
				if !strings.Contains(tool.Description, content) {
					t.Errorf("reference tool lacks interaction guidance: %s", content)
				}
			}
		}
	}
	if !found {
		t.Fatal("reference tool does not advertise the video brief")
	}
	result, output := callTool(t, handler, "get_editing_reference", map[string]any{"topic": "brief"})
	if result.IsError || output.StatusCode != http.StatusOK {
		t.Fatal("brief topic unavailable", result, output)
	}
	data := output.Data.(map[string]any)
	guide := data["guide"].(string)
	for _, content := range []string{
		"3–5 short", "Video type", "Duration", "output resolution", "Aspect ratio is not resolution",
		"Audio and text", "wait for the user's reply", "Do not re-ask answered questions",
		"you decide", "1–2 relevant alternatives", "animated scene", "newly generated image",
		"Do not automatically add production labels", "archival footage", "not media-access or provider-spending authorization",
		"native question tool", "one `questions` array", "not a numbered chat questionnaire",
		"After the user answers", "proceed immediately", "same turn", "Do not ask for a separate plan confirmation",
		"separate explicit questions in the same form", "clear refusal option", "no machinal credit wallet locally",
		"their own OpenRouter account",
		"cancelled form is not consent", "host has no interactive question tool",
	} {
		if !strings.Contains(guide, content) {
			t.Errorf("brief guide lacks %s", content)
		}
	}
	if strings.Contains(guide, "check live credits") {
		t.Fatal("local brief must not require a hosted credit balance")
	}
	_, envelope = rpc(t, handler, "resources/read", map[string]any{"uri": data["guideUri"]})
	var resource mcp.ReadResourceResult
	if err := json.Unmarshal(envelope["result"], &resource); err != nil {
		t.Fatal(err)
	}
	if len(resource.Contents) != 1 || resource.Contents[0].Text != guide {
		t.Fatal("brief tool topic and resource diverged")
	}
}

func TestEditingEntryPointsLinkToBriefBeforeAuthoring(t *testing.T) {
	handler := briefHandler(t)
	for _, uri := range []string{
		"machinal://recipes/guide", "machinal://skills/editing",
		"machinal://reference/overview", "machinal://skills/scenes",
	} {
		t.Run(uri, func(t *testing.T) {
			_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": uri})
			var resource mcp.ReadResourceResult
			if err := json.Unmarshal(envelope["result"], &resource); err != nil {
				t.Fatal(err)
			}
			if len(resource.Contents) != 1 {
				t.Fatal("missing editing resource")
			}
			for _, content := range []string{
				"get_editing_reference(topic=brief)", "output resolution", "Do not automatically add production labels",
				"native question tool", "not a numbered chat questionnaire", "After the user answers",
				"proceed immediately", "same turn", "separate plan confirmation", "cancelled form",
			} {
				if !strings.Contains(resource.Contents[0].Text, content) {
					t.Errorf("%s lacks %s", uri, content)
				}
			}
		})
	}
}

func TestNarratedExampleUsesSubjectHeadingWithoutDefaultProductionLabel(t *testing.T) {
	source, err := bundledGuides.ReadFile("reference/examples/narrated-documentary.yaml")
	if err != nil {
		t.Fatal(err)
	}
	input, _, err := compositions.ParseProject(source)
	if err != nil {
		t.Fatal(err)
	}
	headings := 0
	for _, text := range input.Document.Texts {
		if text.IsCaption {
			continue
		}
		headings++
		if text.Text != "Copilăria la Ipotești" {
			t.Errorf("unexpected non-caption copy: %s", text.Text)
		}
	}
	if headings != 1 {
		t.Fatal("narrated example should demonstrate a subject-relevant chapter heading")
	}
	for _, label := range []string{"Ilustrație artistică AI", "Narațiune sintetică", "reconstruction-disclosure"} {
		if strings.Contains(string(source), label) {
			t.Errorf("example imposes a production label: %s", label)
		}
	}
}
