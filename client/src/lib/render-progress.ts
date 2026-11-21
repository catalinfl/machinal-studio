import type { RenderClipPayload, RenderPayload } from './api'
import { hasClipCompositing } from './clip-compositing'

export type RenderEngine = 'server' | 'local'

export interface RenderProgressUpdate {
  ratio: number
  message: string
}

export interface RenderProgressSnapshot extends RenderProgressUpdate {
  etaAvailable: boolean
  elapsedSeconds: number
  remainingSeconds: number
  estimatedTotalSeconds: number
}

interface RenderProgressEstimatorOptions {
  now?: () => number
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  nonlinearWork?: boolean
}

export function hasSceneRenderWork(payload: RenderPayload): boolean {
  return payload.format !== 'mp3' && payload.videoChannels.some(channel => channel.clips.some(clip => clip.file.toLowerCase().endsWith('.scene.json')))
}

const HISTORY_KEY_PREFIX = 'scrub-render-seconds-per-work-v1'
// Per-effect render cost relative to realtime. Cheap color/curve filters cost
// 0.25x; temporal, blur/denoise and per-pixel geq filters are an
// order of magnitude slower (measured on heavy timelines) and must weigh more
// or the initial ETA (e.g. 20s) collapses far below reality (120s+).
const VIDEO_EFFECT_COST = 0.25
const VIDEO_HEAVY_EFFECT_COST = 1.0
const HEAVY_EFFECT_IDS: ReadonlySet<string> = new Set([
  'blur', 'gaussian-blur', 'directional-blur', 'soft-focus',
  'global-beauty', 'denoise', 'motion-trails', 'frame-echo', 'datamosh',
  'oil-painting', 'watercolor', 'light-rays', 'glow-bloom', 'halation',
  'tilt-shift', 'comic-book', 'neon-edges', 'lens-distortion', 'fisheye',
  'crt-curvature', 'camera-shake', 'gate-weave', 'old-projector',
  'waviness', 'kaleidoscope', 'tiny-planet', 'lens-flare',
  'vhs-tracking', 'vhs-head-noise', 'glitch-bands', 'bad-tv',
])

export function effectWorkCost(id: string | undefined): number {
  return id && HEAVY_EFFECT_IDS.has(id) ? VIDEO_HEAVY_EFFECT_COST : VIDEO_EFFECT_COST
}

export function segmentEffectsCost(effects: ReadonlyArray<{ id?: string }>): number {
  let cost = 0
  for (const effect of effects) cost += effectWorkCost(effect?.id)
  return cost
}
const VIDEO_MASK_COST = 0.08
const AUDIO_WORK_FACTOR = 0.12
const DEFAULT_SECONDS_PER_WORK: Record<RenderEngine, number> = {
  server: 0.35,
  local: 1.2,
}
const STARTUP_SECONDS: Record<RenderEngine, number> = {
  server: 0.8,
  local: 2.5,
}
const TRANSITION_EPSILON = 0.05

function clipRate(clip: RenderClipPayload): number {
  const rate = clip.playbackRate ?? 1
  return Number.isFinite(rate) && rate > 0 ? rate : 1
}

function clipDuration(clip: RenderClipPayload): number {
  return Math.max(0, clip.outPoint - clip.inPoint) / clipRate(clip)
}

function clipEnd(clip: RenderClipPayload): number {
  return clip.start + clipDuration(clip)
}

function overlappingGroups(clips: RenderClipPayload[]): RenderClipPayload[][] {
  const ordered = [...clips].sort((left, right) => left.start - right.start)
  const groups: RenderClipPayload[][] = []
  for (let start = 0; start < ordered.length;) {
    let end = start
    while (end + 1 < ordered.length && ordered[end + 1].start < clipEnd(ordered[end]) - TRANSITION_EPSILON) {
      end++
    }
    groups.push(ordered.slice(start, end + 1))
    start = end + 1
  }
  return groups
}

function projectDuration(payload: RenderPayload): number {
  const channels = payload.format === 'mp3'
    ? payload.audioChannels
    : [...payload.videoChannels, ...payload.audioChannels]
  const clips = channels
    .flatMap((channel) => channel.clips)
  const clipEnd = clips.reduce(
    (duration, clip) => Math.max(duration, clip.start + clipDuration(clip)),
    0,
  )
  const textItems = payload.format === 'mp3' ? [] : payload.textItems ?? []
  return textItems.reduce(
    (duration, item) => Math.max(duration, item.start + item.duration),
    clipEnd,
  )
}

function videoChannelWork(payload: RenderPayload): number {
  if (payload.format === 'mp3') return 0
  const duration = projectDuration(payload)
  let work = 0

  for (const channel of payload.videoChannels.filter((item) => item.clips.length > 0)) {
    const clips = [...channel.clips].sort((left, right) => left.start - right.start)
    for (const clip of clips) {
      const segments = clip.segments.length > 0
        ? clip.segments
        : [{ srcStart: clip.inPoint, srcEnd: clip.outPoint, effects: [] }]
      for (const segment of segments) {
        const segmentDuration = Math.max(0, segment.srcEnd - segment.srcStart) / clipRate(clip)
        work += segmentDuration * (1 + segmentEffectsCost(segment.effects))
      }
      work += clipDuration(clip) * VIDEO_MASK_COST
    }

    let cursor = 0
    for (const group of overlappingGroups(clips)) {
      const groupStart = group[0].start
      const groupDuration = clipEnd(group.at(-1)!) - groupStart
      if (group.length > 1) work += groupDuration * (1 + VIDEO_MASK_COST)
      if (groupStart > cursor) work += (groupStart - cursor) * (1 + VIDEO_MASK_COST)
      cursor = Math.max(cursor, groupStart + groupDuration)
    }
    if (duration > cursor) work += (duration - cursor) * (1 + VIDEO_MASK_COST)
  }

  const videoChannels = payload.videoChannels.filter((channel) => channel.clips.length > 0).length
  work += Math.max(0, videoChannels - 1) * duration
  const firstVideoChannel = payload.videoChannels.find((channel) => channel.clips.length > 0)
  if (firstVideoChannel?.clips.some(hasClipCompositing)) work += duration
  if (videoChannels === 0 && (payload.textItems?.length ?? 0) > 0) work += duration
  if ((payload.textItems?.length ?? 0) > 0) {
    work += duration * (1 + Math.min(payload.textItems!.length, 20) * 0.01)
  }
  return work
}

/** Equivalent seconds of 720p/30fps encoding work for initial ETA calibration. */
export function estimateRenderWork(payload: RenderPayload): number {
  const duration = projectDuration(payload)
  const pixelFactor = Math.max(0.1, (payload.resolution.w * payload.resolution.h) / (1280 * 720))
  const frameRateFactor = Math.max(0.1, payload.fps / 30)
  const videoWork = videoChannelWork(payload) * pixelFactor * frameRateFactor

  const audioClipWork = payload.audioChannels
    .flatMap((channel) => channel.clips)
    .reduce((work, clip) => work + clipDuration(clip) * AUDIO_WORK_FACTOR, 0)
  const audioChannels = payload.audioChannels.filter((channel) => channel.clips.length > 0).length
  const audioMixWork = Math.max(0, audioChannels - 1) * duration * AUDIO_WORK_FACTOR
  const finalVideoWork = payload.format !== 'mp3'
    && (payload.videoChannels.some((channel) => channel.clips.length > 0) || (payload.textItems?.length ?? 0) > 0)
    ? duration * pixelFactor * frameRateFactor
    : 0

  return Math.max(0.25, videoWork + audioClipWork + audioMixWork + finalVideoWork)
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function storedSecondsPerWork(
  engine: RenderEngine,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): number {
  if (!storage) return DEFAULT_SECONDS_PER_WORK[engine]
  const value = Number(storage.getItem(`${HISTORY_KEY_PREFIX}:${engine}`))
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SECONDS_PER_WORK[engine]
}

export class RenderProgressEstimator {
  private readonly startedAt: number
  private readonly now: () => number
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null
  private readonly initialTotalSeconds: number
  private readonly nonlinearWork: boolean
  private estimatedTotalSeconds: number
  private ratio = 0
  private message = 'preparing render'

  constructor(
    private readonly engine: RenderEngine,
    private readonly work: number,
    options: RenderProgressEstimatorOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now())
    this.nonlinearWork = options.nonlinearWork ?? false
    this.storage = options.storage === undefined ? browserStorage() : options.storage
    this.startedAt = this.now()
    this.initialTotalSeconds = STARTUP_SECONDS[engine]
      + Math.max(0.25, work) * storedSecondsPerWork(engine, this.storage)
    this.estimatedTotalSeconds = this.initialTotalSeconds
  }

  update(update: RenderProgressUpdate): RenderProgressSnapshot {
    this.ratio = Math.max(this.ratio, Math.min(0.999, Math.max(0, update.ratio)))
    this.message = update.message || this.message
    if (this.nonlinearWork) return this.snapshot()

    const elapsedSeconds = this.elapsedSeconds()
    if (this.ratio >= 0.01 && elapsedSeconds >= 0.3) {
      const measuredTotal = elapsedSeconds / this.ratio
      // Upper cap grows with progress: early samples (tiny ratio) are noisy
      // and stay close to the initial estimate, but once the render is
      // measurably slower than predicted (heavy effects) the estimator must
      // be allowed to learn totals far beyond 4x initial (e.g. 20s -> 150s).
      const capMultiplier = 4 + 28 * Math.min(1, this.ratio / 0.3)
      const boundedTotal = Math.min(
        this.initialTotalSeconds * capMultiplier,
        Math.max(this.initialTotalSeconds * 0.25, measuredTotal),
      )
      const confidence = Math.min(0.95, 0.25 + this.ratio * 2.2)
      const target = this.initialTotalSeconds * (1 - confidence) + boundedTotal * confidence
      // Adapt fast when underestimated (target above estimate) so the
      // remaining time jumps to the truth instead of counting down to a
      // fake 0s; adapt slowly when overestimated to keep the countdown stable.
      const alpha = target > this.estimatedTotalSeconds ? 0.6 : 0.25
      this.estimatedTotalSeconds += (target - this.estimatedTotalSeconds) * alpha
      this.estimatedTotalSeconds = Math.max(this.estimatedTotalSeconds, elapsedSeconds)
    }

    return this.snapshot()
  }

  snapshot(message = this.message): RenderProgressSnapshot {
    const elapsedSeconds = this.elapsedSeconds()
    if (this.nonlinearWork && this.ratio < 1) {
      return { ratio: this.ratio, message, elapsedSeconds, etaAvailable: false, remainingSeconds: 0, estimatedTotalSeconds: elapsedSeconds }
    }
    if (this.ratio >= 0.01 && this.ratio < 1 && elapsedSeconds >= 1) {
      // Timer ticks (500ms) arrive without new ratios while ffmpeg grinds
      // through a heavy effect. Extrapolating from the observed speed keeps
      // the ETA honest: when stalled, remaining grows instead of counting
      // down to 0 and snapping back to max(2, elapsed*0.1) in a sawtooth.
      const extrapolatedTotal = elapsedSeconds / this.ratio
      if (extrapolatedTotal > this.estimatedTotalSeconds) {
        const gap = extrapolatedTotal - this.estimatedTotalSeconds
        this.estimatedTotalSeconds += gap * (gap > this.estimatedTotalSeconds ? 0.7 : 0.5)
      }
    }
    if (elapsedSeconds >= this.estimatedTotalSeconds && this.ratio < 1) {
      // Fallback only when no usable speed sample exists yet (ratio ~0):
      // with a measured speed the block above already keeps estimate ahead.
      this.estimatedTotalSeconds = Math.max(
        this.estimatedTotalSeconds,
        elapsedSeconds + Math.max(2, elapsedSeconds * 0.1),
      )
    }
    return {
      ratio: this.ratio,
      etaAvailable: true,
      message,
      elapsedSeconds,
      remainingSeconds: Math.max(0, this.estimatedTotalSeconds - elapsedSeconds),
      estimatedTotalSeconds: Math.max(elapsedSeconds, this.estimatedTotalSeconds),
    }
  }

  finish(message = 'render complete'): RenderProgressSnapshot {
    const elapsedSeconds = this.elapsedSeconds()
    this.ratio = 1
    this.message = message
    this.estimatedTotalSeconds = elapsedSeconds
    if (!this.nonlinearWork) this.saveHistory(elapsedSeconds)
    return this.snapshot()
  }

  private elapsedSeconds(): number {
    return Math.max(0, (this.now() - this.startedAt) / 1000)
  }

  private saveHistory(elapsedSeconds: number): void {
    if (!this.storage || this.work <= 0) return
    const measured = Math.max(0.01, (elapsedSeconds - STARTUP_SECONDS[this.engine]) / this.work)
    const previous = storedSecondsPerWork(this.engine, this.storage)
    const smoothed = Math.min(100, previous * 0.7 + measured * 0.3)
    try {
      this.storage.setItem(`${HISTORY_KEY_PREFIX}:${this.engine}`, String(smoothed))
    } catch {
      // Storage can become unavailable between reads and writes.
    }
  }
}

export function formatRenderTime(seconds: number): string {
  if (seconds > 0 && seconds < 1) return '<1s'
  const rounded = Math.max(0, Math.round(seconds))
  if (rounded < 60) return `${rounded}s`
  const minutes = Math.floor(rounded / 60)
  const remainingSeconds = rounded % 60
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}
