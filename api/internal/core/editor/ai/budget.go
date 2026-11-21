package ai

import (
	"log"
	"os"
	"strings"
	"time"

	"ffmpeg-go-server/internal/integrations/openrouter"
)

const defaultPlannerMaxTokens = 4096
const maxPlannerMaxTokens = 16384

func plannerReasoning() *openrouter.ReasoningConfig {
	effort := strings.ToLower(strings.TrimSpace(os.Getenv("AI_PLANNER_REASONING")))
	if effort == "" || effort == "none" {
		enabled := false
		return &openrouter.ReasoningConfig{Enabled: &enabled}
	}
	if !oneOf(effort, "minimal", "low", "medium", "high") {
		effort = "low"
	}
	return &openrouter.ReasoningConfig{Effort: effort}
}

func plannerTokenBudget() int {
	return min(envIntPositive("AI_PLANNER_MAX_TOKENS", defaultPlannerMaxTokens), maxPlannerMaxTokens)
}

func logPlannerUsage(stage string, started time.Time, response openrouter.ChatCompletionResponse) {
	finish := ""
	if len(response.Choices) > 0 {
		finish = response.Choices[0].FinishReason
	}
	log.Printf("[AI TIMING] stage=%s elapsed=%s model=%s provider=%s generation=%s input_tokens=%d output_tokens=%d reasoning_tokens=%d finish=%s",
		stage, time.Since(started), response.Model, response.Provider, response.ID,
		response.Usage.PromptTokens, response.Usage.CompletionTokens, response.Usage.CompletionTokensDetails.ReasoningTokens, finish)
}
