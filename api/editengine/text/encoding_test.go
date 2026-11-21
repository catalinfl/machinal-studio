package text

import (
	"errors"
	"testing"

	"golang.org/x/text/encoding/charmap"
)

func TestRepairEncoding(t *testing.T) {
	for _, test := range []struct {
		name, input, want string
	}{
		{"windows-1252", "È˜tiinÈ›Äƒ È™i RomÃ¢nia, Ã®n BucureÈ™ti.", "Știință și România, în București."},
		{"latin-1", "\u00c8\u0098tiin\u00c8\u009b\u00c4\u0083 \u00c8\u0099i", "Știință și"},
		{"mixed text", "România È™i țară — 日本語 😊 François", "România și țară — 日本語 😊 François"},
		{"decomposed", "S\u0326tiint\u0326a\u0306 s\u0326i i\u0302n", "Știință și în"},
		{"valid multilingual", "ĂÂÎȘȚ ăâîșț Şş Ţţ İstanbul François São Tomé Ångström 😊", "ĂÂÎȘȚ ăâîșț Şş Ţţ İstanbul François São Tomé Ångström 😊"},
		{"no spelling guesses", "si tara in Romania", "si tara in Romania"},
		{"lost character", "Rom�nia", "Rom�nia"},
		{"empty", "", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := RepairEncoding(test.input)
			if got != test.want {
				t.Fatalf("RepairEncoding(%q) = %q, want %q", test.input, got, test.want)
			}
			if repeated := RepairEncoding(got); repeated != got {
				t.Fatalf("repair is not idempotent: %q -> %q", got, repeated)
			}
		})
	}
}

func TestRepairEncodingRecoversEveryRomanianLetterAcrossRepeatedMisdecoding(t *testing.T) {
	const original = "ĂÂÎȘȚăâîșțŞŢşţ"
	for _, first := range []*charmap.Charmap{charmap.Windows1252, charmap.ISO8859_1} {
		for _, second := range []*charmap.Charmap{charmap.Windows1252, charmap.ISO8859_1} {
			for _, third := range []*charmap.Charmap{charmap.Windows1252, charmap.ISO8859_1} {
				broken := original
				for _, encoding := range []*charmap.Charmap{first, second, third} {
					var err error
					broken, err = encoding.NewDecoder().String(broken)
					if err != nil {
						t.Fatal(err)
					}
					if got := RepairEncoding(broken); got != original {
						t.Fatalf("repair %q = %q, want %q", broken, got, original)
					}
				}
			}
		}
	}
}

func TestValidateEncodingRejectsLostCharacters(t *testing.T) {
	for _, input := range []string{"Rom�nia", "Rom\xffnia"} {
		if err := ValidateEncoding(input); !errors.Is(err, ErrInvalidEncoding) {
			t.Fatalf("damaged text %q was accepted: %v", input, err)
		}
	}
	if err := ValidateEncoding("Știință și România 😊"); err != nil {
		t.Fatal(err)
	}
}
