package scenes

import "strings"

const sceneTitleWords = 6
const sceneTitleRunes = 60

func defaultSceneTitle(candidates ...string) string {
	for _, candidate := range candidates {
		words := strings.Fields(candidate)
		if len(words) == 0 {
			continue
		}
		words = words[:min(len(words), sceneTitleWords)]
		for len(words) > 1 && len([]rune(strings.Join(words, " "))) > sceneTitleRunes {
			words = words[:len(words)-1]
		}
		title := []rune(strings.Join(words, " "))
		return string(title[:min(len(title), sceneTitleRunes)])
	}
	return "Scene"
}
