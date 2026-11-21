import { describe, expect, it } from 'vitest'
import { indexPreviewMedia, previewClipsInRange } from '../../lib/preview-media'
import type { Channel, Clip } from '../../stores/editor.svelte'

function clip(id: string, start: number, inPoint = start, duration = 1): Clip {
  return { id, start, inPoint, outPoint: inPoint + duration, fileName: 'recording.mp4', mediaKind: 'video', scrubBlobUrl: 'blob:recording', sourceDuration: 1000 }
}

function channel(clips: Clip[], hidden = false): Channel {
  return { id: 'video', name: 'Video', type: 'video', muted: false, hidden, locked: false, clips }
}

describe('preview media index', () => {
  it('shares one decoder for a thousand continuous cuts without sorting per frame', () => {
    const clips = Array.from({ length: 1000 }, (_, i) => clip(String(i), i))
    const started = performance.now()
    const index = indexPreviewMedia([channel(clips)])
    for (let frame = 0; frame < 60; frame++) {
      expect(previewClipsInRange(index, 500 + frame / 60).map(({ clip }) => clip.id)).toEqual(['500'])
    }
    expect(new Set(index.cacheKeys.values())).toEqual(new Set(['clip:0']))
    console.info(`1,000 continuous cuts: index + 60 frame lookups ${(performance.now() - started).toFixed(2)}ms`)
  })

  it('finds a long overlapping clip even when shorter clips before the playhead have ended', () => {
    const index = indexPreviewMedia([channel([clip('long', 0, 0, 100), clip('short', 3), clip('later', 20, 0, 3)])])
    expect(previewClipsInRange(index, 22).map(({ clip }) => clip.id)).toEqual(['long', 'later'])
    expect(previewClipsInRange(index, 23).map(({ clip }) => clip.id)).toEqual(['long'])
    expect(previewClipsInRange(index, 100)).toEqual([])
  })

  it('rebuilds independent voices when cuts overlap or their source windows are discontinuous', () => {
    const right = clip('right', 1, 2)
    expect(indexPreviewMedia([channel([clip('left', 0), right])]).cacheKeys.get('right')).toBe('clip:right')
    right.inPoint = 1
    right.outPoint = 2
    expect(indexPreviewMedia([channel([right, clip('left', 0)])]).cacheKeys.get('right')).toBe('clip:left')
    right.start = 0.5
    expect(indexPreviewMedia([channel([clip('left', 0), right])]).cacheKeys.get('right')).toBe('clip:right')
    expect(previewClipsInRange(indexPreviewMedia([channel([right], true)]), 1)).toEqual([])
  })
})
