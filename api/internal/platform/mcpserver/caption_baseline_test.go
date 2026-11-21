package mcpserver

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestApprovedCaptionTextEditsPreserveEveryOtherEntryField(t *testing.T) {
	data, err := os.ReadFile("testdata/caption-preservation.edit.yaml")
	if err != nil {
		t.Fatal(err)
	}
	baseline := string(data)
	current := strings.ReplaceAll(baseline, "artă", "artă!")
	edits := []captionTextEdit{{From: "artă", To: "artă!"}}
	review, err := compareCaptionBaseline(current, baseline, edits, true)
	if err != nil || review["status"] != "preserved" || review["completeEntriesCompared"] != true || review["captionVersion"] != recipeCaptionVersion(current) {
		t.Fatal(review, err)
	}
	if _, err := compareCaptionBaseline(current, baseline, edits, false); err == nil {
		t.Fatal("unapproved caption edits accepted")
	}
	for _, replacement := range [][2]string{
		{"fontSize: 48", "fontSize: 49"}, {"y: 1560", "y: 1550"},
		{"end: 0.2s", "end: 0.3s"}, {"captions-ro/0, captions-ro/1", "captions-ro/1, captions-ro/0"},
	} {
		changed := strings.Replace(current, replacement[0], replacement[1], 1)
		if changed == current {
			t.Fatal("invalid test mutation", replacement)
		}
		if _, err := compareCaptionBaseline(changed, baseline, edits, true); err == nil {
			t.Fatal("authorized name correction allowed unrelated caption changes", replacement)
		}
	}
}

func TestAuthorizedCaptionPreflightRetainsOriginalFingerprintGuard(t *testing.T) {
	data, err := os.ReadFile("testdata/caption-preservation.edit.yaml")
	if err != nil {
		t.Fatal(err)
	}
	baseline := string(data)
	current := strings.ReplaceAll(baseline, "artă", "artă!")
	calls := 0
	handler := NewHandler(func(_ context.Context, _ http.Header, request Request) (Response, error) {
		calls++
		if string(request.Body) != current {
			t.Fatal("caption preflight rewrote the submitted recipe")
		}
		return Response{StatusCode: 200, Body: []byte(`{"diagnostics":[],"requirements":[]}`)}, nil
	})
	args := map[string]any{"projectId": "owned", "composition": current, "captionBaseline": baseline,
		"expectedCaptionVersion": recipeCaptionVersion(baseline), "captionTextEdits": []captionTextEdit{{"artă", "artă!"}}, "captionEditsApproved": true}
	result, output := callTool(t, handler, "validate_recipe", args)
	if result.IsError || output.Data.(map[string]any)["captionReview"].(map[string]any)["status"] != "preserved" || calls != 1 {
		t.Fatal(result, output)
	}
	args["composition"] = strings.Replace(current, "fontSize: 48", "fontSize: 49", 1)
	result, _ = callTool(t, handler, "validate_recipe", args)
	if !result.IsError || calls != 1 {
		t.Fatal("unrelated edits reached API after an authorized name correction")
	}
}

func TestCaptionComparisonRejectsMissingBaselineUnusedEditsAndPartialWordEdits(t *testing.T) {
	data, err := os.ReadFile("testdata/caption-preservation.edit.yaml")
	if err != nil {
		t.Fatal(err)
	}
	baseline := string(data)
	for _, test := range []struct {
		current  string
		baseline string
		edits    []captionTextEdit
	}{
		{baseline, "", []captionTextEdit{{"artă", "artă!"}}},
		{baseline, baseline, []captionTextEdit{{"absent", "replaced"}}},
		{strings.Replace(baseline, "artă", "artă!", 1), baseline, []captionTextEdit{{"artă", "artă!"}}},
	} {
		if _, err := compareCaptionBaseline(test.current, test.baseline, test.edits, true); err == nil {
			t.Fatal("incomplete caption comparison accepted")
		}
	}
}
