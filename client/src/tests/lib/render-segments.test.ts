import { describe, expect, it } from 'vitest'
import { computeEffectRegions, flattenEffectRegions, mergeFlatSegments } from '../../lib/render-segments'
import type { Clip, EffectBlock } from '../../stores/editor.svelte'

const clip: Clip = {
  id: 'clip', fileName: 'source.mp4', scrubBlobUrl: null,
  sourceDuration: 30, inPoint: 4, outPoint: 24, start: 10, playbackRate: 2,
}

function block(id: string, start: number, duration: number, patch: Partial<EffectBlock> = {}): EffectBlock {
  return { id, channelId: 'video', effectId: 'grayscale', params: {}, ramp: null, nodeId: null, start, duration, ...patch }
}

describe('pure render segment planning', () => {
  it('converts timeline boundaries to source time and preserves insertion order', () => {
    const regions = computeEffectRegions(clip, 'video', [block('top', 12, 4), block('later', 11, 3)])
    expect(regions.map(region => [region.start, region.end])).toEqual([[4, 6], [6, 8], [8, 12], [12, 16], [16, 24]])
    expect(regions[2].stack.map(item => item.blockId)).toEqual(['top', 'later'])
  })

  it('filters channel and owner while keeping effects stretched across a cut', () => {
    const regions = computeEffectRegions(clip, 'video', [
      block('shared', 5, 10), block('other-owner', 10, 10, { ownerClipId: 'other' }),
      block('other-channel', 10, 10, { channelId: 'other' }),
    ])
    expect(regions[0].stack.map(item => item.blockId)).toEqual(['shared'])
    expect(regions.at(-1)?.stack).toEqual([])
  })

  it('keeps ramp timing continuous at an unrelated block boundary', () => {
    const ramp = { mode: 'in' as const, curve: 'linear' as const, amount: 0.5 }
    const blocks = [block('ramp', 8, 12, { ramp }), block('split', 14, 2)]
    const before = JSON.stringify(blocks)
    const regions = computeEffectRegions(clip, 'video', blocks)
    expect(regions.map(region => region.stack[0]?.ramp?.offset)).toEqual([2, 6, 8])
    expect(regions[1].stack[0].ramp?.blockDuration).toBe(12)
    expect(JSON.stringify(blocks)).toBe(before)
  })

  it('returns pass-through segments and rejects an empty source window', () => {
    expect(flattenEffectRegions(clip, computeEffectRegions(clip, 'video', []))).toEqual([
      { srcStart: 4, srcEnd: 24, effects: [], filter: null, effectId: null, nodeId: null },
    ])
    expect(computeEffectRegions({ ...clip, outPoint: 4 }, 'video', [])).toEqual([])
  })

  it('merges touching filters without changing input or first-region node metadata', () => {
    const first = { srcStart: 4, srcEnd: 8, effects: [], filter: null, effectId: null, nodeId: 'first' }
    const second = { ...first, srcStart: 8, srcEnd: 12, nodeId: 'second' }
    expect(mergeFlatSegments([first, second])).toEqual([{ ...first, srcEnd: 12 }])
    expect(first.srcEnd).toBe(8)
    expect(mergeFlatSegments([first, { ...second, srcStart: 9 }])).toHaveLength(2)
  })
})
