package mcpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/compositions"
)

func editorialClip(id string, start, duration float64) document.Clip {
	return document.Clip{ID: id, AssetID: id, Start: document.Seconds(start), OutPoint: document.Seconds(duration), PlaybackRate: 1, Opacity: 1}
}

func TestEditorialReviewDistinguishesCutsTransitionsImplicitDissolvesAndGaps(t *testing.T) {
	plan := composition.Composition{Tracks: []document.Track{{ID: "main", Type: "video", Clips: []document.Clip{
		editorialClip("e", 9, 1), editorialClip("a", 0, 3), editorialClip("b", 3, 3),
		editorialClip("c", 5.5, 2), editorialClip("d", 7.25, 1),
	}}}, Transitions: []document.Transition{{TrackID: "main", LeftClipID: "b", RightClipID: "c", Preset: "wipe-left", Duration: document.Seconds(0.5)}}}
	original := slices.Clone(plan.Tracks[0].Clips)
	review := reviewEditorialPlan(plan)
	if review.Status != "review_required" || review.VisualInspection || review.VisualClips != 5 {
		t.Fatalf("inventory was treated as visual approval: %+v", review)
	}
	for index, want := range []struct {
		kind, preset    string
		start, duration float64
	}{
		{"cut", "", 3, 0}, {"transition", "wipe-left", 5.5, 0.5},
		{"implicit-transition", "cross-dissolve", 7.25, 0.25}, {"gap", "", 8.25, 0.75},
	} {
		got := review.Junctions[index]
		if got.Kind != want.kind || got.Preset != want.preset || got.Start != want.start || got.Duration != want.duration {
			t.Errorf("junction %d = %+v, want %+v", index, got, want)
		}
	}
	if !reflect.DeepEqual(original, plan.Tracks[0].Clips) {
		t.Fatal("review mutated the normalized timeline")
	}
}

func TestEditorialReviewExcludesHiddenTracksAudioAndInvisibleClipEffects(t *testing.T) {
	visible := editorialClip("subject", 0, 3)
	visible.Look, visible.Motion = "fine-film", "slow-push"
	invisible := editorialClip("invisible", 3, 3)
	invisible.Opacity = 0
	plan := composition.Composition{Tracks: []document.Track{
		{ID: "main", Type: "video", Clips: []document.Clip{visible, invisible}},
		{ID: "hidden", Type: "video", Hidden: true, Clips: []document.Clip{editorialClip("hidden", 0, 4)}},
		{ID: "voice", Type: "audio", Clips: []document.Clip{editorialClip("voice", 0, 4)}},
	}, Effects: []document.EffectBlock{
		{ID: "grain", TrackID: "main", OwnerClipID: visible.ID, Preset: "film-grain", Duration: document.Seconds(3), Provenance: &document.Provenance{Rule: "look:fine-film"}},
		{ID: "hidden-glow", TrackID: "hidden", Preset: "glow"},
		{ID: "invisible-glow", TrackID: "main", OwnerClipID: invisible.ID, Preset: "glow"},
	}}
	review := reviewEditorialPlan(plan)
	if review.VisualClips != 1 || len(review.Junctions) != 0 || len(review.Treatments) != 3 || len(review.Notices) != 0 {
		t.Fatalf("nonvisual tracks/clips contaminated the report: %+v", review)
	}
	if review.Treatments[2].Origin != "look:fine-film" || review.Treatments[2].ClipID != visible.ID {
		t.Fatal("expanded look effect lost provenance/target", review.Treatments)
	}
}

func TestEditorialReviewNoticesAreAdvisoryAndDoNotDemandEffects(t *testing.T) {
	plan := composition.Composition{Tracks: []document.Track{{ID: "main", Type: "video", Clips: []document.Clip{
		editorialClip("a", 0, 2), editorialClip("b", 2, 2),
	}}}}
	review := reviewEditorialPlan(plan)
	if len(review.Notices) != 2 {
		t.Fatal("missing omission prompts", review.Notices)
	}
	for _, notice := range review.Notices {
		if notice.Severity != "info" {
			t.Fatal("aesthetic preference became a validation error", notice)
		}
	}
	if !strings.Contains(review.Limitations, "Scene-internal") || !strings.Contains(review.Limitations, "not aesthetic approval") {
		t.Fatal("evidence boundary is missing", review.Limitations)
	}
}

func TestCompileRecipeAddsEditorialEvidenceWithoutAnotherAPICall(t *testing.T) {
	requireClientLibrary(t)
	source, err := clientReferenceFixtures.ReadFile("reference/examples/cinematic-sequence.yaml")
	if err != nil {
		t.Fatal(err)
	}
	input, _, err := compositions.ParseProject(source)
	if err != nil {
		t.Fatal(err)
	}
	compiled := compiler.New().Compile(input)
	if compositions.HasErrors(compiled) || compiled.Composition == nil {
		t.Fatal("fixture did not compile", compiled)
	}
	body, err := json.Marshal(compiled)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		calls++
		if request.Path != "/v1/projects/owned/compositions/compile" || string(request.Body) != string(source) {
			t.Fatal("review changed the compilation request", request.Path)
		}
		return Response{StatusCode: http.StatusOK, Body: body}, nil
	})
	result, output := callTool(t, handler, "compile_recipe", map[string]any{"projectId": "owned", "composition": string(source), "fullResult": true})
	if result.IsError || calls != 1 {
		t.Fatal("review caused another API/provider action", result, calls)
	}
	fields := output.Data.(map[string]any)
	encoded, err := json.Marshal(fields["editorialReview"])
	if err != nil {
		t.Fatal(err)
	}
	var review editorialReview
	if err := json.Unmarshal(encoded, &review); err != nil {
		t.Fatal(err)
	}
	if review.Status != "review_required" || len(review.Junctions) != 1 || review.Junctions[0].Duration != 0.6 || review.VisualInspection {
		t.Fatal("resolved transition evidence missing", review)
	}
	if !slices.ContainsFunc(review.Treatments, func(treatment editorialTreatment) bool {
		return treatment.Kind == "effect" && treatment.Origin == "look:fine-film"
	}) {
		t.Fatal("review ignored compiler-expanded look effects", review.Treatments)
	}
	if fields["composition"].(map[string]any)["id"] != compiled.Composition.ID {
		t.Fatal("review replaced the original compiler result")
	}
}

func TestEditorialReviewCannotAcceptPendingOrErroneousPlans(t *testing.T) {
	for name, result := range map[string]composition.Result{
		"no-plan": {},
		"pending": {Composition: &composition.Composition{}, Requirements: []composition.Requirement{{Kind: "image.generate"}}},
		"error":   {Composition: &composition.Composition{}, Diagnostics: []document.Diagnostic{{Severity: "error"}}},
	} {
		t.Run(name, func(t *testing.T) {
			encoded, err := json.Marshal(result)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]any
			if err := json.Unmarshal(encoded, &fields); err != nil {
				t.Fatal(err)
			}
			output := attachEditorialReview(Output{StatusCode: 200, Data: fields})
			review := output.Data.(map[string]any)["editorialReview"].(editorialReview)
			if review.Status != "not_ready" || review.VisualInspection {
				t.Fatal("unfinished work accepted for editorial review", review)
			}
		})
	}
}

func TestEditorialReviewBoundsDetailsWithoutMisreportingOmittedTransitions(t *testing.T) {
	track := document.Track{ID: "main", Type: "video"}
	for index := range editorialDetailLimit + 3 {
		track.Clips = append(track.Clips, editorialClip(strconv.Itoa(index), float64(index*2), 2))
	}
	track.Clips[len(track.Clips)-1].Start -= document.Seconds(0.25)
	review := reviewEditorialPlan(composition.Composition{Tracks: []document.Track{track}})
	if !review.Truncated || review.TotalJunctions != len(track.Clips)-1 || len(review.Junctions) != editorialDetailLimit {
		t.Fatal("large inventory was not explicitly bounded", review)
	}
	if slices.ContainsFunc(review.Notices, func(notice document.Diagnostic) bool { return notice.Code == "all_junctions_are_cuts" }) {
		t.Fatal("truncated transition was incorrectly reported as a cut-only edit")
	}
}

func TestEditorialReviewPreservesNearLimitCompilerResponse(t *testing.T) {
	fields := map[string]any{"summary": strings.Repeat("x", MaxResultBytes-100)}
	output := attachEditorialReview(Output{StatusCode: 200, Data: fields})
	encoded, err := json.Marshal(output.Data)
	if err != nil || len(encoded) > MaxResultBytes {
		t.Fatal("optional inventory exceeded the MCP response bound", len(encoded), err)
	}
	if fields["summary"] != output.Data.(map[string]any)["summary"] {
		t.Fatal("optional review truncated the authoritative compiler result")
	}
}

func TestProductionReferenceAndEntryPointsExposeBoundedCriticWorkflow(t *testing.T) {
	requireClientLibrary(t)
	guide, err := clientAuthoringReference(referenceInput{Topic: "production"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"production contract", "before authoring", "editorialReview", "review_required", "visualInspection: false", "paid preview", "Keep machinal's existing scene-engine"} {
		if !strings.Contains(guide.Guide, text) {
			t.Errorf("production guide is missing %q", text)
		}
	}
	for _, entry := range []string{instructions, recipeGuide} {
		for _, text := range []string{"topic=production", "critic pass", "before authoring", "editorialReview", "not a Remotion migration"} {
			if !strings.Contains(entry, text) {
				t.Errorf("entry point is missing %q", text)
			}
		}
	}
}

func TestEditorialReviewFlagsTruncatedNarrationBlackBarsLowContrastCaptionsAndStaticSlideshow(t *testing.T) {
	imgClip := editorialClip("img1", 0, 36)
	imgClip.AssetID = "img.png"
	imgClip.Transform = document.IdentityTransform()
	imgClip.TransformKeyframes = []document.Keyframe{
		{Time: 0, Transform: document.Transform{ZoomX: 1.15, ZoomY: 1.15, LinkZoom: true, AnchorX: 0.5, AnchorY: 0.5, PositionX: -20}},
		{Time: document.Seconds(36), Transform: document.Transform{ZoomX: 1.15, ZoomY: 1.15, LinkZoom: true, AnchorX: 0.5, AnchorY: 0.5, PositionX: 20}},
	}
	voClip := document.Clip{ID: "vo", AssetID: "voice_test.mp3", Start: 0, InPoint: 0, OutPoint: document.Seconds(36), PlaybackRate: 1, Volume: 100}
	plan := composition.Composition{
		Assets: []document.Asset{
			{ID: "img.png", File: "img.png", Kind: "image", Version: "sha256:a"},
			{ID: "voice_test.mp3", File: "voice_test.mp3", Kind: "audio", Version: "sha256:b", Duration: document.Seconds(37.48), HasAudio: true},
		},
		Tracks: []document.Track{
			{ID: "v1", Type: "video", Clips: []document.Clip{imgClip}},
			{ID: "a1", Type: "audio", Name: "Narration", Clips: []document.Clip{voClip}},
		},
		TextItems: []document.TextItem{
			{ID: "cap0", Text: "Test", Start: 0, Duration: document.Seconds(2), TextStyle: document.TextStyle{IsCaption: true, StrokeWidth: 0, BackgroundOpacity: 0}},
		},
	}
	review := reviewEditorialPlan(plan)
	codes := make(map[string]bool)
	for _, n := range review.Notices {
		codes[n.Code] = true
	}
	for _, want := range []string{"narration_audio_truncated", "transform_exposes_black_bars", "low_contrast_captions", "static_images_without_scenes"} {
		if !codes[want] {
			t.Errorf("editorialReview missing expected notice %q; got %+v", want, review.Notices)
		}
	}
}
