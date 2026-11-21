package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"ffmpeg-go-server/internal/core/editor/speech"
)

const (
	toolName = "edit_timeline"
	// Server-side caps: bound model output and timeline size so one plan
	// cannot exhaust memory or produce an unrenderable timeline.
	maxOperations     = 64
	maxImageJobs      = 4
	maxSpeechJobs     = 4
	maxTimeline       = 24 * 60 * 60
	planModeEdit      = "execute"
	planModeRecommend = "recommend"

	minPlaybackRate = 0.25
	maxPlaybackRate = 4.0

	// 1ms tolerance absorbs float rounding when comparing timeline edges.
	timingEpsilon = 0.001
)

type mediaKind string

const (
	mediaKindVideo mediaKind = "video"
	mediaKindAudio mediaKind = "audio"
	mediaKindImage mediaKind = "image"
)

const (
	trackTypeVideo = "video"
	trackTypeAudio = "audio"
)

func (k mediaKind) valid() bool {
	switch k {
	case mediaKindVideo, mediaKindAudio, mediaKindImage:
		return true
	default:
		return false
	}
}

const maxConcurrentAIRequests = 10

// requestSlots bounds concurrent AI edit requests so one burst cannot exhaust
// OpenRouter quota or server memory. MUST MODIFY BEFORE PROD.
var requestSlots = make(chan struct{}, maxConcurrentAIRequests)

type clip struct {
	ID                 string              `json:"id"`
	Name               string              `json:"name,omitempty"`
	SourceID           string              `json:"sourceId,omitempty"`
	SourceDuration     float64             `json:"sourceDuration,omitempty"`
	MediaKind          mediaKind           `json:"mediaKind,omitempty"`
	Start              float64             `json:"start"`
	End                float64             `json:"end"`
	SourceIn           float64             `json:"sourceIn"`
	SourceOut          float64             `json:"sourceOut"`
	Rate               float64             `json:"rate"`
	Volume             *float64            `json:"volume,omitempty"`
	Transform          *transform          `json:"transform,omitempty"`
	TransformKeyframes []transformKeyframe `json:"transformKeyframes,omitempty"`
	MotionPreset       string              `json:"motionPreset,omitempty"`
	LinkedID           string              `json:"linkedId,omitempty"`
}

type mediaSource struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Kind            mediaKind `json:"kind"`
	SourceMode      string    `json:"sourceMode,omitempty"`
	Duration        float64   `json:"duration"`
	Width           int       `json:"width"`
	Height          int       `json:"height"`
	TimelineClipIDs []string  `json:"timelineClipIds,omitempty"`
}

type track struct {
	ID     string `json:"id"`
	Name   string `json:"name,omitempty"`
	Type   string `json:"type"`
	Locked bool   `json:"locked"`
	Muted  bool   `json:"muted,omitempty"`
	Hidden bool   `json:"hidden,omitempty"`
	Clips  []clip `json:"clips"`
}

type focus struct {
	Playhead          float64  `json:"playhead"`
	SelectedClipIDs   []string `json:"selectedClipIds,omitempty"`
	SelectedTrackIDs  []string `json:"selectedTrackIds,omitempty"`
	SelectedEffectIDs []string `json:"selectedEffectIds,omitempty"`
	SelectedTextIDs   []string `json:"selectedTextIds,omitempty"`
}

type effect struct {
	ID         string             `json:"id"`
	TrackID    string             `json:"trackId"`
	Preset     string             `json:"preset"`
	Start      float64            `json:"start"`
	Duration   float64            `json:"duration"`
	Params     map[string]float64 `json:"params,omitempty"`
	OwnerID    string             `json:"ownerClipId,omitempty"`
	ClipLookID string             `json:"clipLookId,omitempty"`
	Ramp       *effectRamp        `json:"ramp,omitempty"`
}

type transition struct {
	ID          string  `json:"id"`
	TrackID     string  `json:"trackId"`
	LeftClipID  string  `json:"leftClipId"`
	RightClipID string  `json:"rightClipId"`
	Preset      string  `json:"preset"`
	Duration    float64 `json:"duration"`
}

type effectRamp struct {
	Mode   string  `json:"mode"`
	Curve  string  `json:"curve"`
	Amount float64 `json:"amount"`
}

type text struct {
	ID       string         `json:"id"`
	Start    float64        `json:"start"`
	Duration float64        `json:"duration"`
	Text     string         `json:"text"`
	Style    map[string]any `json:"style,omitempty"`
}

type project struct {
	Duration    float64       `json:"duration"`
	FPS         int           `json:"fps"`
	Aspect      string        `json:"aspect"`
	Focus       focus         `json:"focus,omitempty"`
	Tracks      []track       `json:"tracks"`
	Effects     []effect      `json:"effects"`
	Transitions []transition  `json:"transitions,omitempty"`
	Texts       []text        `json:"texts"`
	Sources     []mediaSource `json:"sources,omitempty"`
}

type editRequest struct {
	Instruction string  `json:"instruction"`
	Revision    string  `json:"revision"`
	Project     project `json:"project"`
	// Fast keeps one executor call and local best-effort recovery; routing
	// and any necessary media analysis still run.
	Fast bool `json:"fast,omitempty"`
}

type textStyle struct {
	X                          *float64 `json:"x,omitempty"`
	Y                          *float64 `json:"y,omitempty"`
	FontFamily                 *string  `json:"fontFamily,omitempty"`
	FontSize                   *float64 `json:"fontSize,omitempty"`
	FontWeight                 *int     `json:"fontWeight,omitempty"`
	Italic                     *bool    `json:"italic,omitempty"`
	Align                      *string  `json:"align,omitempty"`
	Color                      *string  `json:"color,omitempty"`
	StrokeColor                *string  `json:"strokeColor,omitempty"`
	StrokeWidth                *float64 `json:"strokeWidth,omitempty"`
	BackgroundColor            *string  `json:"backgroundColor,omitempty"`
	BackgroundOpacity          *float64 `json:"backgroundOpacity,omitempty"`
	BackgroundPadding          *float64 `json:"backgroundPadding,omitempty"`
	BackgroundRadius           *float64 `json:"backgroundRadius,omitempty"`
	BannerStyle                *string  `json:"bannerStyle,omitempty"`
	AccentColor                *string  `json:"accentColor,omitempty"`
	Animation                  *string  `json:"animation,omitempty"`
	AnimationDuration          *float64 `json:"animationDuration,omitempty"`
	Opacity                    *float64 `json:"opacity,omitempty"`
	Rotation                   *float64 `json:"rotation,omitempty"`
	IsCaption                  *bool    `json:"isCaption,omitempty"`
	HighlightMode              *string  `json:"highlightMode,omitempty"`
	HighlightColor             *string  `json:"highlightColor,omitempty"`
	HighlightBackgroundColor   *string  `json:"highlightBackgroundColor,omitempty"`
	HighlightBackgroundOpacity *float64 `json:"highlightBackgroundOpacity,omitempty"`
	HighlightAnimation         *string  `json:"highlightAnimation,omitempty"`
}

type transform struct {
	ZoomX     *float64            `json:"zoomX,omitempty"`
	ZoomY     *float64            `json:"zoomY,omitempty"`
	LinkZoom  *bool               `json:"linkZoom,omitempty"`
	PositionX *float64            `json:"positionX,omitempty"`
	PositionY *float64            `json:"positionY,omitempty"`
	Rotation  *float64            `json:"rotation,omitempty"`
	AnchorX   *float64            `json:"anchorX,omitempty"`
	AnchorY   *float64            `json:"anchorY,omitempty"`
	Pitch     *float64            `json:"pitch,omitempty"`
	Yaw       *float64            `json:"yaw,omitempty"`
	FlipH     *bool               `json:"flipH,omitempty"`
	FlipV     *bool               `json:"flipV,omitempty"`
	Keyframes []transformKeyframe `json:"keyframes,omitempty"`
}

type transformKeyframe struct {
	Time      float64   `json:"time"`
	Transform transform `json:"transform"`
}

type editOperation struct {
	Type         string             `json:"type"`
	Start        *float64           `json:"start,omitempty"`
	End          *float64           `json:"end,omitempty"`
	Duration     *float64           `json:"duration,omitempty"`
	Time         *float64           `json:"time,omitempty"`
	Delta        *float64           `json:"delta,omitempty"`
	ChannelIDs   []string           `json:"channelIds,omitempty"`
	ChannelID    string             `json:"channelId,omitempty"`
	BlockID      string             `json:"blockId,omitempty"`
	ClipID       string             `json:"clipId,omitempty"`
	SourceID     string             `json:"sourceId,omitempty"`
	ResultID     string             `json:"resultId,omitempty"`
	SourceIn     *float64           `json:"sourceIn,omitempty"`
	SourceOut    *float64           `json:"sourceOut,omitempty"`
	InPoint      *float64           `json:"inPoint,omitempty"`
	OutPoint     *float64           `json:"outPoint,omitempty"`
	PlaybackRate *float64           `json:"playbackRate,omitempty"`
	Volume       *float64           `json:"volume,omitempty"`
	IncludeAudio *bool              `json:"includeAudio,omitempty"`
	Transform    *transform         `json:"transform,omitempty"`
	MotionPreset string             `json:"motionPreset,omitempty"`
	PresetID     string             `json:"presetId,omitempty"`
	LeftClipID   string             `json:"leftClipId,omitempty"`
	RightClipID  string             `json:"rightClipId,omitempty"`
	Count        *int               `json:"count,omitempty"`
	EffectID     string             `json:"effectId,omitempty"`
	Params       map[string]float64 `json:"params,omitempty"`
	TextID       string             `json:"textId,omitempty"`
	Text         *string            `json:"text,omitempty"`
	TextPresetID string             `json:"textPresetId,omitempty"`
	Style        *textStyle         `json:"style,omitempty"`
}

type imageJob struct {
	ID           string   `json:"id"`
	Prompt       string   `json:"prompt"`
	SourceName   string   `json:"sourceName,omitempty"`
	Style        string   `json:"style,omitempty"`
	Placement    string   `json:"placement"`
	Position     string   `json:"position"`
	Start        float64  `json:"start"`
	Duration     float64  `json:"duration"`
	Background   string   `json:"background"`
	Quality      string   `json:"quality"`
	MotionPreset string   `json:"motionPreset"`
	Opacity      *float64 `json:"opacity,omitempty"`
	Fade         *float64 `json:"fade,omitempty"`
}

type speechJob struct {
	ID           string   `json:"id"`
	Input        string   `json:"input"`
	Model        string   `json:"model"`
	Voice        string   `json:"voice"`
	Language     string   `json:"language,omitempty"`
	Instructions string   `json:"instructions,omitempty"`
	Start        float64  `json:"start"`
	Volume       *float64 `json:"volume,omitempty"`
}

var speechModelPresets = speech.PresetModels()

func (operation *editOperation) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return fmt.Errorf("decode operation envelope: %w", err)
	}
	type plainOperation editOperation
	var decoded plainOperation
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return fmt.Errorf("decode %q operation: %w", decoded.Type, err)
	}
	allowed := map[string]bool{"type": true}
	switch decoded.Type {
	case "delete_range":
		allowed = operationFields("start", "end", "channelIds")
	case "add_effect":
		allowed = operationFields("channelId", "effectId", "start", "duration", "params")
	case "update_effect":
		allowed = operationFields("blockId", "start", "duration", "params")
	case "delete_effect":
		allowed = operationFields("blockId")
	case "add_text":
		allowed = operationFields("start", "duration", "text", "textPresetId", "style")
	case "update_text":
		allowed = operationFields("textId", "start", "duration", "text", "textPresetId", "style")
	case "delete_text":
		allowed = operationFields("textId")
	case "add_media":
		allowed = operationFields("sourceId", "resultId", "channelId", "start", "sourceIn", "sourceOut", "playbackRate", "volume", "includeAudio")
	case "move_clip":
		allowed = operationFields("clipId", "channelId", "start", "delta")
	case "update_clip":
		allowed = operationFields("clipId", "start", "inPoint", "outPoint", "playbackRate", "volume", "transform", "motionPreset")
	case "split_clip":
		allowed = operationFields("clipId", "time")
	case "remove_source_audio", "delete_clip":
		allowed = operationFields("clipId")
	case "apply_preset":
		allowed = operationFields("clipId", "presetId")
	case "add_transition", "update_transition":
		allowed = operationFields("channelId", "leftClipId", "rightClipId", "effectId", "duration")
	case "undo":
		allowed = operationFields("count")
	default:
		return fmt.Errorf("unknown operation type %q", decoded.Type)
	}
	for field := range fields {
		if !allowed[field] {
			return fmt.Errorf("field %q is not allowed for %s", field, decoded.Type)
		}
	}
	*operation = editOperation(decoded)
	return nil
}

func operationFields(fields ...string) map[string]bool {
	allowed := map[string]bool{"type": true}
	for _, field := range fields {
		allowed[field] = true
	}
	return allowed
}

type editPlan struct {
	Revision   string          `json:"revision,omitempty"`
	Mode       string          `json:"mode,omitempty"`
	Summary    string          `json:"summary"`
	ImageJobs  []imageJob      `json:"imageJobs,omitempty"`
	SpeechJobs []speechJob     `json:"speechJobs,omitempty"`
	Operations []editOperation `json:"operations"`
}

// wireEditPlan enforces the JSON contract the editor relies on: a missing
// model array must serialize as [] instead of null, otherwise the client
// crashes reading operations.length.
func wireEditPlan(plan editPlan) editPlan {
	if plan.Operations == nil {
		plan.Operations = []editOperation{}
	}
	return plan
}

type presetInfo struct {
	ID          string `json:"id"`
	Description string `json:"description"`
}

var clipPresets = []presetInfo{
	{ID: "hook-punch", Description: "fast zoom pulse, white flash and restrained RGB impact"},
	{ID: "whip-switch", Description: "directional settle with brief blur and channel split"},
	{ID: "flash-beat", Description: "clean contrast with a compact opening flash"},
	{ID: "clean-tutorial", Description: "clear detail, controlled color and quick camera settle"},
	{ID: "warm-routine", Description: "soft warmth, protected highlights and fine lifestyle texture"},
	{ID: "raw-story", Description: "natural cleanup and subtle handheld texture"},
	{ID: "balanced-enhance", Description: "gentle denoise, balanced contrast and clean detail recovery"},
	{ID: "fine-film", Description: "vintage curve, restrained grain, vignette and slow push-in"},
	{ID: "creator-natural", Description: "soft cleanup and natural color"},
	{ID: "clean-social-pop", Description: "bright color, punchy contrast and crisp detail"},
	{ID: "teal-amber", Description: "cool shadows, warm countertone, grain and vignette"},
	{ID: "warm-memory", Description: "faded warmth, soft diffusion and nostalgic grain"},
	{ID: "dream-bloom", Description: "luminous soft focus, ghosting and gentle push-in"},
	{ID: "silver-contrast", Description: "deep monochrome contrast, sharp detail and grain"},
	{ID: "neon-night", Description: "saturated cool color, prism edges and punch-in"},
	{ID: "analog-tape", Description: "tape damage, scanlines, chroma softness, echo and drift"},
	{ID: "kodak-gold-summer", Description: "sunlit warmth, rich color, gentle grain and soft film curve"},
	{ID: "kodak-portra-soft", Description: "low-contrast warmth, soft skin detail and restrained pastel color"},
	{ID: "fuji-cool-chrome", Description: "cool clean color, crisp detail and saturated chrome-like contrast"},
	{ID: "cinestill-800t", Description: "tungsten-night color, bright chroma edges and pronounced fine grain"},
	{ID: "documentary-16mm", Description: "muted documentary contrast, coarse grain, flicker and handheld motion"},
	{ID: "super-8-home-movie", Description: "warm faded color, chunky grain, flicker and 18 fps cadence"},
	{ID: "blockbuster-35mm", Description: "dense theatrical contrast, split warm-cool color and polished detail"},
	{ID: "film-noir-hard-light", Description: "crushed monochrome shadows, hard highlights and sharp film texture"},
	{ID: "faded-polaroid", Description: "washed instant-film color, lifted blacks and nostalgic texture"},
	{ID: "disposable-camera", Description: "overexposed color, coarse grain and point-and-shoot edges"},
	{ID: "y2k-camcorder", Description: "interlaced-era sharpness, scanlines, echo and handheld drift"},
	{ID: "vhs-rental-tape", Description: "worn tape color, heavy scanlines, soft detail and damaged blocks"},
	{ID: "crt-gaming", Description: "dense scanlines, vivid phosphor-like color and curved-screen softness"},
	{ID: "cyberpunk-magenta-cyan", Description: "electric magenta-cyan color, split edges and deep night contrast"},
	{ID: "matrix-terminal", Description: "green-biased shadows, severe contrast and terminal-like scanlines"},
	{ID: "vaporwave-sunset", Description: "pink sunset color, hazy highlights and drifting chromatic edges"},
	{ID: "acid-rave", Description: "posterized neon color, wide RGB splits and pulsing temporal energy"},
	{ID: "music-video-chrome", Description: "metallic desaturation, hard detail and prismatic highlights"},
	{ID: "paparazzi-flash", Description: "direct-flash contrast, crisp detail and repeated camera-bulb hits"},
	{ID: "sports-hype", Description: "cold hard contrast, aggressive edge detail and impact movement"},
	{ID: "travel-golden-hour", Description: "golden warmth, vivid destination color and cinematic photo move"},
	{ID: "food-commercial", Description: "warm appetizing color, bright mids and clean product detail"},
	{ID: "beauty-commercial", Description: "polished skin detail, luminous warmth and soft controlled contrast"},
	{ID: "moody-forest", Description: "cool muted foliage, lowered exposure and shadowy edge falloff"},
	{ID: "desert-western", Description: "dusty sepia warmth, hard sun contrast and weathered film grain"},
	{ID: "arctic-blue", Description: "icy desaturation, bright cold mids and precise frozen detail"},
	{ID: "horror-sick-green", Description: "unhealthy green color, unstable exposure and claustrophobic shadows"},
	{ID: "dream-sequence", Description: "heavy diffusion, lifted light and lingering temporal ghost"},
	{ID: "comic-pop", Description: "bold color steps, graphic outlines and punchy printed detail"},
	{ID: "thermal-surveillance", Description: "false-color heat mapping, digital interference and monitor scanlines"},
	{ID: "action-steel", Description: "cold desaturated contrast, hard detail and controlled shake"},
	{ID: "low-light-rescue", Description: "noise cleanup, lifted mids and edge recovery"},
	{ID: "golden-glow", Description: "warm luminous color, diffusion and film texture"},
	{ID: "direct-flash", Description: "hard whites, vivid color, digital sharpness and fine noise"},
	{ID: "bleach-grit", Description: "harsh desaturation, dense grain, vignette and impact shake"},
	{ID: "pastel-haze", Description: "lifted low contrast, muted pastels and soft pull-back"},
	{ID: "blue-night", Description: "moonlit blue grade, restrained color and denoised detail"},
	{ID: "soft-silver", Description: "airy monochrome diffusion, lifted contrast and fine grain"},
	{ID: "rgb-glitch", Description: "prism split, scanlines, echo hits and block glitches"},
	{ID: "backlight-rescue", Description: "opens dark mids while preserving contrast and detail"},
	{ID: "lo-fi-zine", Description: "posterized color, cadence changes, grain and jitter"},
	{ID: "watercolor-drift", Description: "painted color regions, soft focus and floating camera move"},
	{ID: "cyber-trails", Description: "electric color, RGB edges, scanlines and temporal trails"},
	{ID: "sepia-strobe", Description: "dreamy sepia, blur reveal, flashes and frame echo"},
}

var textPresets = []presetInfo{
	{ID: "hook-pop", Description: "fast opening line with a confident settle"},
	{ID: "active-word", Description: "timed caption with one highlighted word"},
	{ID: "clean-phrase", Description: "high-contrast caption for quick reading"},
	{ID: "keyword-punch", Description: "bold takeaway for a payoff moment"},
	{ID: "step-label", Description: "numbered chapter marker for tutorials"},
	{ID: "reply-card", Description: "comment-led prompt"},
	{ID: "caption-bounce", Description: "spoken caption with a soft rebound"},
	{ID: "top-drop", Description: "headline that lands from above"},
	{ID: "side-snap", Description: "compact save-worthy line from the left"},
	{ID: "beat-shake", Description: "short horizontal impact for a hard beat"},
	{ID: "gentle-float", Description: "quiet editorial line that drifts upward"},
	{ID: "question-hook", Description: "bright opening question with a top-down hit"},
	{ID: "numeric-proof", Description: "oversized result for stats and comparisons"},
	{ID: "quote-pull", Description: "editorial treatment for a memorable statement"},
	{ID: "clean-outline", Description: "crisp high-contrast phrase without a box"},
	{ID: "color-block", Description: "creator caption with a focused active word"},
	{ID: "creator-tag", Description: "compact handle or recurring series marker"},
	{ID: "payoff-line", Description: "active-word finish for the conclusion"},
	{ID: "tiktok-pop", Description: "intense TikTok word-by-word punch without a box"},
	{ID: "tiktok-box", Description: "TikTok karaoke caption with the active word on a bright pill"},
	{ID: "tiktok-glow", Description: "glowing active word for night clips"},
}

var transformPresets = []presetInfo{
	{ID: "none", Description: "static transform"}, {ID: "zoom-in", Description: "slow push in"}, {ID: "zoom-out", Description: "slow pull out"},
	{ID: "punch", Description: "quick emphasis zoom"}, {ID: "zoom-pulse", Description: "beat-ready zoom hit"}, {ID: "ken-burns", Description: "natural photo pan and zoom"},
	{ID: "pan-left", Description: "smooth horizontal move left"}, {ID: "pan-right", Description: "smooth horizontal move right"}, {ID: "pan-up", Description: "smooth vertical move up"},
	{ID: "pan-down", Description: "smooth vertical move down"}, {ID: "reframe-left", Description: "quick subject shift left"}, {ID: "reframe-right", Description: "quick subject shift right"},
	{ID: "settle", Description: "soft landing motion"}, {ID: "impact-shake", Description: "short hook shake"}, {ID: "drift", Description: "edge-safe camera glide"},
}

var transitionPresets = map[string]string{
	"cross-dissolve": "fade", "film-dissolve-fast": "fadefast", "film-dissolve-slow": "fadeslow",
	"fade-black": "fadeblack", "fade-white": "fadewhite", "fade-grayscale": "fadegrays",
	"blur-dissolve": "hblur", "noise-dissolve": "dissolve", "difference-dissolve": "distance",
	"mosaic-dissolve": "pixelize", "wipe-left": "wipeleft", "wipe-right": "wiperight",
	"wipe-up": "wipeup", "wipe-down": "wipedown", "smooth-left": "smoothleft",
	"smooth-right": "smoothright", "smooth-up": "smoothup", "smooth-down": "smoothdown",
	"clock-wipe": "radial", "diagonal-tl": "diagtl", "diagonal-tr": "diagtr",
	"diagonal-bl": "diagbl", "diagonal-br": "diagbr", "corner-tl": "wipetl",
	"corner-tr": "wipetr", "corner-bl": "wipebl", "corner-br": "wipebr",
	"blinds-left": "hlslice", "blinds-right": "hrslice", "blinds-up": "vuslice",
	"blinds-down": "vdslice", "circle": "circleopen", "circle-close": "circleclose",
	"circle-crop": "circlecrop", "rectangle-crop": "rectcrop", "barn-vertical-open": "vertopen",
	"barn-vertical-close": "vertclose", "barn-horizontal-open": "horzopen",
	"barn-horizontal-close": "horzclose", "slide-left": "slideleft", "slide-right": "slideright",
	"slide-up": "slideup", "slide-down": "slidedown", "squeeze-horizontal": "squeezeh",
	"squeeze-vertical": "squeezev", "zoom-in": "zoomin",
	"whip-pan-left": "custom-whip-left", "whip-pan-right": "custom-whip-right",
	"whip-pan-up": "custom-whip-up", "whip-pan-down": "custom-whip-down",
	"zoom-blur-in": "custom-zoom-blur-in", "zoom-blur-out": "custom-zoom-blur-out",
	"spin-zoom": "custom-spin-zoom", "camera-roll": "custom-camera-roll",
	"lens-warp": "custom-lens-warp", "stretch-horizontal": "custom-stretch-h",
	"stretch-vertical": "custom-stretch-v", "ripple-warp": "custom-ripple",
	"liquid-wave": "custom-liquid", "kaleidoscope-reveal": "custom-kaleidoscope",
	"rgb-split-transition": "custom-rgb-split", "digital-glitch-transition": "custom-digital-glitch",
	"vhs-tracking-transition": "custom-vhs-tracking", "datamosh-transition": "custom-datamosh",
	"tv-static-transition": "custom-tv-static", "scanline-reveal": "custom-scanline",
	"pixel-sort-reveal": "custom-pixel-sort", "light-leak-transition": "custom-light-leak",
	"film-burn-transition": "custom-film-burn", "flash-bulb-transition": "custom-flash-bulb",
	"luma-fade": "custom-luma-fade", "chroma-fade": "custom-chroma-fade",
	"ink-bleed-reveal": "custom-ink-bleed", "page-turn-2d": "custom-page-turn",
	"split-panels": "custom-split-panels", "shutter-snap": "custom-shutter-snap",
}
