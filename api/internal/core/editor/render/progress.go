package render

import (
	"context"
	"log"
	"math"
	"sort"
	"strconv"
	"sync"
	"time"

	"ffmpeg-go-server/internal/platform/jobqueue"
	"ffmpeg-go-server/internal/utils"
)

const (
	videoEffectWorkFactor      = 0.25 // extra cost per cheap effect, relative to realtime
	videoHeavyEffectWorkFactor = 1.0  // temporal/blur/geq filters run ~4x slower than cheap ones
	videoMaskWorkFactor        = 0.08 // alpha-mask renders skip effects, so cheaper
	audioWorkFactor            = 0.12 // PCM extract/mix is I/O-bound
	silenceWorkFactor          = 0.02 // anullsrc renders far faster than realtime
	finalAudioWorkFactor       = 0.04 // single lossy encode pass
)

// heavyEffectIDs mirrors the client estimator: these filters dominate frame
// time and must weigh more or progress stalls inside heavy segments while the
// client ETA collapses far below reality.
var heavyEffectIDs = map[string]bool{
	"blur": true, "gaussian-blur": true, "directional-blur": true, "soft-focus": true,
	"global-beauty": true, "denoise": true, "motion-trails": true, "frame-echo": true,
	"datamosh": true, "oil-painting": true, "watercolor": true, "light-rays": true,
	"glow-bloom": true, "halation": true, "tilt-shift": true, "comic-book": true,
	"neon-edges": true, "lens-distortion": true, "fisheye": true, "crt-curvature": true,
	"camera-shake": true, "gate-weave": true, "old-projector": true,
	"waviness": true, "kaleidoscope": true, "tiny-planet": true, "lens-flare": true,
	"vhs-tracking": true, "vhs-head-noise": true, "glitch-bands": true, "bad-tv": true,
}

func effectWorkCost(id string) float64 {
	if heavyEffectIDs[id] {
		return videoHeavyEffectWorkFactor
	}
	return videoEffectWorkFactor
}

func segmentEffectsCost(effects []effect) float64 {
	cost := 0.0
	for _, item := range effects {
		cost += effectWorkCost(item.ID)
	}
	return cost
}

// minRenderWork keeps NDJSON progress monotonic on near-empty timelines.
const minRenderWork = 0.25

const (
	maxProgressRatio    = 0.999 // reserve 1.0 for the explicit complete event
	progressRatioStep   = 0.002 // coalesce sub-pixel updates from fast segments
	progressMinInterval = 250 * time.Millisecond
	textWorkPerLayer    = 0.01 // overlay cost per text item, capped below
	maxTextWorkLayers   = 20
	timelineSmallGapEps = 0.01 // gaps below 10ms are rounding noise, not work
)

type progressCallback func(ratio float64, message string)

type renderProgress struct {
	mu            sync.Mutex
	ctx           context.Context
	totalWork     float64
	completedWork float64
	callback      progressCallback
	lastRatio     float64
	lastMessage   string
	lastReport    time.Time
	threadBudget  int
	sceneShare    float64
}

func (progress *renderProgress) workCompleted() float64 {
	if progress == nil {
		return 0
	}
	progress.mu.Lock()
	defer progress.mu.Unlock()
	return progress.completedWork
}

func (progress *renderProgress) addWork(delta float64) float64 {
	if progress == nil {
		return 0
	}
	progress.mu.Lock()
	defer progress.mu.Unlock()
	progress.completedWork += delta
	return progress.completedWork
}

func newRenderProgress(totalWork float64, callback progressCallback) *renderProgress {
	return &renderProgress{
		totalWork: math.Max(minRenderWork, totalWork),
		callback:  callback,
	}
}

func (progress *renderProgress) runFFmpeg(expectedDuration, work float64, message string, args ...string) (err error) {
	started := time.Now()
	defer func() {
		log.Printf("render_stage stage=%q elapsed_ms=%d media_seconds=%.3f success=%t", message, time.Since(started).Milliseconds(), expectedDuration, err == nil)
	}()
	args = append([]string{"-filter_threads", progress.filterThreads()}, boundDecoderThreads(args, progress.videoThreads())...)
	ctx := context.Background()
	if progress != nil && progress.ctx != nil {
		ctx = progress.ctx
	}
	if progress == nil || progress.callback == nil || work <= 0 {
		return utils.RunFFmpegContext(ctx, args...)
	}

	start := progress.workCompleted()
	progress.report(start/progress.totalWork, message, true)
	err = utils.RunFFmpegProgress(ctx, expectedDuration, func(ratio float64) {
		overall := (start + ratio*work) / progress.totalWork
		stage := ProgressStage(message)
		if progress.threadBudget == 0 && (stage == "encoding" || stage == "compositing") && ratio > 0 && ratio < 1 && expectedDuration > 0 {
			// Report output media milliseconds, not whole-job progress (scene capture has a different rate).
			jobProgress := progress.sceneShare + (1-progress.sceneShare)*math.Min(overall, maxProgressRatio)
			if jobqueue.ReportStage(ctx, jobProgress, message, jobqueue.Stage{Name: stage, Scope: "pass", Completed: int(ratio * expectedDuration * 1000), Total: int(expectedDuration * 1000), ElapsedSeconds: time.Since(started).Seconds()}) {
				return
			}
		}
		progress.report(overall, message, false)
	}, args...)
	if err != nil {
		return err
	}
	completed := progress.addWork(work)
	progress.report(completed/progress.totalWork, message, true)
	return nil
}

func boundDecoderThreads(args []string, budget string) []string {
	bounded := make([]string, 0, len(args))
	explicit := false
	for _, arg := range args {
		if arg == "-threads" || arg == "-threads:v" {
			explicit = true
		}
		if arg == "-i" {
			if !explicit {
				bounded = append(bounded, "-threads", budget)
			}
			explicit = false
		}
		bounded = append(bounded, arg)
	}
	return bounded
}

func (progress *renderProgress) filterThreads() string {
	if progress != nil && progress.threadBudget > 0 {
		return strconv.Itoa(min(maxFilterThreads, progress.threadBudget))
	}
	return filterThreadCount()
}

func (progress *renderProgress) videoThreads() string {
	if progress != nil && progress.threadBudget > 0 {
		return strconv.Itoa(min(maxVideoThreads, progress.threadBudget))
	}
	return videoThreadCount()
}

func (progress *renderProgress) complete(message string) {
	if progress == nil {
		return
	}
	progress.report(1, message, true)
}

func (progress *renderProgress) report(ratio float64, message string, force bool) {
	if progress == nil || progress.callback == nil {
		return
	}
	progress.mu.Lock()
	ratio = math.Max(progress.lastRatio, math.Min(maxProgressRatio, math.Max(0, ratio)))
	now := time.Now()
	if !force && message == progress.lastMessage && ratio-progress.lastRatio < progressRatioStep && now.Sub(progress.lastReport) < progressMinInterval {
		progress.mu.Unlock()
		return
	}
	progress.lastRatio = ratio
	progress.lastMessage = message
	progress.lastReport = now
	callback := progress.callback
	progress.mu.Unlock()
	callback(ratio, message)
}

func estimateRenderWork(req renderRequest, plan renderPlan) float64 {
	videoChannelCount, videoWork := estimateVideoWork(req, plan)
	work := videoWork
	work += estimateTextWork(req, plan, videoChannelCount)
	work += estimateAudioWork(req, plan)
	if plan.hasVideo {
		work += plan.totalDuration
	}
	return math.Max(minRenderWork, work)
}

func estimateVideoWork(req renderRequest, plan renderPlan) (int, float64) {
	work := 0.0
	videoChannelCount := 0
	baseCompositing := false
	for _, sourceChannel := range req.VideoChannels {
		if len(sourceChannel.Clips) == 0 {
			continue
		}
		videoChannelCount++
		needsMask := videoChannelCount > 1 || channelNeedsBaseMask(sourceChannel)
		if videoChannelCount == 1 {
			for _, movingClip := range sourceChannel.Clips {
				if hasClipCompositing(movingClip) {
					baseCompositing = true
					break
				}
			}
		}
		clips := append([]clip(nil), sourceChannel.Clips...)
		sort.SliceStable(clips, func(i, j int) bool { return clips[i].Start < clips[j].Start })
		for _, movingClip := range clips {
			segments := movingClip.Segments
			if len(segments) == 0 {
				segments = []segment{{SrcStart: movingClip.InPoint, SrcEnd: movingClip.OutPoint}}
			}
			for _, part := range segments {
				duration := math.Max(0, part.SrcEnd-part.SrcStart) / clipPlaybackRate(movingClip)
				work += duration * (1 + segmentEffectsCost(segmentEffectsForClip(movingClip, part.Effects)))
			}
			if needsMask {
				work += clipDurT(movingClip) * videoMaskWorkFactor
			}
		}
		work += estimateVideoTimelineGroupWork(clips, plan.fps, plan.totalDuration)
		if needsMask {
			work += estimateTimelineGroupWork(clips, plan.totalDuration, videoMaskWorkFactor)
		}
	}
	work += float64(max(0, videoChannelCount-1)) * plan.totalDuration
	if baseCompositing {
		work += plan.totalDuration
	}
	return videoChannelCount, work
}

func estimateTextWork(req renderRequest, plan renderPlan, videoChannelCount int) float64 {
	work := 0.0
	if videoChannelCount == 0 && len(req.TextItems) > 0 {
		work += plan.totalDuration
	}
	if len(req.TextItems) > 0 {
		work += plan.totalDuration * (1 + float64(min(len(req.TextItems), maxTextWorkLayers))*textWorkPerLayer)
	}
	return work
}

func estimateAudioWork(req renderRequest, plan renderPlan) float64 {
	work := 0.0
	audioChannelCount := 0
	for _, sourceChannel := range req.AudioChannels {
		if len(sourceChannel.Clips) == 0 {
			continue
		}
		audioChannelCount++
		clips := coalesceContinuousAudioClips(sourceChannel.Clips)
		for _, movingClip := range clips {
			work += clipDurT(movingClip) * audioWorkFactor
		}
		work += estimateTimelineGroupWork(clips, plan.totalDuration, audioWorkFactor)
	}
	if audioChannelCount > 1 {
		work += plan.totalDuration * audioWorkFactor
	}
	if audioChannelCount > 0 {
		work += plan.totalDuration * finalAudioWorkFactor
	}
	return work
}

func estimateVideoTimelineGroupWork(clips []clip, fps int, totalDuration float64) float64 {
	work := 0.0
	cursor := 0.0
	for groupIndex, indices := range groupOverlapping(clips) {
		groupClips := clips[indices[0] : indices[1]+1]
		groupStart := groupClips[0].Start
		groupDuration := clipEndT(groupClips[len(groupClips)-1]) - groupStart
		if len(groupClips) > 1 {
			planned, _ := planWindowedGroup(groupIndex, indices[0], indices[1], clips, fps, nil)
			if planned.windowed {
				for _, tr := range planned.transitions {
					work += tr.duration
				}
			} else {
				work += groupDuration
			}
		}
		if gap := groupStart - cursor; gap > timelineSmallGapEps {
			work += gap
		}
		cursor = math.Max(cursor, groupStart+groupDuration)
	}
	if gap := totalDuration - cursor; gap > timelineSmallGapEps {
		work += gap
	}
	return work
}

func estimateTimelineGroupWork(clips []clip, totalDuration, factor float64) float64 {
	work := 0.0
	cursor := 0.0
	gapFactor := gapFactorForTimelineWork(factor)
	for _, indices := range groupOverlapping(clips) {
		groupClips := clips[indices[0] : indices[1]+1]
		groupStart := groupClips[0].Start
		groupDuration := clipEndT(groupClips[len(groupClips)-1]) - groupStart
		if len(groupClips) > 1 {
			work += groupDuration * factor
		}
		if gap := groupStart - cursor; gap > timelineSmallGapEps {
			work += gap * gapFactor
		}
		cursor = math.Max(cursor, groupStart+groupDuration)
	}
	if gap := totalDuration - cursor; gap > timelineSmallGapEps {
		work += gap * gapFactor
	}
	return work
}

func gapFactorForTimelineWork(factor float64) float64 {
	switch factor {
	case 1:
		return 1
	case videoMaskWorkFactor:
		return videoMaskWorkFactor
	default:
		return silenceWorkFactor
	}
}
