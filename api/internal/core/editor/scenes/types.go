package scenes

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/subtitles"
)

const (
	maxPromptRunes    = document.MaxScenePromptRunes
	maxScenes         = 8
	maxSceneSeconds   = 60
	maxVoiceSeconds   = 180
	maxComponentBytes = 64000
	maxRequestBytes   = 48 << 10
)

type Request struct {
	Prompt          string          `json:"prompt"`
	Text            string          `json:"text,omitempty"`
	VisualMode      string          `json:"visualMode,omitempty"`
	Transparent     bool            `json:"transparent,omitempty"`
	Duration        float64         `json:"duration"`
	Width           int             `json:"width"`
	Height          int             `json:"height"`
	FPS             float64         `json:"fps"`
	AudioFile       string          `json:"audioFile,omitempty"`
	Language        string          `json:"language,omitempty"`
	NarrationText   string          `json:"narrationText,omitempty"`
	NarrationCues   []subtitles.Cue `json:"narrationCues,omitempty"`
	CaptionSafeArea bool            `json:"captionSafeArea,omitempty"`
	Images          []SceneImage    `json:"images,omitempty"`
	Videos          []SceneVideo    `json:"videos,omitempty"`
	SourceFile      string          `json:"sourceFile,omitempty"`
	Model           string          `json:"model,omitempty"`
}

type Config struct {
	Width             int     `json:"width"`
	Height            int     `json:"height"`
	FPS               float64 `json:"fps"`
	Frames            int     `json:"durationInFrames"`
	Transparent       bool    `json:"transparent,omitempty"`
	VisualMode        string  `json:"visualMode,omitempty"`
	CaptionSafeBottom float64 `json:"captionSafeBottom,omitempty"`
}

type Definition struct {
	Title       string          `json:"title"`
	Brief       string          `json:"brief"`
	Start       float64         `json:"start"`
	End         float64         `json:"end"`
	Component   string          `json:"component"`
	Explanation string          `json:"explanation,omitempty"`
	Cues        []subtitles.Cue `json:"cues,omitempty"`
}

type Scene struct {
	ID string `json:"id"`
	Definition
	Asset    document.Asset  `json:"asset"`
	Manifest json.RawMessage `json:"manifest"`
	Source   *LiveSource     `json:"source,omitempty"`
}

type Job struct {
	ID         string  `json:"id"`
	Status     string  `json:"status"`
	Message    string  `json:"message"`
	Progress   float64 `json:"progress"`
	Transcript string  `json:"transcript,omitempty"`
	Scenes     []Scene `json:"scenes"`
	Revision   uint64  `json:"revision"`
}

func (r Request) validate() error {
	if r.SourceFile != "" {
		if !IsSource(r.SourceFile) {
			return fmt.Errorf("choose an existing live scene to edit")
		}
		if strings.TrimSpace(r.Prompt) == "" || r.AudioFile != "" || len(r.Images) > 0 || len(r.Videos) > 0 || r.Text != "" || r.VisualMode != "" || r.Transparent {
			return fmt.Errorf("scene edits need a prompt and preserve the existing media and narration")
		}
	}
	if strings.TrimSpace(r.Prompt) == "" && strings.TrimSpace(r.Text) == "" && r.AudioFile == "" {
		return fmt.Errorf("describe a scene or choose a voice recording")
	}
	if utf8.RuneCountInString(r.Prompt) > maxPromptRunes {
		return fmt.Errorf("scene prompts must contain at most %d characters", maxPromptRunes)
	}
	if utf8.RuneCountInString(r.Text) > maxPromptRunes {
		return fmt.Errorf("scene text must contain at most %d characters", maxPromptRunes)
	}
	if r.VisualMode != "" && r.VisualMode != "auto" && r.VisualMode != "2d" && r.VisualMode != "3d" {
		return fmt.Errorf("choose automatic, 2D or 3D scene design")
	}
	if !finite(r.Duration) || r.Duration < 1 || r.Duration > maxSceneSeconds {
		return fmt.Errorf("scene length must be between 1 and %d seconds", maxSceneSeconds)
	}
	if r.Width < 2 || r.Height < 2 || r.Width > 1920 || r.Height > 1920 || r.Width%2 != 0 || r.Height%2 != 0 {
		return fmt.Errorf("choose even scene dimensions between 2 and 1920 pixels")
	}
	if !finite(r.FPS) || r.FPS < 1 || r.FPS > 60 {
		return fmt.Errorf("scene frame rate must be between 1 and 60")
	}
	if err := validateImageInputs(r.Images); err != nil {
		return err
	}
	return validateVideoInputs(r.Videos)
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func configFor(r Request, d Definition) Config {
	config := Config{Width: r.Width, Height: r.Height, FPS: r.FPS, Frames: int(math.Ceil((d.End-d.Start)*r.FPS - 1e-9)), Transparent: r.Transparent, VisualMode: r.VisualMode}
	if r.CaptionSafeArea {
		config.CaptionSafeBottom = 0.24
	}
	return config
}

func normalizePlan(plan []Definition, r Request, voiceDuration float64) ([]Definition, error) {
	if len(plan) == 0 || len(plan) > maxScenes {
		return nil, fmt.Errorf("return between 1 and %d scenes", maxScenes)
	}
	if voiceDuration == 0 && len(plan) != 1 {
		return nil, fmt.Errorf("a prompt creates exactly one scene")
	}
	total := voiceDuration
	if total == 0 {
		total = r.Duration
	}
	total = math.Ceil(total*r.FPS) / r.FPS
	start := 0.0
	for i := range plan {
		d := &plan[i]
		if strings.TrimSpace(d.Title) == "" || strings.TrimSpace(d.Brief) == "" || len(d.Title) > 200 || len(d.Brief) > 4000 {
			return nil, fmt.Errorf("scene %d needs a concise title and visual brief", i+1)
		}
		if !finite(d.End) {
			return nil, fmt.Errorf("scene %d has an invalid end time", i+1)
		}
		d.Start, d.End = start, math.Round(d.End*r.FPS)/r.FPS
		if i == len(plan)-1 {
			d.End = total
		}
		if d.End <= start || d.End > total || d.End-start > maxSceneSeconds {
			return nil, fmt.Errorf("scene %d must have an increasing end and last at most %d seconds", i+1, maxSceneSeconds)
		}
		start = d.End
	}
	return plan, nil
}

func relativeCues(cues []subtitles.Cue, d Definition) []subtitles.Cue {
	result := make([]subtitles.Cue, 0)
	for _, cue := range cues {
		if cue.End <= d.Start || cue.Start >= d.End {
			continue
		}
		local := subtitles.Cue{Start: math.Max(0, cue.Start-d.Start), End: math.Min(d.End-d.Start, cue.End-d.Start), Text: cue.Text, Words: []subtitles.CueWord{}}
		for _, word := range cue.Words {
			if word.End <= d.Start || word.Start >= d.End {
				continue
			}
			local.Words = append(local.Words, subtitles.CueWord{Start: math.Max(0, word.Start-d.Start), End: math.Min(d.End-d.Start, word.End-d.Start), Text: word.Text})
		}
		result = append(result, local)
	}
	return result
}
