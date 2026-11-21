package mcpserver

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestTikTokCaptionFontReachesMCPEntryPoints(t *testing.T) {
	handler := briefHandler(t)
	assertTikTokCaptionFontGuidance(t, workflowPolicy(t, handler))
	for _, uri := range []string{"machinal://recipes/guide", "machinal://skills/editing"} {
		t.Run(uri, func(t *testing.T) {
			_, envelope := rpc(t, handler, "resources/read", map[string]any{"uri": uri})
			var resource mcp.ReadResourceResult
			if err := json.Unmarshal(envelope["result"], &resource); err != nil {
				t.Fatal(err)
			}
			if len(resource.Contents) != 1 {
				t.Fatal("missing caption font guide")
			}
			if uri == "machinal://skills/editing" {
				assertTikTokCaptionFontGuidance(t, clientAuthoringGuide(t, "editing"))
			} else {
				assertTikTokCaptionFontGuidance(t, clientPolicyFixture("recipe-workflow.md"))
			}
		})
	}
}

func TestTikTokCaptionFontGuidanceInReferences(t *testing.T) {
	for _, topic := range []string{"brief", "text", "fonts", "audio", "styles"} {
		t.Run(topic, func(t *testing.T) {
			reference, err := clientAuthoringReference(referenceInput{Topic: topic}, nil)
			if err != nil {
				t.Fatal(err)
			}
			assertTikTokCaptionFontGuidance(t, reference.Guide)
		})
	}
}

func TestTikTokCaptionFontMatchesDeployedPresets(t *testing.T) {
	entries := referenceFixture(t)
	font, err := clientAuthoringReference(referenceInput{Topic: "fonts", ID: "montserrat"}, entries)
	if err != nil || len(font.Entries) != 1 {
		t.Fatalf("TikTok caption font must be registered: %+v, %v", font, err)
	}
	for _, id := range []string{"tiktok-pop", "tiktok-box", "tiktok-glow"} {
		t.Run(id, func(t *testing.T) {
			preset, err := clientAuthoringReference(referenceInput{Topic: "text", ID: id}, entries)
			if err != nil || len(preset.Entries) != 1 {
				t.Fatalf("TikTok preset unavailable: %+v, %v", preset, err)
			}
			var entry struct {
				Values struct {
					FontFamily string `json:"fontFamily"`
					FontWeight int    `json:"fontWeight"`
				} `json:"values"`
			}
			if err := json.Unmarshal(preset.Entries[0], &entry); err != nil {
				t.Fatal(err)
			}
			if entry.Values.FontFamily != "montserrat" || entry.Values.FontWeight != 700 {
				t.Fatalf("TikTok guidance no longer matches preset font: %+v", entry.Values)
			}
		})
	}
}

func assertTikTokCaptionFontGuidance(t *testing.T, content string) {
	t.Helper()
	for _, guidance := range []string{
		"TikTok", "NEW captions", "fontFamily: montserrat", "fontWeight: 700",
		"unless the user explicitly chooses another font", "existing caption fonts/configuration",
		"font change", "TikTok Sans",
	} {
		if !strings.Contains(content, guidance) {
			t.Errorf("missing TikTok caption font guidance %q", guidance)
		}
	}
}
