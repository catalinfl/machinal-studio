package ai

import (
	"regexp"
	"strconv"
	"strings"
)

func foldIntentText(value string) string {
	value = strings.ToLower(value)
	return strings.NewReplacer("ă", "a", "â", "a", "î", "i", "ș", "s", "ş", "s", "ț", "t", "ţ", "t").Replace(value)
}

func normalizeIntentText(value string) string {
	value = foldIntentText(value)
	words := strings.FieldsFunc(value, func(char rune) bool {
		return !(char >= 'a' && char <= 'z') && !(char >= '0' && char <= '9')
	})
	return strings.Join(words, " ")
}

const (
	// exactMatchScoreBase separates full-name matches from single-word
	// matches so shadowing logic can prefer the exact source.
	exactMatchScoreBase = 1000
	minDistinctiveWordLen = 4
)

var (
	audioRemovalNegations = []string{"do not remove audio", "do not delete audio", "keep original audio", "nu sterge audio", "nu elimina sunet", "pastreaza sunetul original"}
	audioRemovalPhrases   = []string{
		"remove audio", "remove only audio", "delete audio", "delete only audio", "without audio", "no source audio", "mute original audio", "replace original audio",
		"sterge audio", "sterge doar audio", "sterge numai audio", "sterge sunet", "sterge doar sunet", "sterge numai sunet", "elimina audio", "elimina sunet", "fara audio", "fara sunet", "inlocuieste audio", "inlocuieste sunet",
	}
	everyImagePhrases = []string{"each image", "every image", "all images", "all media bin images", "each photo", "every photo", "all photos", "all media bin photos", "fiecare imagine", "toate imaginile", "toate imaginile din media bin", "fiecare poza", "toate pozele", "toate pozele din media bin", "fiecare fotografie", "toate fotografiile"}
	audioMentionTerms  = []string{"audio", "music", "song", "track", "soundtrack", "muzica", "piesa", "melodie", "cantec", "coloana sonora"}
)

func requestsSourceAudioRemoval(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, negation := range audioRemovalNegations {
		if strings.Contains(normalized, negation) {
			return false
		}
	}
	for _, phrase := range []string{
		"remove audio", "remove only audio", "delete audio", "delete only audio", "without audio", "no source audio", "mute original audio", "replace original audio",
		"sterge audio", "sterge doar audio", "sterge numai audio", "sterge sunet", "sterge doar sunet", "sterge numai sunet", "elimina audio", "elimina sunet", "fara audio", "fara sunet", "inlocuieste audio", "inlocuieste sunet",
	} {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

var genericSourceWords = map[string]bool{
	"audio": true, "clip": true, "during": true, "duration": true, "effect": true, "effects": true, "image": true,
	"images": true, "motion": true, "music": true, "only": true, "photo": true, "photos": true, "played": true,
	"preset": true, "presets": true, "second": true, "seconds": true, "sequence": true, "showing": true,
	"slideshow": true, "song": true, "track": true, "transform": true, "transformation": true, "transformations": true,
	"transition": true, "transitions": true, "video": true, "while": true,
	"cantec": true, "efect": true, "efecte": true, "imagine": true, "imagini": true, "melodie": true, "miscare": true,
	"muzica": true, "piesa": true, "poza": true, "poze": true, "presetare": true, "presetari": true, "secunda": true,
	"secunde": true, "secventa": true, "transformare": true, "transformari": true, "tranzitie": true, "tranzitii": true,
}

func instructionSourceMatchScore(instruction, name string) int {
	normalizedInstruction := normalizeIntentText(instruction)
	base := name
	if dot := strings.LastIndex(base, "."); dot > 0 {
		base = base[:dot]
	}
	normalizedName := normalizeIntentText(base)
	instructionWords := " " + normalizedInstruction + " "
	if len(normalizedName) >= 3 && strings.Contains(instructionWords, " "+normalizedName+" ") {
		return exactMatchScoreBase + len(normalizedName)
	}
	score := 0
	for word := range strings.FieldsSeq(normalizedName) {
		if len(word) >= minDistinctiveWordLen && !genericSourceWords[word] && strings.Contains(instructionWords, " "+word+" ") {
			score = max(score, len(word))
		}
	}
	return score
}

func instructionMentionsSource(instruction, name string) bool {
	return instructionSourceMatchScore(instruction, name) > 0
}

func distinctiveSourceWords(name string) map[string]bool {
	if dot := strings.LastIndex(name, "."); dot > 0 {
		name = name[:dot]
	}
	words := make(map[string]bool)
	for word := range strings.FieldsSeq(normalizeIntentText(name)) {
		if len(word) >= minDistinctiveWordLen && !genericSourceWords[word] {
			words[word] = true
		}
	}
	return words
}

func specificallyMentionedSourceIDs(instruction string, sources []mediaSource) map[string]bool {
	exact := make(map[string]bool)
	for _, source := range sources {
		if instructionSourceMatchScore(instruction, source.Name) >= exactMatchScoreBase {
			exact[source.ID] = true
		}
	}

	mentioned := make(map[string]bool)
	for _, source := range sources {
		score := instructionSourceMatchScore(instruction, source.Name)
		if score == 0 {
			continue
		}
		if exact[source.ID] {
			mentioned[source.ID] = true
			continue
		}

		words := distinctiveSourceWords(source.Name)
		shadowed := false
		for _, candidate := range sources {
			if candidate.Kind != source.Kind || !exact[candidate.ID] {
				continue
			}
			for word := range distinctiveSourceWords(candidate.Name) {
				if words[word] {
					shadowed = true
					break
				}
			}
			if shadowed {
				break
			}
		}
		if !shadowed {
			mentioned[source.ID] = true
		}
	}
	return mentioned
}

func requestsEveryImage(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, phrase := range everyImagePhrases {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

func mentionsAudioEdit(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, term := range audioMentionTerms {
		if strings.Contains(normalized, term) {
			return true
		}
	}
	return false
}

var (
	recommendationApplyPhrases = []string{
		"apply the recommendation", "apply your recommendation", "recommend and apply", "suggest and apply",
		"aplica recomandarea", "aplica sugestia", "recomanda si aplica", "sugereaza si aplica",
	}
	recommendationOnlyPhrases = []string{
		"recommend", "recommendation", "suggest", "suggestion", "what would fit", "what should i use", "what would you use",
		"recomanda", "recomanzi", "recomandare", "sugereaza", "sugerezi", "sugestie", "ce s ar potrivi", "ce ai folosi", "ce ai pune",
	}
	completeAudioRejectPhrases = []string{"do not use the whole song", "do not keep the whole song", "nu folosi toata piesa", "nu pastra toata piesa"}
	completeAudioPhrases       = []string{
		"whole song", "entire song", "full song", "whole track", "entire track", "full track", "complete audio", "all of the song",
		"toata piesa", "piesa intreaga", "toata melodia", "melodia intreaga", "tot cantecul", "audio integral", "pastreaza toata piesa",
	}
	scopedAudioPlacementTerms = []string{
		"add ", "put ", "place ", "insert ", "play ", "use ", "with music", "with song", "with audio", "with soundtrack",
		"adauga ", "pune ", "introdu ", "reda ", "foloseste ", "cu muzica", "cu piesa", "cu melodia", "cu cantecul",
	}
)

func requestsRecommendationOnly(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, phrase := range recommendationApplyPhrases {
		if strings.Contains(normalized, phrase) {
			return false
		}
	}
	for _, phrase := range recommendationOnlyPhrases {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

func rejectsCompleteAudio(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, phrase := range completeAudioRejectPhrases {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

func requestsCompleteAudio(instruction string) bool {
	if rejectsCompleteAudio(instruction) {
		return false
	}
	normalized := normalizeIntentText(instruction)
	for _, phrase := range completeAudioPhrases {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

var limitedAudioPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?:audio|music|song|track|muzica|piesa|melodie|cantec)\s+(?:for|of|de|pentru|timp de)\s+\d+(?:[.,]\d+)?\s*` + durationUnitPattern),
	regexp.MustCompile(`(?:first|only first|primele|doar primele)\s+\d+(?:[.,]\d+)?\s*` + durationUnitPattern + `\s+(?:of|from|din|de)?\s*(?:the\s+)?(?:audio|music|song|track|muzica|piesa|melodie|cantec)`),
	regexp.MustCompile(`\d+(?:[.,]\d+)?\s*` + durationUnitPattern + `\s+(?:of|from|din|de)\s+(?:the\s+)?(?:audio|music|song|track|muzica|piesa|melodie|cantec)`),
	regexp.MustCompile(`(?:audio|music|song|track|muzica|piesa|melodie|cantec)\s+(?:from|de la)\s+\d+(?:[.,]\d+)?\s*(?:s|sec|secs|second|seconds|secunda|secunde)?\s+(?:to|la|and|si)\s+\d+(?:[.,]\d+)?`),
}

func requestsLimitedAudio(instruction string) bool {
	if rejectsCompleteAudio(instruction) {
		return true
	}
	if requestsCompleteAudio(instruction) {
		return false
	}
	if requestsImageScopedAudio(instruction) {
		return true
	}
	if requestsVisualScopedAudio(instruction) {
		return true
	}
	folded := foldIntentText(instruction)
	for _, pattern := range limitedAudioPatterns {
		if pattern.MatchString(folded) {
			return true
		}
	}
	return false
}

func requestsDefaultScopedAudio(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	hasPlacement := false
	for _, term := range scopedAudioPlacementTerms {
		if strings.Contains(normalized, term) {
			hasPlacement = true
			break
		}
	}
	return hasPlacement && mentionsAudioEdit(instruction) && !requestsCompleteAudio(instruction) && !requestsLimitedAudio(instruction)
}

var imageScopedAudioPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?:audio|music|song|track|soundtrack)\b.{0,120}\b(?:only during|only while|during showing|while showing)\b.{0,60}\b(?:images?|photos?|slideshow)\b`),
	regexp.MustCompile(`(?:muzica|piesa|melodie|melodia|cantec|cantecul|coloana sonora)\b.{0,120}\b(?:doar pe durata|numai pe durata|doar in timpul|numai in timpul|doar cat timp|numai cat timp)\b.{0,60}\b(?:imagini|imaginile|poze|pozele|fotografii|fotografiile)\b`),
}

func requestsImageScopedAudio(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, pattern := range imageScopedAudioPatterns {
		if pattern.MatchString(normalized) {
			return true
		}
	}
	return false
}

var visualScopedAudioPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?:audio|music|song|track|soundtrack)\b.{0,120}\b(?:throughout|during|for the duration of)\b.{0,40}\b(?:the )?(?:video|edit|timeline)\b`),
	regexp.MustCompile(`(?:muzica|piesa|melodie|melodia|cantec|cantecul|coloana sonora)\b.{0,120}\b(?:pe parcursul|pe durata|in timpul)\b.{0,40}\b(?:video|videoclip|montaj|timeline)\b`),
}

func requestsVisualScopedAudio(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, pattern := range visualScopedAudioPatterns {
		if pattern.MatchString(normalized) {
			return true
		}
	}
	return false
}

func requestsMotionPresets(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	hasPreset := strings.Contains(normalized, "preset")
	hasTransform := strings.Contains(normalized, "transform") || strings.Contains(normalized, "motion") || strings.Contains(normalized, "miscare")
	return hasPreset && hasTransform
}

func rejectsEffects(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, phrase := range []string{
		"not effects", "not effect", "no effects", "without effects", "do not add effects", "dont add effects",
		"nu efecte", "fara efecte", "nu adauga efecte", "nu aplica efecte",
	} {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

func requestsClipLooks(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, term := range []string{"look", "looks", "lookuri", "clip look"} {
		if strings.Contains(normalized, term) {
			return true
		}
	}
	return !requestsMotionPresets(instruction) && strings.Contains(normalized, "preset")
}

func requestsSharedClipLook(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, phrase := range []string{
		"same preset", "one preset for all", "a preset for all", "shared preset", "consistent preset", "consistent look",
		"acelasi preset", "un preset pentru toate", "un singur preset", "look consistent", "aspect unitar",
	} {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

func instructionNamesClipLook(instruction string) bool {
	normalized := normalizeIntentText(instruction)
	for _, preset := range clipPresets {
		if strings.Contains(normalized, strings.ReplaceAll(preset.ID, "-", " ")) {
			return true
		}
	}
	return false
}

func requestsVariedClipLooks(instruction string) bool {
	if !requestsClipLooks(instruction) || requestsSharedClipLook(instruction) || instructionNamesClipLook(instruction) {
		return false
	}
	normalized := normalizeIntentText(instruction)
	for _, plural := range []string{"presets", "preseturi", "preset uri", "looks", "lookuri"} {
		if strings.Contains(normalized, plural) {
			return true
		}
	}
	for _, phrase := range []string{
		"choose presets", "pick presets", "different presets", "varied presets", "choose looks", "different looks", "varied looks",
		"alege preseturi", "alege tu preseturi", "preseturi diferite", "lookuri diferite", "preset uri",
	} {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

const durationUnitPattern = `(?:seconds|second|secs|sec|secunde|secunda|s)\b`

type durationCandidate struct {
	Value      float64
	Start, End int
}

var durationPattern = regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(?:-\s*)?` + durationUnitPattern)

func durationCandidates(instruction string) []durationCandidate {
	folded := foldIntentText(instruction)
	matches := durationPattern.FindAllStringSubmatchIndex(folded, -1)
	result := make([]durationCandidate, 0, len(matches))
	for _, match := range matches {
		if len(match) < 4 {
			continue
		}
		value, err := strconv.ParseFloat(strings.ReplaceAll(folded[match[2]:match[3]], ",", "."), 64)
		if err == nil && value > 0 {
			result = append(result, durationCandidate{Value: value, Start: match[0], End: match[1]})
		}
	}
	return result
}

var (
	transitionBeforeDuration = regexp.MustCompile(`(?:transition|transitions|tranzitie|tranzitii)\s*(?:of|de)?\s*$`)
	transitionAfterDuration  = regexp.MustCompile(`^\s*(?:of|de)?\s*(?:a\s+)?(?:transition|transitions|tranzitie|tranzitii)\b`)
)

func transitionDurationCandidates(instruction string) []durationCandidate {
	folded := foldIntentText(instruction)
	result := make([]durationCandidate, 0)
	for _, candidate := range durationCandidates(instruction) {
		before := folded[max(0, candidate.Start-40):candidate.Start]
		after := folded[candidate.End:min(len(folded), candidate.End+64)]
		if transitionBeforeDuration.MatchString(before) || transitionAfterDuration.MatchString(after) {
			result = append(result, candidate)
		}
	}
	return result
}

func requestedTransitionCandidate(instruction string) (durationCandidate, bool) {
	folded := foldIntentText(instruction)
	bestScore := 0
	best := durationCandidate{}
	for _, candidate := range transitionDurationCandidates(instruction) {
		score := 1
		after := folded[candidate.End:min(len(folded), candidate.End+64)]
		if match := transitionAfterDuration.FindStringIndex(after); match != nil {
			tail := after[match[1]:]
			if separator := strings.Index(tail, " and "); separator >= 0 {
				tail = tail[:separator]
			}
			if separator := strings.Index(tail, " si "); separator >= 0 {
				tail = tail[:separator]
			}
			if strings.Contains(tail, "between") || strings.Contains(tail, "intre") {
				score += 4
			}
		}
		if score >= bestScore {
			bestScore = score
			best = candidate
		}
	}
	return best, bestScore > 0
}

func requestedTransitionDuration(instruction string) (float64, bool) {
	candidate, ok := requestedTransitionCandidate(instruction)
	return candidate.Value, ok
}

func requestedImageDuration(instruction string) (float64, bool) {
	folded := foldIntentText(instruction)
	imageSubject := `(?:each|every|all|fiecare|toate)\s+(?:image|images|photo|photos|imagine|imagini|imaginile|poza|poze|pozele|fotografie|fotografii|fotografiile)`
	imagePlural := `(?:images|photos|imagini|imaginile|poze|pozele|fotografii|fotografiile)`
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*(?:-\s*)?` + durationUnitPattern + `\s*(?:from|din|for|pentru|per|on)?\s*` + imageSubject),
		regexp.MustCompile(imageSubject + `\s*(?:for|pentru|at|of|de|lasting|duration(?:\s+of)?)\s*(\d+(?:[.,]\d+)?)\s*(?:-\s*)?` + durationUnitPattern),
		regexp.MustCompile(imageSubject + `\s*(?:(?:must|should)\s+(?:have|be|last)|(?:have|are|last)|(?:trebuie\s+(?:sa\s+)?(?:aiba|fie|dureze)))\s*(\d+(?:[.,]\d+)?)\s*(?:-\s*)?` + durationUnitPattern),
		regexp.MustCompile(imagePlural + `\s*(?:(?:must|should)\s+(?:have|be|last)|(?:trebuie\s+(?:sa\s+)?(?:aiba|fie|dureze)))\s*(\d+(?:[.,]\d+)?)\s*(?:-\s*)?` + durationUnitPattern),
		regexp.MustCompile(imagePlural + `\s*,?\s*(\d+(?:[.,]\d+)?)\s*(?:-\s*)?` + durationUnitPattern + `\s*(?:each|fiecare)`),
		regexp.MustCompile(imageSubject + `\s+(\d+(?:[.,]\d+)?)\s*(?:-\s*)?` + durationUnitPattern),
	}
	for _, pattern := range patterns {
		match := pattern.FindStringSubmatchIndex(folded)
		if len(match) != 4 {
			continue
		}
		after := folded[match[1]:min(len(folded), match[1]+64)]
		if transitionAfterDuration.MatchString(after) {
			continue
		}
		value, err := strconv.ParseFloat(strings.ReplaceAll(folded[match[2]:match[3]], ",", "."), 64)
		if err == nil && value > 0 {
			return value, true
		}
	}
	if !requestsEveryImage(instruction) {
		return 0, false
	}
	transition, hasTransition := requestedTransitionCandidate(instruction)
	candidates := transitionDurationCandidates(instruction)
	if !hasTransition || len(candidates) < 2 {
		return 0, false
	}
	for _, candidate := range candidates {
		if candidate.Start != transition.Start || candidate.End != transition.End {
			return candidate.Value, true
		}
	}
	return 0, false
}
