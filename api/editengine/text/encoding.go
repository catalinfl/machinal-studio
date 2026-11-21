package text

import (
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/unicode/norm"
)

var ErrInvalidEncoding = errors.New("text contains damaged characters; restore valid UTF-8 text without replacement characters (U+FFFD)")

const captionEncodingLayers = 3

var captionEncodingRepair = newCaptionEncodingRepair()

// RepairEncoding reverses only known Romanian mojibake sequences. Re-decoding
// an entire string would damage correct letters and mixed-language captions.
func RepairEncoding(value string) string {
	for {
		repaired := captionEncodingRepair.Replace(value)
		if repaired == value {
			return norm.NFC.String(value)
		}
		// Every replacement is shorter, so repeated encoding damage converges.
		value = repaired
	}
}

func ValidateEncoding(value string) error {
	if !utf8.ValidString(value) || strings.ContainsRune(value, utf8.RuneError) {
		return ErrInvalidEncoding
	}
	return nil
}

func newCaptionEncodingRepair() *strings.Replacer {
	replacements := make(map[string]string)
	for _, letter := range "ĂÂÎȘȚăâîșțŞŢşţ" {
		original := string(letter)
		variants := []string{original}
		for range captionEncodingLayers {
			var next []string
			for _, variant := range variants {
				for _, encoding := range []*charmap.Charmap{charmap.Windows1252, charmap.ISO8859_1} {
					broken := misdecodeCaptionBytes(variant, encoding)
					if strings.ContainsRune(broken, utf8.RuneError) {
						continue
					}
					replacements[broken] = original
					next = append(next, broken)
				}
			}
			variants = next
		}
	}
	patterns := make([]string, 0, len(replacements))
	for pattern := range replacements {
		patterns = append(patterns, pattern)
	}
	slices.SortFunc(patterns, func(a, b string) int {
		if len(a) != len(b) {
			return len(b) - len(a)
		}
		return strings.Compare(a, b)
	})
	pairs := make([]string, 0, len(patterns)*2)
	for _, pattern := range patterns {
		pairs = append(pairs, pattern, replacements[pattern])
	}
	return strings.NewReplacer(pairs...)
}

func misdecodeCaptionBytes(value string, encoding *charmap.Charmap) string {
	var result strings.Builder
	for _, value := range []byte(value) {
		result.WriteRune(encoding.DecodeByte(value))
	}
	return result.String()
}
