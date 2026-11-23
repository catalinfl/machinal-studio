package document

import "encoding/json"

type TextItem struct {
	ID           string `json:"id"`
	SourceClipID string `json:"sourceClipId,omitempty"`
	Start        Time   `json:"start"`
	Duration     Time   `json:"duration"`
	Text         string `json:"text"`
	Preset       string `json:"preset,omitempty"`
	TextStyle
	Words    []Word                     `json:"words"`
	Explicit map[string]json.RawMessage `json:"-"`
}

type Word struct {
	Text  string `json:"text"`
	Start Time   `json:"start"`
	End   Time   `json:"end"`
}

type TextStyle struct {
	X                          float64 `json:"x"`
	Y                          float64 `json:"y"`
	Anchor                     string  `json:"anchor,omitempty"`
	FontFamily                 string  `json:"fontFamily"`
	FontSize                   float64 `json:"fontSize"`
	FontWeight                 int     `json:"fontWeight"`
	Italic                     bool    `json:"italic"`
	Align                      string  `json:"align"`
	Color                      string  `json:"color"`
	StrokeColor                string  `json:"strokeColor"`
	StrokeWidth                float64 `json:"strokeWidth"`
	BackgroundColor            string  `json:"backgroundColor"`
	BackgroundOpacity          float64 `json:"backgroundOpacity"`
	BackgroundPadding          float64 `json:"backgroundPadding"`
	BackgroundRadius           float64 `json:"backgroundRadius"`
	BannerStyle                string  `json:"bannerStyle"`
	AccentColor                string  `json:"accentColor"`
	Animation                  string  `json:"animation"`
	AnimationDuration          Time    `json:"animationDuration"`
	Opacity                    float64 `json:"opacity"`
	Rotation                   float64 `json:"rotation"`
	IsCaption                  bool    `json:"isCaption"`
	HighlightMode              string  `json:"highlightMode"`
	HighlightColor             string  `json:"highlightColor"`
	HighlightBackgroundColor   string  `json:"highlightBackgroundColor"`
	HighlightBackgroundOpacity float64 `json:"highlightBackgroundOpacity"`
	HighlightAnimation         string  `json:"highlightAnimation"`
}

func DefaultTextStyle() TextStyle {
	return TextStyle{X: 960, Y: 540, FontFamily: "sans", FontSize: 40, FontWeight: 400,
		Anchor: "center", Align: "center", Color: "#ffffff", StrokeColor: "#000000", BackgroundColor: "#000000",
		BackgroundPadding: 18, BackgroundRadius: 8, BannerStyle: "none", AccentColor: "#7047c7",
		Animation: "none", AnimationDuration: Seconds(0.45), Opacity: 1, HighlightMode: "none",
		HighlightColor: "#fff36d", HighlightBackgroundColor: "#000000", HighlightAnimation: "pop"}
}

// DefaultCaptionStyle returns a high-contrast, legible default style for newly
// generated captions when the recipe does not supply an explicit captions style.
func DefaultCaptionStyle(aspect string) TextStyle {
	style := DefaultTextStyle()
	style.IsCaption = true
	style.FontFamily = "montserrat"
	style.FontWeight = 700
	style.FontSize = 64
	style.Color = "#ffffff"
	style.StrokeColor = "#0b0b0c"
	style.StrokeWidth = 4
	style.BackgroundColor = "#0b0b0c"
	style.BackgroundOpacity = 0.78
	style.BackgroundPadding = 18
	style.BackgroundRadius = 14
	style.HighlightMode = "word"
	style.HighlightColor = "#f4ea58"
	style.HighlightAnimation = "pop"
	width, height := 1920.0, 1080.0
	switch aspect {
	case "portrait", "9:16":
		width, height = 1080, 1920
		style.FontSize = 58
	case "classic", "4:3":
		width = 1440
	}
	style.X, style.Y = width/2, height*0.8
	if width == 1080 {
		style.Y = height * 0.76
	}
	return style
}
