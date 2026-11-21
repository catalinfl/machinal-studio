package render

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ffmpeg-go-server/internal/utils"
)

const fileInputArgs = 2 // two argv entries per "-i file" input

const (
	audioSampleRate    = "44100"
	audioChannels      = "2"
	audioCodec         = "pcm_f32le"
	timelineGapEps     = 0.01 // gaps below 10ms are rounding noise, not silence
	audioFilterThreads = "2"
)

func buildAudioTrack(clips []clip, work string, totalDur float64, progress *renderProgress, scope fileScope) (string, error) {
	clips = coalesceContinuousAudioClips(clips)
	audioFiles, keptClips, err := extractAudioClips(clips, work, progress, scope)
	if err != nil {
		return "", fmt.Errorf("extract audio clips: %w", err)
	}
	groups, err := buildAudioGroups(keptClips, audioFiles, work, progress)
	if err != nil {
		return "", fmt.Errorf("build audio groups: %w", err)
	}
	pieces, err := buildAudioTimeline(groups, totalDur, work, progress)
	if err != nil {
		return "", fmt.Errorf("build audio timeline: %w", err)
	}
	if len(pieces) == 0 {
		return "", fmt.Errorf("audio track produced no pieces")
	}
	audioFile := filepath.Join(work, "audio_track.w64")
	if err := concatFiles(pieces, audioFile, work, "aclist_all.txt"); err != nil {
		return "", fmt.Errorf("audio concat: %w", err)
	}
	return audioFile, nil
}

func extractAudioClips(clips []clip, work string, progress *renderProgress, scope fileScope) ([]string, []clip, error) {
	audioFiles := make([]string, 0, len(clips))
	keptClips := make([]clip, 0, len(clips))

	for index, clip := range clips {
		sourceDur := clipSourceDur(clip)
		if sourceDur <= 0 {
			continue
		}
		inputPath, err := scope.join(clip.File)
		if err != nil {
			return nil, nil, fmt.Errorf("clip %d resolves outside the session volume: %w", index, err)
		}

		audioFile := filepath.Join(work, fmt.Sprintf("audio_%d.w64", index))
		timelineDuration := clipDurT(clip)
		if err := progress.runFFmpeg(
			timelineDuration,
			timelineDuration*audioWorkFactor,
			fmt.Sprintf("rendering audio clip %d", index+1),
			"-ss", ff(clip.InPoint),
			"-t", ff(sourceDur),
			"-i", inputPath,
			"-vn",
			"-af", audioClipFilter(clip),
			"-c:a", audioCodec,
			"-ar", audioSampleRate,
			"-ac", audioChannels,
			"-y", audioFile,
		); err != nil {
			return nil, nil, fmt.Errorf("ffmpeg audio extract error (clip %d): %w", index, err)
		}

		audioFiles = append(audioFiles, audioFile)
		keptClips = append(keptClips, clip)
	}

	return audioFiles, keptClips, nil
}

func buildAudioGroups(clips []clip, audioFiles []string, work string, progress *renderProgress) ([]trackGroup, error) {
	clipGroups := groupOverlapping(clips)
	groups := make([]trackGroup, 0, len(clipGroups))
	for groupIndex, indices := range clipGroups {
		groupClips := clips[indices[0] : indices[1]+1]
		if len(groupClips) == 1 {
			groups = append(groups,
				trackGroup{
					file:  audioFiles[indices[0]],
					start: groupClips[0].Start,
					dur:   clipDurT(groupClips[0]),
				})
			continue
		}

		out, err := acrossfadeGroup(groupClips, audioFiles[indices[0]:indices[1]+1], work, groupIndex, progress)
		if err != nil {
			return nil, fmt.Errorf("acrossfade group %d: %w", groupIndex, err)
		}

		groups = append(groups,
			trackGroup{
				file:  out,
				start: groupClips[0].Start,
				dur:   clipEndT(groupClips[len(groupClips)-1]) - groupClips[0].Start,
			})
	}
	return groups, nil
}

func buildAudioTimeline(groups []trackGroup, totalDur float64, work string, progress *renderProgress) ([]string, error) {

	pieces := make([]string, 0, len(groups)*2+1)
	cursor := 0.0
	silenceIndex := 0

	addSilence := func(duration float64) error {
		silence := filepath.Join(work, fmt.Sprintf("silence_%d.w64", silenceIndex))
		silenceIndex++
		if err := generateSilence(duration, silence, progress); err != nil {
			return err
		}
		pieces = append(pieces, silence)
		return nil
	}

	for _, group := range groups {
		if gap := group.start - cursor; gap > timelineGapEps {
			if err := addSilence(gap); err != nil {
				return nil, fmt.Errorf("fill audio gap: %w", err)
			}
		}

		pieces = append(pieces, group.file)
		if end := group.start + group.dur; end > cursor {
			cursor = end
		}
	}

	if gap := totalDur - cursor; gap > timelineGapEps {
		if err := addSilence(gap); err != nil {
			return nil, fmt.Errorf("fill trailing audio gap: %w", err)
		}
	}
	return pieces, nil
}

// acrossfadeGroup crossfades overlapping clips within one channel.
func acrossfadeGroup(clips []clip, files []string, work string, index int, progress *renderProgress) (string, error) {
	args := []string{}
	for _, file := range files {
		args = append(args, "-i", file)
	}
	filters := make([]string, 0, len(clips)*fileInputArgs)
	for i := range files {
		filters = append(filters, fmt.Sprintf(
			`[%d:a]asettb=AVTB,
			asetpts=PTS-STARTPTS[a%d]`, i, i))
	}

	current := "[a0]"
	accumulatedDuration := clipDurT(clips[0])
	for i := 1; i < len(clips); i++ {
		overlap := clampTransitionOverlap(clipEndT(clips[i-1])-clips[i].Start, clipDurT(clips[i]), accumulatedDuration)

		output := fmt.Sprintf("[ax%d]", i)
		filters = append(filters, fmt.Sprintf("%s[a%d]acrossfade=d=%s%s", current, i, ff(overlap), output))
		current = output
		accumulatedDuration += clipDurT(clips[i]) - overlap
	}

	out := filepath.Join(work, fmt.Sprintf("agroup_%d.w64", index))
	args = append(args,
		"-filter_complex_threads", audioFilterThreads,
		"-filter_complex", strings.Join(filters, ";"),
		"-map", current,
		"-c:a", audioCodec,
		"-ar", audioSampleRate,
		"-ac", audioChannels,
		"-y", out,
	)
	message := fmt.Sprintf("rendering audio transition group %d", index+1)
	if err := progress.runFFmpeg(accumulatedDuration, accumulatedDuration*audioWorkFactor, message, args...); err != nil {
		return "", fmt.Errorf("ffmpeg acrossfade group: %w", err)
	}
	return out, nil
}

// mixAudioChannels sums independent timeline channels after their local
// acrossfades have been applied.
func mixAudioChannels(files []string, totalDuration float64, work string, progress *renderProgress) (string, error) {
	if len(files) == 0 {
		return "", fmt.Errorf("audio channels produced no files")
	}
	if len(files) == 1 {
		return files[0], nil
	}

	const mixFixedArgs = 18 // 9 option pairs below: filter threads, graph, map, codec, rate, channels, threads, overwrite

	args := make([]string, 0, len(files)*fileInputArgs+mixFixedArgs)
	filters := make([]string, 0, len(files)+1)
	inputs := make([]string, 0, len(files))

	for i, file := range files {
		args = append(args, "-i", file)
		label := fmt.Sprintf("[a%d]", i)
		filters = append(filters,
			fmt.Sprintf("[%d:a]asetpts=PTS-STARTPTS%s",
				i, label))
		inputs = append(inputs, label)
	}
	filters = append(filters, fmt.Sprintf("%samix=inputs=%d:duration=longest:dropout_transition=0:normalize=0[a]", strings.Join(inputs, ""), len(files)))

	out := filepath.Join(work, "audio_mix.w64")
	args = append(args,
		"-filter_complex_threads", audioFilterThreads,
		"-filter_complex", strings.Join(filters, ";"),
		"-map", "[a]",
		"-c:a", audioCodec,
		"-ar", audioSampleRate,
		"-ac", audioChannels,
		"-threads", audioFilterThreads,
		"-y", out,
	)
	if err := progress.runFFmpeg(totalDuration, totalDuration*audioWorkFactor, "mixing audio channels", args...); err != nil {
		return "", fmt.Errorf("ffmpeg audio mix: %w", err)
	}
	return out, nil
}

func generateSilence(duration float64, out string, progress *renderProgress) error {
	return progress.runFFmpeg(duration, duration*silenceWorkFactor, "rendering silence",
		"-f", "lavfi",
		"-i", "anullsrc=r="+audioSampleRate+":cl=stereo",
		"-t", ff(duration),
		"-c:a", audioCodec,
		"-ar", audioSampleRate,
		"-ac", audioChannels,
		"-y", out)
}

func muxVideoAudio(videoFile, audioFile, out string, totalDuration float64, output outputSettings, progress *renderProgress) error {
	args := []string{"-i", videoFile, "-i", audioFile, "-map", "0:v:0", "-map", "1:a:0"}
	args = append(args, output.videoEncodingArgs()...)
	args = append(args, output.audioEncodingArgs()...)
	args = append(args, "-y", out)
	if err := progress.runFFmpeg(totalDuration, totalDuration, "finalizing "+strings.ToUpper(output.format)+" video and audio", args...); err != nil {
		return fmt.Errorf("ffmpeg mux: %w", err)
	}
	return nil
}

// encodeAudio performs the final lossy audio encode.
func encodeAudio(src, dst string, totalDuration float64, output outputSettings, progress *renderProgress) error {
	args := []string{"-i", src, "-map", "0:a:0", "-vn"}
	args = append(args, output.audioEncodingArgs()...)
	args = append(args, "-y", dst)
	if err := progress.runFFmpeg(totalDuration, totalDuration*finalAudioWorkFactor, "finalizing "+strings.ToUpper(output.format)+" audio", args...); err != nil {
		return fmt.Errorf("ffmpeg final audio encode: %w", err)
	}
	return nil
}

// concatFiles joins files with the concat demuxer. Inputs must share codec parameters.
func concatFiles(files []string, out, work, listName string) error {
	// Intermediates are immutable and share a work filesystem. A one-piece
	// timeline needs neither another FFmpeg process nor another media copy.
	if len(files) == 1 && filepath.Ext(files[0]) == filepath.Ext(out) {
		if err := os.Link(files[0], out); err == nil {
			return nil
		}
	}
	listPath := filepath.Join(work, listName)
	var content []byte
	for _, file := range files {
		// Escape single quotes per ffmpeg concat docs: ' -> '\''.
		// All files here are server-generated work/*.w64 paths, but escaping
		// keeps future callers safe if a quote ever flows in.
		escaped := strings.ReplaceAll(file, `'`, `'\\''`)
		content = fmt.Appendf(content, "file '%s'\n", escaped)
	}
	if err := os.WriteFile(listPath, content, 0o644); err != nil {
		return fmt.Errorf("write concat list %s: %w", listName, err)
	}
	if err := utils.RunFFmpeg(
		"-f", "concat",
		"-safe", "0",
		"-i", listPath,
		"-c", "copy",
		"-y", out); err != nil {
		return fmt.Errorf("ffmpeg concat %s: %w", listName, err)
	}
	return nil
}
