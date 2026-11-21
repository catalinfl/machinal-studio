package toolrouting

import (
	"strings"
	"testing"
)

func TestBothRoutingStrategiesReceiveVideoAwareImageToolCriteria(t *testing.T) {
	const intent = "Replace overly simplistic historical SVG illustrations with approved images"
	wanted := map[string][]string{
		"get_editing_reference": {"topic=scenes", "visual coverage"},
		"generate_assets":       {"image.generate", "overly simplistic SVG/CSS", "timing-first", "approved budget", "media/spending consent"},
		"compile_scene":         {"approved existing images", "four images per scene, not per video", "generate_assets first", "not artwork generation"},
	}
	for _, strategy := range []string{"", choiceStrategy} {
		t.Run("strategy="+strategy, func(t *testing.T) {
			request := routingRequest(intent, "router-model", strategy)
			for tool, required := range wanted {
				criteria := request.Questions[tool].Instructions
				if strategy == choiceStrategy {
					criteria = request.Questions[nextToolQuestion].Criteria[tool]
				}
				for _, text := range required {
					if !strings.Contains(criteria, text) {
						t.Errorf("%s routing criteria lack %q", tool, text)
					}
				}
			}
			if _, ok := request.Questions["image.generate"]; ok {
				t.Fatal("YAML job type became a routing tool")
			}
			if _, ok := request.Questions[nextToolQuestion].Criteria["image.generate"]; ok {
				t.Fatal("YAML job type became a choice candidate")
			}
		})
	}
}
