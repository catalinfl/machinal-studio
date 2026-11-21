package scenes

import (
	"strings"
	"testing"
)

func TestDefaultSceneTitle(t *testing.T) {
	for _, test := range []struct {
		name       string
		candidates []string
		want       string
	}{
		{"subject", []string{"  Rădăcini\nîn creștere  "}, "Rădăcini în creștere"},
		{"fallback", []string{" ", "Bouncing ball"}, "Bouncing ball"},
		{"short", []string{"The roots unfold beneath the growing tree in warm light"}, "The roots unfold beneath the growing"},
		{"long word", []string{strings.Repeat("ș", 80)}, strings.Repeat("ș", sceneTitleRunes)},
		{"word boundary", []string{strings.Repeat("a", 55) + " growing roots"}, strings.Repeat("a", 55)},
		{"missing", nil, "Scene"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := defaultSceneTitle(test.candidates...); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}
