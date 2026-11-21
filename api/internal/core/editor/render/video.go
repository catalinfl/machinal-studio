package render

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"ffmpeg-go-server/editengine/document"
)

var customXfadeExpressions = map[string]string{
	"custom-whip-left":      `min(255,if(lt(X/W,P),B,A)+if(eq(PLANE,0),42*exp(-pow(X/W-P,2)/0.0025)*sin(PI*P),0))`,
	"custom-whip-right":     `min(255,if(gt(X/W,1-P),B,A)+if(eq(PLANE,0),42*exp(-pow(X/W-(1-P),2)/0.0025)*sin(PI*P),0))`,
	"custom-whip-up":        `min(255,if(lt(Y/H,P),B,A)+if(eq(PLANE,0),42*exp(-pow(Y/H-P,2)/0.0025)*sin(PI*P),0))`,
	"custom-whip-down":      `min(255,if(gt(Y/H,1-P),B,A)+if(eq(PLANE,0),42*exp(-pow(Y/H-(1-P),2)/0.0025)*sin(PI*P),0))`,
	"custom-zoom-blur-in":   `min(255,if(lt(hypot(X-W/2,Y-H/2)/hypot(W/2,H/2),P),B,(1-P)*A+P*B)+if(eq(PLANE,0),24*sin(PI*P),0))`,
	"custom-zoom-blur-out":  `min(255,if(gt(hypot(X-W/2,Y-H/2)/hypot(W/2,H/2),1-P),B,(1-P)*A+P*B)+if(eq(PLANE,0),20*sin(PI*P),0))`,
	"custom-spin-zoom":      `if(lt(mod(atan2(Y-H/2,X-W/2)/(2*PI)+P+1,1),P),B,(1-P)*A+P*B)`,
	"custom-camera-roll":    `if(lt(mod(atan2(Y-H/2,X-W/2)/(2*PI)+0.5,1),P),B,A)`,
	"custom-lens-warp":      `if(lt(abs(hypot(X-W/2,Y-H/2)/hypot(W/2,H/2)-P),0.12),min(255,((1-P)*A+P*B)+if(eq(PLANE,0),36*sin(PI*P),0)),if(lt(hypot(X-W/2,Y-H/2)/hypot(W/2,H/2),P),B,A))`,
	"custom-stretch-h":      `if(lt(abs(X/W-0.5),P/2),B,(1-P)*A+P*B)`,
	"custom-stretch-v":      `if(lt(abs(Y/H-0.5),P/2),B,(1-P)*A+P*B)`,
	"custom-ripple":         `if(lt(X/W+0.045*sin(Y/H*10*PI+P*8*PI),P),B,A)`,
	"custom-liquid":         `if(lt(Y/H+0.035*sin(X/W*7*PI+P*5*PI)+0.02*sin(X/W*17*PI-P*9*PI),P),B,A)`,
	"custom-kaleidoscope":   `if(lt(mod(abs(X-W/2)+abs(Y-H/2),max(1,min(W,H)/6))/(max(1,min(W,H)/6)),P),B,A)`,
	"custom-rgb-split":      `if(eq(PLANE,0),(1-min(1,P*1.25))*A+min(1,P*1.25)*B,if(eq(PLANE,1),(1-max(0,min(1,P*1.25-0.12)))*A+max(0,min(1,P*1.25-0.12))*B,(1-max(0,min(1,P*1.25-0.24)))*A+max(0,min(1,P*1.25-0.24))*B))`,
	"custom-digital-glitch": `if(lt(mod(Y+floor(P*18)*37,96),18+34*sin(P*PI)),if(gt(sin(X*0.19+Y*0.37+P*91),0),B,A),(1-P)*A+P*B)`,
	"custom-vhs-tracking":   `max(0,min(255,if(lt(X/W+0.04*sin(Y/9+P*32),P),B,A)+if(eq(PLANE,0),10*sin(Y*PI/2)*sin(PI*P),0)))`,
	"custom-datamosh":       `if(lt(mod(floor(X/24)+floor(Y/18)*3+floor(P*20),10)/10,P),B,(0.82-P*0.25)*A+(0.18+P*0.25)*B)`,
	"custom-tv-static":      `if(lt(abs(P-0.5),0.18),if(gt(sin(X*12.9898+Y*78.233+P*43758.5),0),if(eq(PLANE,0),235,128),if(eq(PLANE,0),16,128)),if(lt(P,0.5),A,B))`,
	"custom-scanline":       `if(lt(mod(Y,8)/8+floor(Y/8)/(H/8),P*2),B,A)`,
	"custom-pixel-sort":     `if(lt((X/W)*0.35+(Y/H)*0.35+A/255*0.3,P),B,A)`,
	// xfade custom runs on yuv420p inputs (PLANE 0=Y,1=U,2=V) while the Pixi
	// preview adds leaks in RGB. The warm RGB leaks (95,52,18) and (110,48,8)
	// are expressed here as BT.601 limited-range YUV offsets so the export
	// renders the same orange instead of a blue-shifted purple.
	"custom-light-leak":   `max(0,min(255,(1-P)*A+P*B+if(eq(PLANE,0),52.37,if(eq(PLANE,1),-21.31,21.31))*exp(-pow(P-0.5,2)/0.035)))`,
	"custom-film-burn":    `max(0,min(255,if(lt(X/W+0.08*sin(Y/H*13+P*17),P),B,A)+if(eq(PLANE,0),53.23,if(eq(PLANE,1),-26.76,30.09))*exp(-pow(X/W-P,2)/0.018)))`,
	"custom-flash-bulb":   `min(255,(1-P)*A+P*B+if(eq(PLANE,0),210*exp(-pow(P-0.5,2)/0.012),0))`,
	"custom-luma-fade":    `if(lt(A/255,P),B,A)`,
	"custom-chroma-fade":  `if(lt(P+0.16*sin(PLANE*2.1),0.5),(1-P)*A+P*B,if(lt(A/255,P),B,A))`,
	"custom-ink-bleed":    `if(lt((sin(X*0.041)+sin(Y*0.053)+sin((X+Y)*0.021)+3)/6,P),B,A)`,
	"custom-page-turn":    `min(255,if(lt(X/W+Y/H,P*2),B,A)+if(eq(PLANE,0),34*exp(-pow(X/W+Y/H-P*2,2)/0.012)*sin(PI*P),0))`,
	"custom-split-panels": `if(lt(abs(mod(X/(W/4),2)-1),P),B,A)`,
	"custom-shutter-snap": `if(lt(P,0.5),if(lt(abs(Y/H-0.5),(0.5-P)*2),A,if(eq(PLANE,0),16,128)),if(lt(abs(Y/H-0.5),(P-0.5)*2),B,if(eq(PLANE,0),16,128)))`,
}

var xfadeProgressPattern = regexp.MustCompile(`\bP\b`)

// xfadeNames is the whitelist of FFmpeg xfade transitions exposed by the editor.
var xfadeNames = func() map[string]bool {
	names := map[string]bool{
		"fade": true, "fadefast": true, "fadeslow": true,
		"fadeblack": true, "fadewhite": true, "fadegrays": true, "hblur": true,
		"dissolve": true, "distance": true, "pixelize": true,
		"wipeleft": true, "wiperight": true, "wipeup": true, "wipedown": true,
		"smoothleft": true, "smoothright": true, "smoothup": true, "smoothdown": true, "radial": true,
		"diagtl": true, "diagtr": true, "diagbl": true, "diagbr": true,
		"wipetl": true, "wipetr": true, "wipebl": true, "wipebr": true,
		"hlslice": true, "hrslice": true, "vuslice": true, "vdslice": true,
		"circleopen": true, "circleclose": true, "circlecrop": true, "rectcrop": true,
		"vertopen": true, "vertclose": true, "horzopen": true, "horzclose": true,
		"slideleft": true, "slideright": true, "slideup": true, "slidedown": true,
		"squeezeh": true, "squeezev": true, "zoomin": true,
	}
	for name := range customXfadeExpressions {
		names[name] = true
	}
	return names
}()

func sanitizeXfade(name string) string {
	if xfadeNames[name] {
		return name
	}
	return "fade"
}

func xfadeFilter(name string) string {
	safeName := sanitizeXfade(name)
	if expression := customXfadeExpressions[safeName]; expression != "" {
		// Catalog expressions use forward timeline progress. FFmpeg 5.1 exposes
		// xfade P in reverse, from 1 at input A to 0 at input B.
		expression = xfadeProgressPattern.ReplaceAllString(expression, "(1-P)")
		return fmt.Sprintf("transition=custom:expr='%s'", expression)
	}
	return "transition=" + safeName
}

// generateBlackVideoWithWork creates video-only black frames matching regular pieces.
func generateBlackVideoWithWork(duration float64, w, h, fps int, out string, workWeight float64, message string, progress *renderProgress) error {
	if err := progress.runFFmpeg(duration, workWeight, message,
		"-f", "lavfi", "-i", fmt.Sprintf("color=c=black:s=%dx%d:r=%d", w, h, fps), "-t", ff(duration),
		"-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt, "-an", "-threads", videoThreadCount(), "-y", out,
	); err != nil {
		return fmt.Errorf("ffmpeg black: %w", err)
	}
	return nil
}

const transitionEps = 0.05        // overlaps below 50ms are cuts, not xfade transitions
const audioContinuityEps = 0.0001 // sample-accurate continuity for coalesced audio
const maxTextOverlaysPerPass = 24 // bounds -filter_complex length per ffmpeg invocation

// videoGapEps ignores sub-frame timeline rounding when filling black gaps.
const videoGapEps = 0.01

const (
	videoCodec  = "libx264"
	videoPreset = "ultrafast"
	// Only the delivery encode may discard detail; intermediate passes are lossless.
	videoCrf    = "0"
	videoPixFmt = "yuv444p"
	// Keep simultaneous 4K filter graphs within the container's memory budget.
	maxVideoThreads  = 8
	maxFilterThreads = 4
)

func videoThreadCount() string {
	return strconv.Itoa(min(maxVideoThreads, runtime.GOMAXPROCS(0)))
}

func filterThreadCount() string {
	return strconv.Itoa(min(maxFilterThreads, runtime.GOMAXPROCS(0)))
}

func coalesceContinuousAudioClips(clips []clip) []clip {
	// A visual cut must not create a new decoder/encoder boundary in unchanged audio.
	ordered := append([]clip(nil), clips...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Start < ordered[j].Start })
	merged := make([]clip, 0, len(ordered))
	for _, clip := range ordered {
		if len(merged) == 0 {
			merged = append(merged, clip)
			continue
		}
		previous := &merged[len(merged)-1]
		isContinuous := previous.File == clip.File &&
			previous.MediaKind == clip.MediaKind &&
			math.Abs(clipEndT(*previous)-clip.Start) <= audioContinuityEps &&
			math.Abs(previous.OutPoint-clip.InPoint) <= audioContinuityEps &&
			clipPlaybackRate(*previous) == clipPlaybackRate(clip) &&
			audioClipGain(*previous) == audioClipGain(clip)
		if isContinuous {
			previous.OutPoint = clip.OutPoint
		} else {
			merged = append(merged, clip)
		}
	}
	return merged
}

// trackGroup is a run of clips rendered into one file.
type trackGroup struct {
	file  string
	start float64
	dur   float64
}

// groupOverlapping splits sorted clips into runs connected by edge overlaps.
func groupOverlapping(clips []clip) [][2]int {
	groups := make([][2]int, 0, len(clips))
	for i := 0; i < len(clips); {
		j := i
		for j+1 < len(clips) && clipEndT(clips[j])-transitionEps > clips[j+1].Start {
			j++
		}
		groups = append(groups, [2]int{i, j})
		i = j + 1
	}
	return groups
}

func segmentInputArgs(seg segment, mediaKind string) []string {
	duration := seg.SrcEnd - seg.SrcStart
	if mediaKind == "image" {
		return []string{"-loop", "1", "-t", ff(duration)}
	}
	return []string{"-ss", ff(seg.SrcStart), "-t", ff(duration)}
}

func clipInputArgs(clip clip, inputPath string) []string {
	duration := clipSourceDur(clip)
	if clip.MediaKind == "image" {
		return []string{"-loop", "1", "-t", ff(duration), "-i", inputPath}
	}
	args := []string{"-ss", ff(clip.InPoint), "-t", ff(duration)}
	args = append(args, sceneDecoderArgs(clip)...)
	return append(args, "-i", inputPath)
}

// buildVideoTrack processes video clips, applies effects and transitions, and
// fills timeline gaps with black frames.
func buildVideoTrack(clips []clip, w, h, fps int, work string, totalDur float64, xfadeByRight map[int]string, progress *renderProgress, scope fileScope, fit document.VideoFit) (string, error) {
	clipFiles, err := renderVideoSegments(clips, w, h, fps, work, progress, scope, fit)
	if err != nil {
		return "", err
	}

	clipGroups := groupOverlapping(clips)
	groups := make([]trackGroup, 0, len(clipGroups))
	for groupIndex, indices := range clipGroups {
		groupClips := clips[indices[0] : indices[1]+1]
		if len(groupClips) == 1 {
			groups = append(groups, trackGroup{file: clipFiles[indices[0]], start: groupClips[0].Start, dur: clipDurT(groupClips[0])})
			continue
		}
		out, err := xfadeGroup(groupClips, clipFiles[indices[0]:indices[1]+1], fps, work, groupIndex, indices[0], xfadeByRight, progress)
		if err != nil {
			return "", fmt.Errorf("video xfade group %d: %w", groupIndex, err)
		}
		groups = append(groups, trackGroup{file: out, start: groupClips[0].Start, dur: clipEndT(groupClips[len(groupClips)-1]) - groupClips[0].Start})
	}

	pieces := make([]string, 0, len(groups)*2+1)
	cursor := 0.0
	blackIndex := 0
	addBlack := func(duration float64) error {
		black := filepath.Join(work, fmt.Sprintf("black_%d.mp4", blackIndex))
		blackIndex++
		if err := generateBlackVideoWithWork(duration, w, h, fps, black, duration, "rendering black video", progress); err != nil {
			return err
		}
		pieces = append(pieces, black)
		return nil
	}
	for _, group := range groups {
		if gap := group.start - cursor; gap > videoGapEps {
			if err := addBlack(gap); err != nil {
				return "", fmt.Errorf("fill video gap: %w", err)
			}
		}
		pieces = append(pieces, group.file)
		if end := group.start + group.dur; end > cursor {
			cursor = end
		}
	}
	if gap := totalDur - cursor; gap > videoGapEps {
		if err := addBlack(gap); err != nil {
			return "", fmt.Errorf("fill trailing video gap: %w", err)
		}
	}

	videoFile := filepath.Join(work, "video_track.mp4")
	if err := concatFiles(pieces, videoFile, work, "vclist_all.txt"); err != nil {
		return "", fmt.Errorf("final video concat: %w", err)
	}
	return videoFile, nil
}

func videoMaskFilter(clip clip, w, h, fps int, fit document.VideoFit) string {
	duration := clipDurT(clip)
	frameCount := videoSegmentFrameCount(clip, segment{SrcStart: clip.InPoint, SrcEnd: clip.OutPoint}, fps)
	filters := []string{
		"setpts=(PTS-STARTPTS)/" + ff(clipPlaybackRate(clip)),
		"format=rgba",
		"alphaextract",
		videoFitFilter(w, h, fit, "black"),
		"fps=" + strconv.Itoa(fps),
	}
	if transformFilter := clipTransformFilter(clip, w, h, 0, duration, fps); transformFilter != "" {
		filters = append(filters, transformFilter)
	}
	if opacity := clipVisualOpacity(clip); opacity < 1 {
		filters = append(filters, fmt.Sprintf("lut=y='val*%s'", ff(opacity)))
	}
	if fadeIn := clipFadeInDuration(clip); fadeIn > 0 {
		filters = append(filters, fmt.Sprintf("fade=t=in:st=0:d=%s:color=black", ff(fadeIn)))
	}
	if fadeOut := clipFadeOutDuration(clip); fadeOut > 0 {
		filters = append(filters, fmt.Sprintf("fade=t=out:st=%s:d=%s:color=black", ff(duration-fadeOut), ff(fadeOut)))
	}
	filters = append(filters, exactVideoFrameFilter(fps, frameCount))
	return strings.Join(filters, ",")
}

func buildVideoMaskTrack(clips []clip, w, h, fps int, work string, totalDur float64, xfadeByRight map[int]string, progress *renderProgress, scope fileScope, fit document.VideoFit) (string, error) {
	maskWork := filepath.Join(work, "alpha_mask")
	if err := os.Mkdir(maskWork, 0o700); err != nil {
		return "", fmt.Errorf("cannot create alpha mask work dir: %w", err)
	}

	clipFiles := make([]string, 0, len(clips))
	for index, clip := range clips {
		inputPath, err := scope.join(clip.File)
		if err != nil {
			return "", fmt.Errorf("resolve alpha mask source for clip %d: %w", index, err)
		}
		output := filepath.Join(maskWork, fmt.Sprintf("mask_clip_%d.mp4", index))
		inputArgs := clipInputArgs(clip, inputPath)
		duration := clipDurT(clip)
		args := append(inputArgs,
			"-vf", videoMaskFilter(clip, w, h, fps, fit),
			"-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt,
			"-an", "-r", strconv.Itoa(fps), "-threads", videoThreadCount(), "-y", output,
		)
		if err := progress.runFFmpeg(duration, duration*videoMaskWorkFactor, fmt.Sprintf("rendering video clip %d alpha mask", index+1), args...); err != nil {
			return "", fmt.Errorf("ffmpeg alpha mask error (clip %d): %w", index, err)
		}
		clipFiles = append(clipFiles, output)
	}

	clipGroups := groupOverlapping(clips)
	groups := make([]trackGroup, 0, len(clipGroups))
	for groupIndex, indices := range clipGroups {
		groupClips := clips[indices[0] : indices[1]+1]
		if len(groupClips) == 1 {
			groups = append(groups, trackGroup{file: clipFiles[indices[0]], start: groupClips[0].Start, dur: clipDurT(groupClips[0])})
			continue
		}
		out, err := xfadeGroup(groupClips, clipFiles[indices[0]:indices[1]+1], fps, maskWork, groupIndex, indices[0], xfadeByRight, progress, videoMaskWorkFactor)
		if err != nil {
			return "", fmt.Errorf("mask xfade group %d: %w", groupIndex, err)
		}
		groups = append(groups, trackGroup{file: out, start: groupClips[0].Start, dur: clipEndT(groupClips[len(groupClips)-1]) - groupClips[0].Start})
	}

	pieces := make([]string, 0, len(groups)*2+1)
	cursor := 0.0
	blackIndex := 0
	addBlack := func(duration float64) error {
		black := filepath.Join(maskWork, fmt.Sprintf("black_%d.mp4", blackIndex))
		blackIndex++
		if err := generateBlackVideoWithWork(duration, w, h, fps, black, duration*videoMaskWorkFactor, "rendering alpha mask gap", progress); err != nil {
			return err
		}
		pieces = append(pieces, black)
		return nil
	}
	for _, group := range groups {
		if gap := group.start - cursor; gap > videoGapEps {
			if err := addBlack(gap); err != nil {
				return "", fmt.Errorf("fill mask gap: %w", err)
			}
		}
		pieces = append(pieces, group.file)
		if end := group.start + group.dur; end > cursor {
			cursor = end
		}
	}
	if gap := totalDur - cursor; gap > videoGapEps {
		if err := addBlack(gap); err != nil {
			return "", fmt.Errorf("fill trailing mask gap: %w", err)
		}
	}

	maskFile := filepath.Join(maskWork, "video_mask_track.mp4")
	if err := concatFiles(pieces, maskFile, maskWork, "mask_list_all.txt"); err != nil {
		return "", fmt.Errorf("final alpha mask concat: %w", err)
	}
	return maskFile, nil
}

func xfadeGroup(clips []clip, files []string, fps int, work string, index int, globalStart int, xfadeByRight map[int]string, progress *renderProgress, workFactor ...float64) (string, error) {
	args := []string{}
	for _, file := range files {
		args = append(args, "-i", file)
	}
	filters := make([]string, 0, len(clips)*2)
	for i := range files {
		filters = append(filters, fmt.Sprintf("[%d:v]settb=AVTB,setpts=PTS-STARTPTS,fps=%d,format=rgb24,format=yuv444p[v%d]", i, fps, i))
	}

	currentVideo := "[v0]"
	accumulatedDuration := clipDurT(clips[0])
	for i := 1; i < len(clips); i++ {
		overlap := clampTransitionOverlap(clipEndT(clips[i-1])-clips[i].Start, clipDurT(clips[i]), accumulatedDuration)
		offset := accumulatedDuration - overlap
		outputVideo := fmt.Sprintf("[vx%d]", i)
		filters = append(filters, fmt.Sprintf("%s[v%d]xfade=%s:duration=%s:offset=%s%s", currentVideo, i, xfadeFilter(xfadeByRight[globalStart+i]), ff(overlap), ff(offset), outputVideo))
		currentVideo = outputVideo
		accumulatedDuration += clipDurT(clips[i]) - overlap
	}

	out := filepath.Join(work, fmt.Sprintf("xgroup_%d.mp4", index))
	args = append(args,
		"-filter_complex_threads", filterThreadCount(), "-filter_complex", strings.Join(filters, ";"), "-map", currentVideo,
		"-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt,
		"-r", strconv.Itoa(fps), "-an", "-threads", videoThreadCount(), "-y", out,
	)
	message := fmt.Sprintf("rendering video transition group %d", index+1)
	weight := accumulatedDuration
	if len(workFactor) > 0 {
		weight *= workFactor[0]
	}
	if err := progress.runFFmpeg(accumulatedDuration, weight, message, args...); err != nil {
		return "", fmt.Errorf("ffmpeg xfade group: %w", err)
	}
	return out, nil
}

func channelActiveExpression(clips []clip) string {
	intervals := make([][2]float64, 0, len(clips))
	for _, clip := range clips {
		start, end := clip.Start, clipEndT(clip)
		if end <= start {
			continue
		}
		if len(intervals) > 0 && start <= intervals[len(intervals)-1][1] {
			if end > intervals[len(intervals)-1][1] {
				intervals[len(intervals)-1][1] = end
			}
			continue
		}
		intervals = append(intervals, [2]float64{start, end})
	}
	parts := make([]string, 0, len(intervals))
	for _, interval := range intervals {
		parts = append(parts, fmt.Sprintf("between(t,%s,%s)", ff(interval[0]), ff(interval[1])))
	}
	return strings.Join(parts, "+")
}

func compositeVideoChannels(files, maskFiles []string, channels []channel, w, h, fps int, totalDuration float64, work string, progress *renderProgress) (string, error) {
	if len(files) == 0 {
		return "", fmt.Errorf("video channels produced no files")
	}
	if len(maskFiles) != len(files) || len(channels) != len(files) {
		return "", fmt.Errorf("video channel composites are incomplete")
	}

	current := files[0]
	// Overlay output follows its main input, not the longest layer. Pad ended
	// base footage with black so a longer image cannot be truncated at base EOF.
	frameCount := max(1, int(math.Round(totalDuration*float64(fps))))
	baseFilter := fmt.Sprintf("[0:v]setpts=PTS-STARTPTS,fps=%d,tpad=stop_mode=add:stop=-1,trim=end_frame=%d,setpts=N/(%d*TB)[base];", fps, frameCount, fps)
	if channelNeedsBaseMask(channels[0]) {
		out := filepath.Join(work, "video_composite_base.mp4")
		filter := baseFilter + "[1:v]setpts=PTS-STARTPTS[top];[2:v]setpts=PTS-STARTPTS,format=gray[mask];[top][mask]alphamerge[layer];[base][layer]overlay=eof_action=pass:format=auto[v]"
		args := []string{
			"-f", "lavfi", "-i", fmt.Sprintf("color=c=black:s=%dx%d:r=%d:d=%s", w, h, fps, ff(totalDuration)),
			"-i", current, "-i", maskFiles[0], "-filter_complex_threads", filterThreadCount(), "-filter_complex", filter,
			"-map", "[v]", "-t", ff(totalDuration), "-an", "-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt,
			"-r", strconv.Itoa(fps), "-s", fmt.Sprintf("%dx%d", w, h), "-threads", videoThreadCount(), "-y", out,
		}
		if err := progress.runFFmpeg(totalDuration, totalDuration, "compositing base video channel", args...); err != nil {
			return "", fmt.Errorf("ffmpeg base video composite: %w", err)
		}
		current = out
	}
	for i := 1; i < len(files); i++ {
		enable := channelActiveExpression(channels[i].Clips)
		if enable == "" {
			continue
		}
		out := filepath.Join(work, fmt.Sprintf("video_composite_%d.mp4", i))
		filter := baseFilter + fmt.Sprintf("[1:v]setpts=PTS-STARTPTS[top];[2:v]setpts=PTS-STARTPTS,format=gray[mask];[top][mask]alphamerge[layer];[base][layer]overlay=eof_action=pass:format=auto:enable='%s'[v]", enable)
		args := []string{
			"-i", current, "-i", files[i], "-i", maskFiles[i], "-filter_complex_threads", filterThreadCount(), "-filter_complex", filter,
			"-map", "[v]", "-an", "-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt,
			"-r", strconv.Itoa(fps), "-s", fmt.Sprintf("%dx%d", w, h), "-threads", videoThreadCount(), "-y", out,
		}
		message := fmt.Sprintf("compositing video channel %d", i+1)
		if err := progress.runFFmpeg(totalDuration, totalDuration, message, args...); err != nil {
			return "", fmt.Errorf("ffmpeg video composite: %w", err)
		}
		current = out
	}
	return current, nil
}

type textOverlayChunk struct {
	startFrame  int
	endFrame    int
	itemIndices []int
}

func overlayTextItems(input string, items []textItem, w, h, fps int, totalDur float64, work string, progress *renderProgress) (string, error) {
	imageFiles := make([]string, len(items))
	for index, item := range items {
		imageFiles[index] = filepath.Join(work, fmt.Sprintf("text_%d.png", index))
		if err := os.WriteFile(imageFiles[index], item.data, 0o600); err != nil {
			return "", fmt.Errorf("write text image: %w", err)
		}
	}

	chunks := planTextOverlayChunks(items, fps, totalDur, maxTextOverlaysPerPass)
	if len(chunks) == 0 {
		return input, nil
	}

	chunkFiles, err := renderTextChunks(input, imageFiles, items, chunks, w, h, fps, work, progress)
	if err != nil {
		return "", err
	}

	out := filepath.Join(work, "text_overlay.mp4")
	if err := concatFiles(chunkFiles, out, work, "text_overlay_list.txt"); err != nil {
		return "", fmt.Errorf("concat text overlays: %w", err)
	}
	return out, nil
}

func planTextOverlayChunks(items []textItem, fps int, totalDur float64, limit int) []textOverlayChunk {
	totalFrames := max(0, int(math.Round(totalDur*float64(fps))))
	if totalFrames == 0 || limit <= 0 {
		return nil
	}

	starts := make(map[int][]int)
	ends := make(map[int][]int)
	boundaries := []int{0, totalFrames}
	for index, item := range items {
		startFrame, endFrame := textOverlayFrameRange(item, fps, totalFrames)
		if endFrame <= startFrame {
			continue
		}
		starts[startFrame] = append(starts[startFrame], index)
		ends[endFrame] = append(ends[endFrame], index)
		boundaries = append(boundaries, startFrame, endFrame)
	}
	if len(starts) == 0 {
		return nil
	}

	sort.Ints(boundaries)
	uniqueBoundaries := boundaries[:0]
	for _, boundary := range boundaries {
		if len(uniqueBoundaries) == 0 || boundary != uniqueBoundaries[len(uniqueBoundaries)-1] {
			uniqueBoundaries = append(uniqueBoundaries, boundary)
		}
	}

	active := make(map[int]bool)
	chunkItems := make(map[int]bool)
	chunkStart := 0
	chunks := make([]textOverlayChunk, 0, len(items)/limit+1)
	for boundaryIndex, boundary := range uniqueBoundaries[:len(uniqueBoundaries)-1] {
		for _, index := range ends[boundary] {
			delete(active, index)
		}
		for _, index := range starts[boundary] {
			active[index] = true
		}

		newItemCount := 0
		for index := range active {
			if !chunkItems[index] {
				newItemCount++
			}
		}
		if len(chunkItems) > 0 && len(chunkItems)+newItemCount > limit && boundary > chunkStart {
			chunks = append(chunks, newTextOverlayChunk(chunkStart, boundary, chunkItems))
			chunkStart = boundary
			chunkItems = make(map[int]bool)
		}
		for index := range active {
			chunkItems[index] = true
		}

		if uniqueBoundaries[boundaryIndex+1] == totalFrames && len(chunkItems) > 0 {
			chunks = append(chunks, newTextOverlayChunk(chunkStart, totalFrames, chunkItems))
		}
	}
	return chunks
}

func newTextOverlayChunk(startFrame, endFrame int, items map[int]bool) textOverlayChunk {
	indices := make([]int, 0, len(items))
	for index := range items {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	return textOverlayChunk{startFrame: startFrame, endFrame: endFrame, itemIndices: indices}
}

func renderTextOverlayChunk(input string, imageFiles []string, items []textItem, chunk textOverlayChunk, chunkIndex, chunkCount, w, h, fps int, work string, progress *renderProgress) (string, error) {
	chunkStart := float64(chunk.startFrame) / float64(fps)
	chunkDuration := float64(chunk.endFrame-chunk.startFrame) / float64(fps)
	currentInput := input
	for passStart := 0; passStart < len(chunk.itemIndices); passStart += maxTextOverlaysPerPass {
		passEnd := min(passStart+maxTextOverlaysPerPass, len(chunk.itemIndices))
		passIndices := chunk.itemIndices[passStart:passEnd]
		args := []string{"-i", currentInput}
		if passStart == 0 && chunk.startFrame > 0 {
			args = []string{"-ss", ff(chunkStart), "-i", currentInput}
		}
		filters := []string{fmt.Sprintf("[0:v]setpts=N/(%d*TB)[v0]", fps)}
		for overlayIndex, itemIndex := range passIndices {
			item := textItemForOverlayChunk(items[itemIndex], chunkStart, chunkDuration)
			enable := textOverlayFrameEnable(items[itemIndex], chunk, fps)
			args = append(args, "-i", imageFiles[itemIndex])
			inputIndex := overlayIndex + 1
			filters = append(filters,
				fmt.Sprintf("[%d:v]format=rgba[text%d]", inputIndex, overlayIndex),
				fmt.Sprintf("[v%d][text%d]overlay=x=%s:y=%s:eof_action=repeat:repeatlast=1:enable='%s'[v%d]", overlayIndex, overlayIndex, textOverlayX(item), textOverlayY(item), enable, overlayIndex+1),
			)
		}

		output := filepath.Join(work, fmt.Sprintf("text_chunk_%d_pass_%d.mp4", chunkIndex, passStart/maxTextOverlaysPerPass))
		args = append(args,
			"-filter_complex_threads", progress.filterThreads(), "-filter_complex", strings.Join(filters, ";"),
			"-map", fmt.Sprintf("[v%d]", len(passIndices)), "-frames:v", strconv.Itoa(chunk.endFrame-chunk.startFrame),
			"-an", "-c:v", videoCodec, "-preset", videoPreset, "-crf", videoCrf, "-pix_fmt", videoPixFmt,
			"-r", strconv.Itoa(fps), "-s", fmt.Sprintf("%dx%d", w, h), "-threads", progress.videoThreads(), "-y", output,
		)
		workWeight := chunkDuration * (1 + float64(min(len(passIndices), maxTextWorkLayers))*textWorkPerLayer)
		message := fmt.Sprintf("rendering text segment %d of %d", chunkIndex+1, chunkCount)
		if err := progress.runFFmpeg(chunkDuration, workWeight, message, args...); err != nil {
			return "", fmt.Errorf("ffmpeg text overlay: %w", err)
		}
		currentInput = output
	}
	return currentInput, nil
}

func textOverlayFrameRange(item textItem, fps, totalFrames int) (int, int) {
	start := max(0, min(totalFrames, int(math.Ceil(item.Start*float64(fps)-1e-9))))
	end := max(0, min(totalFrames, int(math.Ceil((item.Start+item.Duration)*float64(fps)-1e-9))))
	return start, end
}

func textOverlayFrameEnable(item textItem, chunk textOverlayChunk, fps int) string {
	start, end := textOverlayFrameRange(item, fps, chunk.endFrame)
	// Decimal seconds round 1/30s boundaries differently from the chunk planner.
	// Frame-index gates keep successive caption rasters exclusive with no blank frame.
	return fmt.Sprintf("gte(n,%d)*lt(n,%d)", max(start, chunk.startFrame)-chunk.startFrame, end-chunk.startFrame)
}

func textItemForOverlayChunk(item textItem, chunkStart, chunkDuration float64) textItem {
	motionStart, motionDuration := textMotionWindow(item)
	itemEnd := min(item.Start+item.Duration, chunkStart+chunkDuration)
	item.Start = max(0, item.Start-chunkStart)
	item.Duration = itemEnd - chunkStart - item.Start
	localMotionStart := motionStart - chunkStart
	item.MotionStart = &localMotionStart
	item.MotionDuration = &motionDuration
	return item
}

func textOverlayX(item textItem) string {
	motionStart, motionSpan := textMotionWindow(item)
	if item.Animation == "shake" {
		motionDuration := min(item.AnimationDuration, motionSpan/2)
		if motionDuration <= 0 {
			return strconv.Itoa(item.X)
		}
		enterEnd := motionStart + motionDuration
		enterProgress := fmt.Sprintf("(t-%s)/%s", ff(motionStart), ff(motionDuration))
		return fmt.Sprintf("'if(lt(t,%s),%d-0.08*w*cos(6*PI*%s)*pow(1-%s,2),%d)'", ff(enterEnd), item.X, enterProgress, enterProgress, item.X)
	}
	if item.Animation != "slide-left" && item.Animation != "slide-right" {
		return strconv.Itoa(item.X)
	}
	motionDuration := min(item.AnimationDuration, motionSpan/2)
	if motionDuration <= 0 {
		return strconv.Itoa(item.X)
	}
	enterEnd := motionStart + motionDuration
	exitStart := motionStart + motionSpan - motionDuration
	enterProgress := fmt.Sprintf("(t-%s)/%s", ff(motionStart), ff(motionDuration))
	exitProgress := fmt.Sprintf("(t-%s)/%s", ff(exitStart), ff(motionDuration))
	distance := fmt.Sprintf("-(%d+w)", item.X)
	if item.Animation == "slide-right" {
		distance = fmt.Sprintf("+(W-%d)", item.X)
	}
	return fmt.Sprintf("'if(lt(t,%s),%d%s*pow(1-%s,3),if(lt(t,%s),%d,%d%s*pow(%s,3)))'", ff(enterEnd), item.X, distance, enterProgress, ff(exitStart), item.X, item.X, distance, exitProgress)
}

func textOverlayY(item textItem) string {
	motionStart, motionSpan := textMotionWindow(item)
	if item.Animation == "float" {
		return fmt.Sprintf("'%d+0.025*H*(1-2*(t-%s)/%s)'", item.Y, ff(motionStart), ff(motionSpan))
	}
	if item.Animation != "rise" && item.Animation != "pop" && item.Animation != "drop" && item.Animation != "bounce" {
		return strconv.Itoa(item.Y)
	}
	motionDuration := min(item.AnimationDuration, motionSpan/2)
	if motionDuration <= 0 {
		return strconv.Itoa(item.Y)
	}
	enterEnd := motionStart + motionDuration
	exitStart := motionStart + motionSpan - motionDuration
	enterProgress := fmt.Sprintf("(t-%s)/%s", ff(motionStart), ff(motionDuration))
	exitProgress := fmt.Sprintf("(t-%s)/%s", ff(exitStart), ff(motionDuration))
	distance := "0.12*H"
	direction := "+"
	entrance := fmt.Sprintf("%s*pow(1-%s,3)", distance, enterProgress)
	if item.Animation == "pop" {
		distance = "0.07*H"
		entrance = fmt.Sprintf("%s*pow(1-%s,5)", distance, enterProgress)
	} else if item.Animation == "drop" {
		direction = "-"
	} else if item.Animation == "bounce" {
		distance = "0.08*H"
		entrance = fmt.Sprintf("%s*cos(3*PI*%s)*pow(1-%s,2)", distance, enterProgress, enterProgress)
	}
	return fmt.Sprintf("'if(lt(t,%s),%d%s%s,if(lt(t,%s),%d,%d%s%s*pow(%s,3)))'", ff(enterEnd), item.Y, direction, entrance, ff(exitStart), item.Y, item.Y, direction, distance, exitProgress)
}

func textMotionWindow(item textItem) (float64, float64) {
	start := item.Start
	duration := item.Duration
	if item.MotionStart != nil {
		start = *item.MotionStart
	}
	if item.MotionDuration != nil {
		duration = *item.MotionDuration
	}
	return start, duration
}

func encodeVideo(src, dst string, totalDuration float64, output outputSettings, progress *renderProgress) error {
	args := []string{"-i", src}
	args = append(args, output.videoEncodingArgs()...)
	args = append(args, "-an", "-y", dst)
	if err := progress.runFFmpeg(totalDuration, totalDuration, "finalizing "+strings.ToUpper(output.format)+" video", args...); err != nil {
		return fmt.Errorf("ffmpeg final video encode: %w", err)
	}
	return nil
}
