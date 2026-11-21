package render

import "fmt"

const (
	outputMP4 = "mp4"
	outputAVI = "avi"
	outputMP3 = "mp3"
)

const (
	qualityLow    = "low"
	qualityNormal = "normal"
	qualityHigh   = "high"
)

const (
	audioBitrateLow    = "96k"  // speech remains intelligible at small sizes
	audioBitrateNormal = "160k" // transparent for mixed timelines
	audioBitrateHigh   = "256k" // near-lossless for music-heavy exports
)

const (
	mp4QualityLow    = "30"
	mp4QualityNormal = "23"
	mp4QualityHigh   = "18"
	aviQualityLow    = "8"
	aviQualityNormal = "5"
	aviQualityHigh   = "2"
)

const (
	audioSampleRateHz = "44100" // FFmpeg aac/mp3 default; matches the PCM timeline
	audioChannelCount = "2"
)

func normalizeOutputRequest(req renderRequest) (renderRequest, error) {
	settings, err := parseOutputSettings(req.Format, req.Quality)
	if err != nil {
		return renderRequest{}, err
	}
	req.Format = settings.format
	req.Quality = settings.quality
	if settings.audioOnly {
		req.VideoChannels = nil
		req.TextItems = nil
	}
	return req, nil
}

func parseOutputSettings(format, quality string) (outputSettings, error) {
	if format == "" {
		format = outputMP4
	}
	if quality == "" {
		quality = qualityNormal
	}

	settings := outputSettings{format: format, quality: quality, extension: format}
	switch quality {
	case qualityLow:
		settings.audioBitrate = audioBitrateLow
	case qualityNormal:
		settings.audioBitrate = audioBitrateNormal
	case qualityHigh:
		settings.audioBitrate = audioBitrateHigh
	default:
		return outputSettings{}, fmt.Errorf("unsupported export quality: %s", quality)
	}

	switch format {
	case outputMP4:
		var err error
		settings.videoEncoder, settings.videoPreset, err = exportEncoding()
		if err != nil {
			return outputSettings{}, err
		}
		switch quality {
		case qualityLow:
			settings.videoQuality = mp4QualityLow
		case qualityNormal:
			settings.videoQuality = mp4QualityNormal
		case qualityHigh:
			settings.videoQuality = mp4QualityHigh
		}
	case outputAVI:
		switch quality {
		case qualityLow:
			settings.videoQuality = aviQualityLow
		case qualityNormal:
			settings.videoQuality = aviQualityNormal
		case qualityHigh:
			settings.videoQuality = aviQualityHigh
		}
	case outputMP3:
		settings.audioOnly = true
	default:
		return outputSettings{}, fmt.Errorf("unsupported export format: %s", format)
	}
	return settings, nil
}

func (settings outputSettings) videoEncodingArgs() []string {
	if settings.format == outputAVI {
		return []string{"-c:v", "mpeg4", "-q:v", settings.videoQuality}
	}
	if settings.videoEncoder == "h264_nvenc" {
		return []string{"-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", settings.videoQuality, "-b:v", "0", "-multipass", "fullres", "-pix_fmt", "yuv420p"}
	}
	preset := settings.videoPreset
	if preset == "" {
		preset = "medium"
	}
	return []string{"-c:v", "libx264", "-preset", preset, "-crf", settings.videoQuality, "-pix_fmt", "yuv420p", "-threads", videoThreadCount()}
}

func (settings outputSettings) audioEncodingArgs() []string {
	codec := "libmp3lame"
	if settings.format == outputMP4 {
		codec = "aac"
	}
	return []string{"-c:a", codec, "-b:a", settings.audioBitrate, "-ar", audioSampleRateHz, "-ac", audioChannelCount}
}
