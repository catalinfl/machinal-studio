package mcpserver

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestRecipeRefCarriesEditedRevisionFromValidationToRender(t *testing.T) {
	const source = "document:\n  version: 2\n"
	calls := 0
	handler := NewHandler(func(_ context.Context, _ http.Header, req Request) (Response, error) {
		calls++
		if string(req.Body) != source {
			t.Fatal("changed YAML", req)
		}
		return Response{StatusCode: 200, Body: []byte(`{}`)}, nil
	})
	_, out := callTool(t, handler, "validate_recipe", map[string]any{"projectId": "owned", "composition": strings.ReplaceAll(source, "\n", "\r\n")})
	ref := out.Data.(map[string]any)["recipeRef"]
	if ref != compositionVersion(source) {
		t.Fatal(out)
	}
	for _, name := range []string{"compile_recipe", "render_video"} {
		input := map[string]any{"projectId": "owned", "recipeRef": ref}
		if name == "render_video" {
			input["userApproved"] = true
			input["idempotencyKey"] = "once"
			input["expectedCompositionVersion"] = ref
		}
		result, _ := callTool(t, handler, name, input)
		if result.IsError {
			t.Fatal(result)
		}
	}
	for _, input := range []map[string]any{{"projectId": "other", "recipeRef": ref}, {"projectId": "owned", "recipeRef": ref, "composition": source}} {
		result, _ := callTool(t, handler, "compile_recipe", input)
		if !result.IsError {
			t.Fatal("accepted invalid reference", input)
		}
	}
	if calls != 3 {
		t.Fatal(calls)
	}
}

func TestFullTrackGradeCoversBeatButNotAnotherTrackOrShorterInterval(t *testing.T) {
	plan, contract := contractFixture("recipe")
	contract.Beats[0].Treatments = []productionTreatment{{Kind: "effect", Preset: "vignette", Start: 1, Duration: 3}}
	plan.Effects = []document.EffectBlock{{TrackID: "main", Preset: "vignette", Duration: document.Seconds(64)}}
	if r := productionOutput(t, "recipe", plan, &contract); r.TotalFindings != 0 {
		t.Fatal(r)
	}
	for _, e := range []document.EffectBlock{
		{TrackID: "other", Preset: "vignette", Duration: document.Seconds(64)},
		{TrackID: "main", Preset: "vignette", Duration: document.Seconds(3.999999)},
		{TrackID: "main", OwnerClipID: "other", Preset: "vignette", Duration: document.Seconds(64)},
	} {
		plan.Effects[0] = e
		if r := productionOutput(t, "recipe", plan, &contract); r.Status != "revision_required" {
			t.Fatal(r)
		}
	}
}

func TestDialogueReviewUsesCompiledPlacementAndCaptionTimes(t *testing.T) {
	doc := document.Document{}
	track := document.Track{Type: "audio"}
	caps := document.Job{Type: "captions.generate", Language: "ro"}
	for i, word := range []string{"Boierul", "spune", "Ștefan", "răspunde"} {
		at := document.Seconds(float64(i))
		track.Clips = append(track.Clips, document.Clip{AssetID: word, Start: at, OutPoint: document.Seconds(1), PlaybackRate: 1, Volume: 100})
		doc.Jobs = append([]document.Job{{Type: "speech.generate", Language: "ro", ResultAssetID: word, Text: word}}, doc.Jobs...)
		doc.Texts = append(doc.Texts, document.TextItem{ID: word, Start: at, Text: word, IsCaption: true})
		caps.ResultTextIDs = append([]string{word}, caps.ResultTextIDs...)
	}
	doc.After = []document.Job{caps}
	plan := dialogueTimeline{Tracks: []document.Track{track}}
	if r := reviewCaptionContent(doc, plan); r["status"] != "matched" {
		t.Fatal(r)
	}
	doc.Texts[2].Text = "Petru"
	if r := reviewCaptionContent(doc, plan); r["status"] != "review_required" || r["differences"].([]map[string]string)[0]["captionId"] != "Ștefan" {
		t.Fatal(r)
	}
	track.Clips[2].Start = track.Clips[1].Start
	if r := reviewCaptionContent(doc, plan); r["status"] != "not_checked" {
		t.Fatal(r)
	}
}
