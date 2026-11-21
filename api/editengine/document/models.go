package document

import "encoding/json"

const Version = 1
const RecipeVersion = 2
const MontageVersion = 3

type Document struct {
	Version         int              `json:"version"`
	CatalogVersion  string           `json:"catalogVersion"`
	CompilerVersion string           `json:"compilerVersion"`
	Revision        string           `json:"revision"`
	Mode            string           `json:"mode"`
	InstanceID      string           `json:"instanceId,omitempty"`
	Inputs          map[string]Input `json:"inputs,omitempty"`
	Sequence        *Sequence        `json:"sequence,omitempty"`
	Montage         *Montage         `json:"montage,omitempty"`
	Tracks          []Track          `json:"tracks,omitempty"`
	Effects         []EffectBlock    `json:"effects,omitempty"`
	Transitions     []Transition     `json:"transitions,omitempty"`
	Texts           []TextItem       `json:"texts,omitempty"`
	Audio           []Audio          `json:"audio,omitempty"`
	Overrides       []Override       `json:"overrides,omitempty"`
	Commands        []Command        `json:"commands,omitempty"`
	Jobs            []Job            `json:"jobs,omitempty"`
	Rules           []Rule           `json:"rules,omitempty"`
	Before          []Job            `json:"before,omitempty"`
	Placements      []Placement      `json:"placements,omitempty"`
	After           []Job            `json:"after,omitempty"`
	Output          Output           `json:"output"`
}

// Ranges are mandatory selections; candidates let the compiler choose whole
// editorial moments to meet a duration budget without cutting a spoken thought.
type Montage struct {
	Target         Selector        `json:"target"`
	Ranges         []MontageRange  `json:"ranges,omitempty"`
	Candidates     []MontageRange  `json:"candidates,omitempty"`
	TargetDuration Time            `json:"targetDuration,omitempty"`
	Tolerance      Time            `json:"tolerance,omitempty"`
	Seed           string          `json:"seed,omitempty"`
	Between        *MontageBetween `json:"between,omitempty"`
	Motion         *PresetChoice   `json:"motion,omitempty"`
}

type MontageRange struct {
	ClipID string `json:"clipId"`
	From   Time   `json:"from"`
	To     Time   `json:"to"`
	Score  int    `json:"score,omitempty"`
}

type PresetChoice struct {
	Preset string `json:"preset,omitempty"`
	Random bool   `json:"random,omitempty"`
	Family string `json:"family,omitempty"`
}

type MontageBetween struct {
	PresetChoice
	Duration Time   `json:"duration"`
	Policy   string `json:"policy,omitempty"`
}

type Rule struct {
	ID     string    `json:"id"`
	Target Selector  `json:"target"`
	Apply  RuleApply `json:"apply"`
}

type RuleApply struct {
	Look   string      `json:"look,omitempty"`
	Motion string      `json:"motion,omitempty"`
	Effect *RuleEffect `json:"effect,omitempty"`
}

type RuleEffect struct {
	Preset string             `json:"preset"`
	Params map[string]float64 `json:"params,omitempty"`
	Ramp   *Ramp              `json:"ramp,omitempty"`
}

type Placement struct {
	Job       string         `json:"job"`
	Track     PlacementTrack `json:"track"`
	Start     Time           `json:"start"`
	Duration  Time           `json:"duration,omitempty"`
	Transform *Transform     `json:"transform,omitempty"`
}

type PlacementTrack struct {
	Type string `json:"type"`
	Role string `json:"role"`
}

type Input struct {
	Kind     string `json:"kind"`
	Multiple bool   `json:"multiple,omitempty"`
	Optional bool   `json:"optional,omitempty"`
}

type Asset struct {
	ID       string `json:"id"`
	Version  string `json:"version"`
	File     string `json:"file"`
	Kind     string `json:"kind"`
	Duration Time   `json:"duration"`
	Width    int    `json:"width,omitempty"`
	Height   int    `json:"height,omitempty"`
	HasAudio bool   `json:"hasAudio,omitempty"`
	Local    bool   `json:"local,omitempty"`
}

type Bindings map[string][]string

type Output struct {
	Aspect     string   `json:"aspect"`
	Fit        VideoFit `json:"fit,omitempty"`
	Resolution string   `json:"resolution"`
	FPS        int      `json:"fps"`
	Format     string   `json:"format"`
	Quality    string   `json:"quality"`
}

type Sequence struct {
	Use     string    `json:"use"`
	Order   string    `json:"order"`
	Each    Treatment `json:"each"`
	Between *Between  `json:"between,omitempty"`
}

type Treatment struct {
	Take        Take     `json:"take"`
	SourceAudio string   `json:"source_audio"`
	Rate        float64  `json:"rate,omitempty"`
	Volume      *float64 `json:"volume,omitempty"`
	Look        string   `json:"look,omitempty"`
	Motion      string   `json:"motion,omitempty"`
}

type Take struct {
	From     Time `json:"from"`
	Duration Time `json:"duration"`
}

type Between struct {
	Preset   string `json:"preset"`
	Duration Time   `json:"duration"`
	Policy   string `json:"policy,omitempty"`
}

type Audio struct {
	ID       string   `json:"id"`
	Use      string   `json:"use"`
	Start    Time     `json:"start"`
	From     Time     `json:"from"`
	Duration Time     `json:"duration,omitempty"`
	Fit      string   `json:"fit,omitempty"`
	Repeat   bool     `json:"repeat,omitempty"`
	Volume   *float64 `json:"volume,omitempty"`
}

type Track struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	Muted  bool   `json:"muted"`
	Hidden bool   `json:"hidden"`
	Locked bool   `json:"locked"`
	Clips  []Clip `json:"clips"`
}

type Clip struct {
	ID                 string      `json:"id"`
	AssetID            string      `json:"assetId"`
	Start              Time        `json:"start"`
	InPoint            Time        `json:"inPoint"`
	OutPoint           Time        `json:"outPoint"`
	PlaybackRate       float64     `json:"playbackRate"`
	Volume             float64     `json:"volume"`
	LinkedClipID       string      `json:"linkedClipId,omitempty"`
	Transform          Transform   `json:"transform"`
	TransformKeyframes []Keyframe  `json:"transformKeyframes"`
	Opacity            float64     `json:"opacity"`
	FadeIn             Time        `json:"fadeIn"`
	FadeOut            Time        `json:"fadeOut"`
	Look               string      `json:"look,omitempty"`
	Motion             string      `json:"motion,omitempty"`
	LayerEntrance      string      `json:"layerEntrance,omitempty"`
	LayerExit          string      `json:"layerExit,omitempty"`
	Provenance         *Provenance `json:"provenance,omitempty"`
}

func (c Clip) Duration() Time {
	if c.PlaybackRate <= 0 {
		return 0
	}
	return Seconds((c.OutPoint - c.InPoint).Seconds() / c.PlaybackRate)
}
func (c Clip) End() Time { return c.Start + c.Duration() }

type Provenance struct {
	InstanceID string `json:"instanceId"`
	Rule       string `json:"rule"`
}

type Transform struct {
	ZoomX     float64 `json:"zoomX"`
	ZoomY     float64 `json:"zoomY"`
	LinkZoom  bool    `json:"linkZoom"`
	PositionX float64 `json:"positionX"`
	PositionY float64 `json:"positionY"`
	Rotation  float64 `json:"rotation"`
	AnchorX   float64 `json:"anchorX"`
	AnchorY   float64 `json:"anchorY"`
	Pitch     float64 `json:"pitch"`
	Yaw       float64 `json:"yaw"`
	FlipH     bool    `json:"flipH"`
	FlipV     bool    `json:"flipV"`
}

func IdentityTransform() Transform {
	return Transform{ZoomX: 1, ZoomY: 1, LinkZoom: true, AnchorX: 0.5, AnchorY: 0.5}
}

type Keyframe struct {
	Time      Time      `json:"time"`
	Transform Transform `json:"transform"`
}

type EffectBlock struct {
	ID          string             `json:"id"`
	TrackID     string             `json:"trackId"`
	Preset      string             `json:"preset"`
	Start       Time               `json:"start"`
	Duration    Time               `json:"duration"`
	Params      map[string]float64 `json:"params"`
	Ramp        *Ramp              `json:"ramp,omitempty"`
	OwnerClipID string             `json:"ownerClipId,omitempty"`
	Provenance  *Provenance        `json:"provenance,omitempty"`
}

type Ramp struct {
	Mode   string  `json:"mode"`
	Curve  string  `json:"curve"`
	Amount float64 `json:"amount"`
}

type Transition struct {
	ID          string `json:"id"`
	TrackID     string `json:"trackId"`
	LeftClipID  string `json:"leftClipId"`
	RightClipID string `json:"rightClipId"`
	Preset      string `json:"preset"`
	Duration    Time   `json:"duration"`
}

type Override struct {
	Target    string      `json:"target"`
	Start     *Time       `json:"start,omitempty"`
	From      *Time       `json:"from,omitempty"`
	Duration  *Time       `json:"duration,omitempty"`
	Rate      *float64    `json:"rate,omitempty"`
	Volume    *float64    `json:"volume,omitempty"`
	Opacity   *float64    `json:"opacity,omitempty"`
	FadeIn    *Time       `json:"fadeIn,omitempty"`
	FadeOut   *Time       `json:"fadeOut,omitempty"`
	Transform *Transform  `json:"transform,omitempty"`
	Keyframes *[]Keyframe `json:"keyframes,omitempty"`
	Look      *string     `json:"look,omitempty"`
	Motion    *string     `json:"motion,omitempty"`
}

type Selector struct {
	Kind     string   `json:"kind"`
	IDs      []string `json:"ids,omitempty"`
	TrackID  string   `json:"trackId,omitempty"`
	Position string   `json:"position,omitempty"`
	Index    int      `json:"index,omitempty"`
	Selected bool     `json:"selected,omitempty"`
}

type Command struct {
	Type     string    `json:"type"`
	Target   Selector  `json:"target"`
	Patch    *Override `json:"patch,omitempty"`
	Track    *Track    `json:"track,omitempty"`
	TrackID  string    `json:"trackId,omitempty"`
	Value    *bool     `json:"value,omitempty"`
	Time     Time      `json:"time,omitempty"`
	Preset   string    `json:"preset,omitempty"`
	Duration Time      `json:"duration,omitempty"`
	CloseGap bool      `json:"closeGap,omitempty"`
}

type Job struct {
	ID                 string          `json:"id"`
	Type               string          `json:"type"`
	Input              string          `json:"input,omitempty"`
	AssetID            string          `json:"assetId,omitempty"`
	Preset             string          `json:"preset,omitempty"`
	MaxWords           int             `json:"maxWords,omitempty"`
	Style              json.RawMessage `json:"style,omitempty"`
	ResultAssetID      string          `json:"resultAssetId,omitempty"`
	ResultAudioAssetID string          `json:"resultAudioAssetId,omitempty"`
	AudioStart         Time            `json:"audioStart,omitempty"`
	ResultTextIDs      []string        `json:"resultTextIds,omitempty"`
	// Orchestration-only fields (YAML-only, no effect on pure compile).
	// Language is an ISO-639-1 code for speech/captions/transcribe ("" = auto-detect).
	Language     string `json:"language,omitempty"`
	Instructions string `json:"instructions,omitempty"`
	Prompt       string `json:"prompt,omitempty"`
	// Text is the narration input for speech.generate.
	Text          string `json:"text,omitempty"`
	NarrationJob  string `json:"narrationJob,omitempty"`
	NarrationFrom Time   `json:"narrationFrom,omitempty"`
	// Voice and Model select speech/image provider variants.
	Voice               string       `json:"voice,omitempty"`
	Model               string       `json:"model,omitempty"`
	ReferenceName       string       `json:"referenceName,omitempty"`
	ReferenceTranscript string       `json:"referenceTranscript,omitempty"`
	Background          string       `json:"background,omitempty"`
	ImageStyle          string       `json:"imageStyle,omitempty"`
	Width               int          `json:"width,omitempty"`
	Height              int          `json:"height,omitempty"`
	FPS                 float64      `json:"fps,omitempty"`
	VisualMode          string       `json:"visualMode,omitempty"`
	Images              []SceneImage `json:"images,omitempty"`
	// Aspect selects image shape (auto, 16:9, 9:16, 1:1, ...).
	Aspect string `json:"aspect,omitempty"`
	// Placement for generated media: target track, timeline start and
	// duration. When ResultAssetID is supplied the compiler appends a
	// clip referencing it; the orchestration route fills ResultAssetID.
	TrackID  string `json:"trackId,omitempty"`
	Start    Time   `json:"start,omitempty"`
	Duration Time   `json:"duration,omitempty"`
}

type SceneImage struct {
	ID          string `json:"id"`
	File        string `json:"file,omitempty"`
	Job         string `json:"job,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}
