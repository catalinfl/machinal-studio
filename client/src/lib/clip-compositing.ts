export interface CompositedClip {
  start: number
  inPoint: number
  outPoint: number
  playbackRate?: number
  opacity?: number
  fadeIn?: number
  fadeOut?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clipDuration(clip: CompositedClip): number {
  const rate = clamp(finiteOr(clip.playbackRate, 1), 0.25, 4)
  return Math.max(0, (clip.outPoint - clip.inPoint) / rate)
}

const MIN_FADE_DURATION = 0.000001

export function clipOpacity(clip: CompositedClip): number {
  return clamp(finiteOr(clip.opacity, 1), 0, 1)
}

export function clipFadeIn(clip: CompositedClip): number {
  const duration = clamp(finiteOr(clip.fadeIn, 0), 0, clipDuration(clip))
  return duration < MIN_FADE_DURATION ? 0 : duration
}

export function clipFadeOut(clip: CompositedClip): number {
  const duration = clamp(finiteOr(clip.fadeOut, 0), 0, clipDuration(clip))
  return duration < MIN_FADE_DURATION ? 0 : duration
}

export function hasClipCompositing(clip: CompositedClip): boolean {
  return clipOpacity(clip) < 1 - 1e-9 || clipFadeIn(clip) > 1e-9 || clipFadeOut(clip) > 1e-9
}

export function clipAlphaAt(clip: CompositedClip, timelineTime: number): number {
  const duration = clipDuration(clip)
  const elapsed = timelineTime - clip.start
  if (elapsed < 0 || elapsed >= duration) return 0

  let envelope = 1
  const fadeIn = clipFadeIn(clip)
  const fadeOut = clipFadeOut(clip)
  if (fadeIn > 0) envelope *= clamp(elapsed / fadeIn, 0, 1)
  if (fadeOut > 0) envelope *= clamp((duration - elapsed) / fadeOut, 0, 1)
  return clipOpacity(clip) * clamp(envelope, 0, 1)
}
