package ai

import (
	"os"
	"strconv"
	"strings"
)

// Performance tuning for the interactive /ai/edit route. Every knob is
// env-overridable so latency can be cut without redeploying, and every
// default preserves the previous behavior unless explicitly lowered.
//
// Knobs:
//   - OPENROUTER_JEV_MODEL ........... pinned Jev model for tool routing (default typesafe/jev-1.13)
//   - AI_ROUTER_ATTEMPTS ............. retry budget for OpenRouter Jev rate limits (default 2)
//   - AI_VISION_ATTEMPTS ............. retry budget for vision calls (default 2)
//   - AI_EXECUTOR_ATTEMPTS ........... retry budget for executor/repair calls (default 4)
//   - AI_ANALYSIS_SOURCES ............ how many media sources to analyze (default 2, hard cap 3)
//   - AI_VISION_FRAMES ............... representative frames per source (default 6, hard cap 12)
//   - AI_ANALYSIS_MAX_MINUTES ........ per-source analysis window in minutes (default 10, hard cap 20)

type analysisScope struct {
	NeedSignals    bool
	NeedVision     bool
	NeedTranscript bool
}

func fullAnalysisScope() analysisScope {
	return analysisScope{NeedSignals: true, NeedVision: true, NeedTranscript: true}
}

func (scope analysisScope) requested() bool {
	return scope.NeedSignals || scope.NeedVision || scope.NeedTranscript
}

// --- Router knobs ---

func resolveRouterModel() string {
	if model := strings.TrimSpace(os.Getenv("OPENROUTER_JEV_MODEL")); model != "" {
		return model
	}
	return "typesafe/jev-1.13"
}

func routerMaxAttempts() int {
	return envIntPositive("AI_ROUTER_ATTEMPTS", 2)
}

func visionMaxAttempts() int {
	return envIntPositive("AI_VISION_ATTEMPTS", 2)
}

func executorMaxAttempts() int {
	return envIntPositive("AI_EXECUTOR_ATTEMPTS", 4)
}

// --- Analysis limits (effective <= hard caps in analysis.go) ---

func effectiveMaxAnalysisSources() int {
	return min(envIntPositive("AI_ANALYSIS_SOURCES", 2), maxAnalysisSources)
}

func effectiveMaxVisionFrames() int {
	return min(envIntPositive("AI_VISION_FRAMES", 6), maxVisionFrames)
}

func effectiveMaxAnalysisDuration() float64 {
	minutes := envIntPositive("AI_ANALYSIS_MAX_MINUTES", 10)
	capMinutes := int(maxAnalysisDuration / 60)
	if minutes > capMinutes {
		minutes = capMinutes
	}
	return float64(minutes * 60)
}

func envIntPositive(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

// Fast requests keep one executor call and a local best-effort fallback.
func isFastRequest(queryFast string, bodyFast bool) bool {
	if bodyFast {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(queryFast)) {
	case "1", "true", "yes", "fast":
		return true
	}
	return false
}
