package render

import "ffmpeg-go-server/editengine/document"

type segment struct {
	SrcStart float64  `json:"srcStart"`
	SrcEnd   float64  `json:"srcEnd"`
	Effects  []effect `json:"effects"`
}

type transform struct {
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

type transformKeyframe struct {
	Time      float64   `json:"time"`
	Transform transform `json:"transform"`
}

type clip struct {
	fromScene          bool
	sceneTransparent   bool
	previewPreroll     float64
	File               string              `json:"file"`
	MediaKind          string              `json:"mediaKind"`
	InPoint            float64             `json:"inPoint"`
	OutPoint           float64             `json:"outPoint"`
	Start              float64             `json:"start"`
	PlaybackRate       *float64            `json:"playbackRate"`
	Volume             *float64            `json:"volume"`
	Transform          *transform          `json:"transform"`
	TransformKeyframes []transformKeyframe `json:"transformKeyframes"`
	Opacity            *float64            `json:"opacity"`
	FadeIn             *float64            `json:"fadeIn"`
	FadeOut            *float64            `json:"fadeOut"`
	Segments           []segment           `json:"segments"`
}

type channel struct {
	Clips       []clip       `json:"clips"`
	Transitions []transition `json:"transitions"`
}

type renderRequest struct {
	previewBlank bool
	Fit          document.VideoFit `json:"fit,omitempty"`
	sceneExports []string
	Duration     *float64 `json:"duration,omitempty"`
	Format       string   `json:"format"`
	Quality      string   `json:"quality"`
	Resolution   struct {
		W int `json:"w"`
		H int `json:"h"`
	} `json:"resolution"`
	FPS           int        `json:"fps"`
	VideoChannels []channel  `json:"videoChannels"`
	AudioChannels []channel  `json:"audioChannels"`
	TextItems     []textItem `json:"textItems"`
}

type outputSettings struct {
	format       string
	quality      string
	extension    string
	audioBitrate string
	videoQuality string
	videoEncoder string
	videoPreset  string
	audioOnly    bool
}

type textItem struct {
	motionOffset      float64
	Start             float64  `json:"start"`
	Duration          float64  `json:"duration"`
	X                 int      `json:"x"`
	Y                 int      `json:"y"`
	Animation         string   `json:"animation"`
	AnimationDuration float64  `json:"animationDuration"`
	MotionStart       *float64 `json:"motionStart"`
	MotionDuration    *float64 `json:"motionDuration"`
	Image             string   `json:"image"`
	data              []byte
}

type transition struct {
	RightClipIndex int    `json:"rightClipIndex"`
	Xfade          string `json:"xfade"`
}
