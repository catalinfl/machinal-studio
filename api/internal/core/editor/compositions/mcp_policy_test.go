package compositions

import (
	"context"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/credits"
)

func TestMCPRejectsServerScenesBeforeAnyPaidMediaAction(t *testing.T) {
	input := compiler.Input{Document: document.Document{Version: 2, Mode: "assemble", Before: []document.Job{
		{ID: "paid-image-first", Type: "image.generate", Prompt: "An image"},
		{ID: "server-scene", Type: "scene.generate", Prompt: "An animation"},
	}}}
	ctx := credits.WithWorkflowPolicy(context.Background(), credits.MCPMediaOnly)
	result, err := CompileGenerated(ctx, input, t.TempDir(), "")
	if err == nil || !strings.Contains(err.Error(), "compile_scene") {
		t.Fatal("MCP did not reject server authoring before generation", err)
	}
	if result.Recovery == nil || result.Recovery.Document.Before[0].ResultAssetID != "" {
		t.Fatal("paid image ran before scene rejection or recovery was lost")
	}
}

func TestMCPAllowsMaterializedScenesAndChargesOnlyPendingMedia(t *testing.T) {
	doc := document.Document{Before: []document.Job{{ID: "old", Type: "scene.generate", ResultAssetID: "pinned-scene"}}}
	paid, err := mcpRecipeUsage(doc)
	if err != nil || paid {
		t.Fatal("resolved scene cannot be reused for free", paid, err)
	}
	doc.After = []document.Job{{ID: "captions", Type: "captions.generate"}}
	paid, err = mcpRecipeUsage(doc)
	if err != nil || !paid {
		t.Fatal("new captions were not recognized as paid", paid, err)
	}
	doc.After[0].ResultTextIDs = []string{"actual-caption"}
	paid, err = mcpRecipeUsage(doc)
	if err != nil || paid {
		t.Fatal("resolved captions would be charged again", paid, err)
	}
}

func TestFreeMCPCompletionReportsFinalZeroCost(t *testing.T) {
	cost := completedRenderCost(credits.WithWorkflowPolicy(context.Background(), credits.MCPFree))
	if cost == nil || cost.Status != "final" || cost.KnownCredits != 0 || cost.RenderCredits != 0 || cost.AICredits != 0 {
		t.Fatal("free MCP completion did not report a final zero charge", cost)
	}
}

func TestMCPRequiresExplicitModelBeforeAnyPaidSpeech(t *testing.T) {
	for _, jobs := range []string{"before", "jobs", "after"} {
		doc := document.Document{}
		pending := []document.Job{{ID: "voice", Type: "speech.generate", Text: "Hello world", Language: "en"}}
		switch jobs {
		case "before":
			doc.Before = pending
		case "jobs":
			doc.Jobs = pending
		case "after":
			doc.After = pending
		}
		if _, err := mcpRecipeUsage(doc); err == nil || !strings.Contains(err.Error(), "list_speech_models") {
			t.Fatalf("%s permitted implicit paid model: %v", jobs, err)
		}
		pending[0].Model = "google/gemini-3.8-flash-tts"
		if paid, err := mcpRecipeUsage(doc); err != nil || !paid {
			t.Fatalf("%s rejected explicit model: %v, %v", jobs, paid, err)
		}
		pending[0].Model = ""
		pending[0].ResultAssetID = "existing-approved-voice"
		if paid, err := mcpRecipeUsage(doc); err != nil || paid {
			t.Fatalf("%s cannot reuse resolved legacy speech: %v, %v", jobs, paid, err)
		}
	}
}
