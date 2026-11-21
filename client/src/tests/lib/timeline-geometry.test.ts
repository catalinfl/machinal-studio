import { describe, expect, it } from 'vitest'
import { clampClipStart, clipOverlapInChannel, clipOverlapsInChannel, edgeBounds, maxClipTransitionOverlap, packEffectLanes, packTextLanes } from '../../lib/timeline-geometry'
import type { Channel, Clip, EffectBlock, TextItem } from '../../lib/editor-types'

function clip(id: string, start: number, duration: number, mediaKind: 'image' | 'video' = 'video'): Clip {
  return { id, start, inPoint: 0, outPoint: duration, sourceDuration: 30, fileName: id, scrubBlobUrl: null, mediaKind }
}

function channel(clips: Clip[]): Channel {
  return { id: 'video', type: 'video', name: 'Video', muted: false, hidden: false, locked: false, clips }
}

describe('timeline geometry without reactive editor state', () => {
  it.each([null, new Set(['b']), new Set(['a', 'c'])])('matches per-clip overlaps for detached set %s', detached => {
    const track = channel([clip('a', 0, 5), clip('b', 3, 4), clip('c', 3, 6), clip('d', 10, 2)])
    const before = JSON.stringify(track)
    const overlaps = clipOverlapsInChannel(track, detached)
    for (const item of track.clips) expect(overlaps.get(item.id)).toEqual(clipOverlapInChannel(track, item, detached))
    expect(JSON.stringify(track)).toBe(before)
  })

  it('allows image transitions without consuming a finite video source handle', () => {
    expect(maxClipTransitionOverlap(clip('a', 0, 2, 'image'), clip('b', 1, 2, 'image'))).toBe(1)
    expect(maxClipTransitionOverlap(clip('a', 0, 2), clip('b', 1, 2))).toBe(0.95)
  })

  it('treats fully contained neighbours as hard trim boundaries', () => {
    const outer = clip('outer', 0, 10)
    expect(edgeBounds(channel([outer, clip('inner', 3, 2)]), outer)).toEqual({ prevEnd: 5, nextStart: 3, overlapLo: 0, overlapHi: 0 })
  })

  it('resolves collisions without mutating clip placement', () => {
    const moving = clip('moving', 0, 2)
    const track = channel([moving, clip('fixed', 5, 2)])
    expect(clampClipStart(track, moving, 5)).toBeCloseTo(3.95)
    expect(moving.start).toBe(0)
    expect(clampClipStart(track, moving, -4)).toBe(0)
  })

  it('shares stable lane packing for text and effects without sorting the input', () => {
    const items = [{ start: 3, duration: 2 }, { start: 0, duration: 4 }, { start: 4, duration: 1 }]
    const expected = [[items[1], items[2]], [items[0]]]
    expect(packEffectLanes(items as EffectBlock[])).toEqual(expected)
    expect(packTextLanes(items as TextItem[])).toEqual(expected)
    expect(items[0].start).toBe(3)
  })
})
