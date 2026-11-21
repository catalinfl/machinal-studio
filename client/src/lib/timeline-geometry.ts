import { clipEnd, clipTimelineDuration } from './clip-time'
import type { Channel, Clip, EffectBlock, TextItem } from './editor-types'

export const MIN_CLIP_LEN = 0.1

export function maxTransitionOverlap(lenA: number, lenB: number): number {
  return Math.max(0, (Math.min(lenA, lenB) - MIN_CLIP_LEN) / 2)
}

export function maxClipTransitionOverlap(clipA: Clip, clipB: Clip, lenA = clipTimelineDuration(clipA), lenB = clipTimelineDuration(clipB)): number {
  if (clipA.mediaKind === 'image' && clipB.mediaKind === 'image') return Math.max(0, Math.min(lenA, lenB) / 2)
  return maxTransitionOverlap(lenA, lenB)
}

export function edgeBounds(channel: Channel, clip: Clip) {
  const length = clipTimelineDuration(clip)
  const end = clipEnd(clip)
  let prevEnd = 0
  let nextStart = Infinity
  let overlapLo = 0
  let overlapHi = 0
  for (const other of channel.clips) {
    if (other.id === clip.id) continue
    const otherEnd = clipEnd(other)
    const overlap = maxClipTransitionOverlap(clip, other, length, clipTimelineDuration(other))
    if (other.start < clip.start) {
      prevEnd = Math.max(prevEnd, otherEnd - overlap)
      if (otherEnd > clip.start) overlapLo = Math.max(overlapLo, otherEnd - clip.start)
    } else if (otherEnd > end) {
      nextStart = Math.min(nextStart, other.start + overlap)
      if (other.start < end) overlapHi = Math.max(overlapHi, end - other.start)
    } else {
      // A fully contained neighbour is a hard wall, not a transition handle.
      prevEnd = Math.max(prevEnd, otherEnd)
      nextStart = Math.min(nextStart, other.start)
    }
  }
  return { prevEnd, nextStart, overlapLo, overlapHi }
}

function packLanes<T extends { start: number; duration: number }>(items: readonly T[]): T[][] {
  const lanes: T[][] = []
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    const lane = lanes.find(candidate => {
      const last = candidate[candidate.length - 1]
      return item.start + 0.001 >= last.start + last.duration
    })
    if (lane) lane.push(item)
    else lanes.push([item])
  }
  return lanes
}

export function packEffectLanes(blocks: EffectBlock[]): EffectBlock[][] {
  return packLanes(blocks)
}

export function packTextLanes(items: TextItem[]): TextItem[][] {
  return packLanes(items)
}

export function clipOverlapInChannel(channel: Channel, clip: Clip, detachedIds: ReadonlySet<string> | null = null) {
  if (detachedIds?.has(clip.id)) return { left: 0, right: 0 }
  const end = clipEnd(clip)
  let left = 0
  let right = 0
  for (const other of channel.clips) {
    if (other.id === clip.id || detachedIds?.has(other.id)) continue
    const otherEnd = clipEnd(other)
    if (other.start < clip.start && otherEnd > clip.start) left = Math.max(left, otherEnd - clip.start)
    if (other.start >= clip.start && other.start < end) right = Math.max(right, end - other.start)
  }
  return { left, right }
}

// Channels are sorted by start time. Group equal starts so detached clips do
// not hide the next active neighbour and simultaneous clips overlap each other.
export function clipOverlapsInChannel(channel: Channel, detachedIds: ReadonlySet<string> | null = null) {
  const overlaps = new Map<string, { left: number; right: number }>()
  const groups: { start: number; clips: Clip[]; nextStart: number }[] = []
  for (const clip of channel.clips) {
    const last = groups.at(-1)
    if (last?.start === clip.start) last.clips.push(clip)
    else groups.push({ start: clip.start, clips: [clip], nextStart: Infinity })
  }
  let nextStart = Infinity
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]
    group.nextStart = nextStart
    if (group.clips.some(clip => !detachedIds?.has(clip.id))) nextStart = group.start
  }
  let priorEnd = -Infinity
  for (const group of groups) {
    const active = group.clips.filter(clip => !detachedIds?.has(clip.id))
    for (const clip of group.clips) {
      if (detachedIds?.has(clip.id)) {
        overlaps.set(clip.id, { left: 0, right: 0 })
        continue
      }
      const end = clipEnd(clip)
      const rightStart = active.length > 1 ? group.start : group.nextStart
      overlaps.set(clip.id, {
        left: Math.max(0, priorEnd - clip.start),
        right: rightStart < end ? end - rightStart : 0,
      })
    }
    for (const clip of active) priorEnd = Math.max(priorEnd, clipEnd(clip))
  }
  return overlaps
}

export function clampClipStart(channel: Channel, movedClip: Clip, desiredStart: number): number {
  const movedLength = clipTimelineDuration(movedClip)
  const forbidden = channel.clips.filter(other => other.id !== movedClip.id).map(other => {
    const overlap = maxClipTransitionOverlap(movedClip, other, movedLength, clipTimelineDuration(other))
    return { start: other.start + overlap - movedLength, end: clipEnd(other) - overlap }
  }).sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const interval of forbidden) {
    const last = merged.at(-1)
    if (last && interval.start <= last.end + 1e-9) last.end = Math.max(last.end, interval.end)
    else merged.push({ ...interval })
  }
  const desired = Math.max(0, desiredStart)
  for (const interval of merged) {
    if (desired <= interval.start + 1e-9 || desired >= interval.end - 1e-9) continue
    if (interval.start < 0) return interval.end
    const midpoint = (interval.start + interval.end) / 2
    const staysBefore = desired < midpoint || (Math.abs(desired - midpoint) <= 1e-9 && movedClip.start <= midpoint)
    return staysBefore ? interval.start : interval.end
  }
  return desired
}
