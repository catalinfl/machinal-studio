package mcpserver

import (
	"strings"
	"testing"
)

const captionContentFixture = `document:
  version: 2
  jobs:
    - {id: voice, type: speech.generate, language: ro, resultAssetId: voice.mp3, text: 'Luiza Melencu. La o urgență, fiecare apel contează.'}
    - {id: captions, type: captions.generate, language: ro, resultTextIds: [cue]}
  texts:
    - {id: cue, isCaption: true, text: 'Luisa Melencu. O urgență, fiecare apel contează.', start: 0, duration: 4}
`

func TestCaptionContentReviewFlagsNamesAndMissingWordsWithoutChangingBaseline(t *testing.T) {
	version := recipeCaptionVersion(captionContentFixture)
	review := captionContentReview(captionContentFixture)
	if review["status"] != "review_required" || review["audioInspection"] != false || review["totalDifferences"] != 2 {
		t.Fatal(review)
	}
	differences := review["differences"].([]map[string]string)
	if differences[0]["expected"] != "luiza" || differences[0]["actual"] != "luisa" || differences[0]["captionId"] != "cue" || differences[1]["expected"] != "la" || differences[1]["actual"] != "" {
		t.Fatal(differences)
	}
	if version == "" || recipeCaptionVersion(captionContentFixture) != version {
		t.Fatal("content review changed caption entries")
	}
	matched := strings.ReplaceAll(strings.ReplaceAll(captionContentFixture, "Luisa", "Luiza"), "O urgență", "La o urgență")
	if captionContentReview(matched)["status"] != "matched" {
		t.Fatal(captionContentReview(matched))
	}
}

func TestCaptionContentReviewDoesNotClaimAnEmptyOrAmbiguousComparison(t *testing.T) {
	for _, recipe := range []string{
		"document:\n  version: 2\n",
		strings.Replace(captionContentFixture, "text: 'Luisa Melencu. O urgență, fiecare apel contează.'", "text: ''", 1),
		strings.Replace(captionContentFixture, "type: speech.generate, language: ro", "type: speech.generate, language: en", 1),
		strings.Replace(captionContentFixture, "resultTextIds: [cue]", "resultTextIds: [absent]", 1),
		strings.Replace(captionContentFixture, "resultTextIds: [cue]", "resultTextIds: [cue], assetId: other-audio.mp3", 1),
	} {
		if review := captionContentReview(recipe); review["status"] != "not_checked" {
			t.Fatal(review)
		}
	}
}
