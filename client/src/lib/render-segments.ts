import { buildFilterChain, type EffectParams, type EffectInstance, type RampTiming } from './effects'
import { clipEnd, clipPlaybackRate, clipSourceTimeAt, clipTimelineDuration } from './clip-time'
import type { Clip, EffectBlock } from './editor-types'

export interface EffectRegion {
  start: number
  end: number
  stack: Array<{ blockId: string; effectId: string; params: EffectParams; ramp: RampTiming | null }>
}

export interface FlatSegment {
  srcStart: number
  srcEnd: number
  effects: EffectInstance[]
  filter: string | null
  effectId: string | null
  nodeId: string | null
}

export function blockOverlapsClip(block: EffectBlock, channelId: string, clip: Clip): boolean {
  return block.channelId === channelId
    && (!block.ownerClipId || block.ownerClipId === clip.id)
    && block.start < clipEnd(clip)
    && block.start + block.duration > clip.start
}

export function computeEffectRegions(clip: Clip, channelId: string, blocks: readonly EffectBlock[]): EffectRegion[] {
  if (clip.outPoint <= clip.inPoint) return []
  const ranges = blocks
    .filter(block => blockOverlapsClip(block, channelId, clip))
    .map(block => ({
      block,
      start: clipSourceTimeAt(clip, Math.max(clip.start, block.start)),
      end: clipSourceTimeAt(clip, Math.min(clipEnd(clip), block.start + block.duration)),
    }))
    .filter(range => range.end - range.start > 0.01)
  const breakpoints = new Set<number>([clip.inPoint, clip.outPoint])
  for (const range of ranges) {
    breakpoints.add(range.start)
    breakpoints.add(range.end)
  }
  const sorted = [...breakpoints].sort((a, b) => a - b)
  const regions: EffectRegion[] = []
  for (let index = 0; index < sorted.length - 1; index++) {
    const start = sorted[index]
    const end = sorted[index + 1]
    if (end - start <= 0.01) continue
    const midpoint = (start + end) / 2
    const timelineStart = (start - clip.inPoint) / clipPlaybackRate(clip)
    const stack = ranges
      .filter(range => range.start <= midpoint && range.end > midpoint)
      .map(({ block }) => ({
        blockId: block.id,
        effectId: block.effectId,
        params: { ...block.params },
        ramp: block.ramp ? {
          ...block.ramp,
          blockDuration: block.duration,
          offset: timelineStart - (block.start - clip.start),
        } : null,
      }))
    regions.push({ start, end, stack })
  }
  return regions
}

export function flattenEffectRegions(clip: Clip, regions: readonly EffectRegion[]): FlatSegment[] {
  return regions.map((region): FlatSegment => {
    const effects = region.stack.map(item => ({
      id: item.effectId,
      params: { ...item.params },
      ...(item.ramp ? { ramp: { ...item.ramp } } : {}),
    }))
    return {
      srcStart: region.start,
      srcEnd: region.end,
      effects,
      filter: effects.length > 0
        ? buildFilterChain(effects, clipTimelineDuration({ ...clip, inPoint: region.start, outPoint: region.end }))
        : null,
      effectId: region.stack.at(-1)?.effectId ?? null,
      nodeId: null,
    }
  })
}

export function mergeFlatSegments(segments: readonly FlatSegment[]): FlatSegment[] {
  const merged: FlatSegment[] = []
  for (const segment of segments) {
    const previous = merged.at(-1)
    if (previous && previous.filter === segment.filter && Math.abs(previous.srcEnd - segment.srcStart) < 0.001) {
      previous.srcEnd = segment.srcEnd
    } else merged.push({ ...segment })
  }
  return merged
}
