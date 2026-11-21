package mcpserver

import (
	"context"
	"errors"
	"math"
	"slices"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type sceneReviewAnchors struct {
	Reveal float64 `json:"reveal"`
	Action float64 `json:"action"`
	Hold   float64 `json:"hold"`
	Exit   float64 `json:"exit"`
}

type sceneReviewPlanInput struct {
	Duration float64             `json:"duration" jsonschema:"Actual scene duration in seconds (1-60)"`
	FPS      float64             `json:"fps" jsonschema:"Actual scene frame rate (1-60)"`
	Phases   *sceneReviewAnchors `json:"phases,omitempty" jsonschema:"Optional ordered scene-local phase start times in seconds, not global timeline times"`
}

type sceneReviewSample struct {
	Frame int      `json:"frame"`
	Time  float64  `json:"time"`
	Roles []string `json:"roles"`
}

type sceneReviewPlan struct {
	Status           string              `json:"status"`
	Provisional      bool                `json:"provisional"`
	Frames           []int               `json:"frames"`
	Samples          []sceneReviewSample `json:"samples"`
	Checks           []string            `json:"checks"`
	Next             string              `json:"next"`
	VisualInspection bool                `json:"visualInspection"`
	MotionVerified   bool                `json:"motionVerified"`
	AudioVerified    bool                `json:"audioVerified"`
}

func planSceneReview(input sceneReviewPlanInput) (sceneReviewPlan, error) {
	if math.IsNaN(input.Duration) || math.IsInf(input.Duration, 0) || input.Duration < 1 || input.Duration > 60 || math.IsNaN(input.FPS) || math.IsInf(input.FPS, 0) || input.FPS < 1 || input.FPS > 60 {
		return sceneReviewPlan{}, errors.New("Use actual scene duration 1-60 seconds and fps 1-60.")
	}
	phases := sceneReviewAnchors{0, input.Duration * 0.2, input.Duration * 0.7, input.Duration * 0.94}
	if input.Phases != nil {
		phases = *input.Phases
	}
	previous := 0.0
	for _, at := range []float64{phases.Reveal, phases.Action, phases.Hold, phases.Exit} {
		if math.IsNaN(at) || math.IsInf(at, 0) || at < previous || at > input.Duration {
			return sceneReviewPlan{}, errors.New("Phase anchors must be finite, ordered scene-local seconds inside the scene.")
		}
		previous = at
	}
	last := int(math.Round(input.Duration*input.FPS)) - 1
	roles := make(map[int][]string)
	for _, sample := range []struct {
		role string
		at   float64
	}{{"reveal", phases.Reveal}, {"action-start", phases.Action}, {"action-midpoint", (phases.Action + phases.Hold) / 2}, {"hold", phases.Hold}, {"exit", phases.Exit}, {"final", float64(last) / input.FPS}} {
		frame := min(last, max(0, int(math.Round(sample.at*input.FPS))))
		roles[frame] = append(roles[frame], sample.role)
	}
	plan := sceneReviewPlan{Status: "unverified", Provisional: input.Phases == nil, Frames: []int{}, Samples: []sceneReviewSample{},
		Checks: []string{"Recognizable subject and meaningful changed state", "Hero scale, framing, contrast and readable hold", "Clipping, overlaps and caption-safe composition", "Attachment fidelity; compare action states, not only an entrance"},
		Next:   "After named-scene/image-inspection approval, read get_scene_source for the exact sourceVersion and call inspect_scene with these frames. Review actual images and make at most one focused design revision; stop after two ineffective source repairs. No media accessed or inspection permission granted by this plan. Motion/audio/final-composition require separate evidence; paid previews need spending scope."}
	for frame := range roles {
		plan.Frames = append(plan.Frames, frame)
	}
	slices.Sort(plan.Frames)
	for _, frame := range plan.Frames {
		plan.Samples = append(plan.Samples, sceneReviewSample{Frame: frame, Time: float64(frame) / input.FPS, Roles: roles[frame]})
	}
	return plan, nil
}

func registerSceneReviewPlanTool(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{Name: "plan_scene_review", Annotations: annotations(true, false, true),
		Description: "Plan up to six distinct valid reveal/action/hold/exit inspection frames from actual scene duration/fps and optional ordered scene-local phase anchors. Pure planning: no project/media access, browser, provider, spending or permission. Returns provisional defaults unless actual phases supplied. Use approved inspect_scene for pixel evidence; compilation/this plan do not prove visual quality, smooth motion or audio sync."},
		func(_ context.Context, _ *mcp.CallToolRequest, input sceneReviewPlanInput) (*mcp.CallToolResult, Output, error) {
			plan, err := planSceneReview(input)
			return nil, Output{StatusCode: 200, Data: plan}, err
		})
}
