import type { Clip } from './editor-types'

export function clipPlaybackRate(clip: Pick<Clip, 'playbackRate'>): number {
  const rate = clip.playbackRate ?? 1
  return Number.isFinite(rate) ? Math.max(0.25, Math.min(4, rate)) : 1
}

export function clipTimelineDuration(clip: Pick<Clip, 'inPoint' | 'outPoint' | 'playbackRate'>): number {
  return (clip.outPoint - clip.inPoint) / clipPlaybackRate(clip)
}

export function clipEnd(clip: Pick<Clip, 'start' | 'inPoint' | 'outPoint' | 'playbackRate'>): number {
  return clip.start + clipTimelineDuration(clip)
}

export function clipSourceTimeAt(clip: Pick<Clip, 'start' | 'inPoint' | 'playbackRate'>, timelineTime: number): number {
  return clip.inPoint + (timelineTime - clip.start) * clipPlaybackRate(clip)
}
