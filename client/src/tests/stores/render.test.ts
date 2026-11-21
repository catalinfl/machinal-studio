import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RenderOptions, RenderResult } from '../../lib/wasm'

const wasmMocks = vi.hoisted(() => ({
  renderSegment: vi.fn<(options: RenderOptions) => Promise<RenderResult>>(async (_options) => ({ blobUrl: 'blob:effect', blob: new Blob(), durationSec: 1 })),
  renderTransition: vi.fn(async () => ({ blobUrl: 'blob:transition', blob: new Blob(), durationSec: 1 })),
  renderAudioTransition: vi.fn(async () => ({ blobUrl: 'blob:audio-transition', blob: new Blob(), durationSec: 1 })),
  getFFmpeg: vi.fn(async () => ({})),
}))

vi.mock('../../lib/wasm', () => wasmMocks)

vi.mock('../../stores/editor.svelte', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const rate = (clip: { playbackRate?: number }) => clip.playbackRate ?? 1
  return {
    ...actual,
    clipPlaybackRate: rate,
    clipTimelineDuration: (clip: { inPoint: number; outPoint: number; playbackRate?: number }) =>
      (clip.outPoint - clip.inPoint) / rate(clip),
    clipEnd: (clip: { start: number; inPoint: number; outPoint: number; playbackRate?: number }) =>
      clip.start + (clip.outPoint - clip.inPoint) / rate(clip),
    clipSourceTimeAt: (clip: { start: number; inPoint: number; playbackRate?: number }, time: number) =>
      clip.inPoint + (time - clip.start) * rate(clip),
  }
})

import { editor } from '../../stores/editor.svelte'
import { render } from '../../stores/render.svelte'

describe('render store', () => {
  beforeEach(() => {
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    render.nodes.splice(0)
    render.transitionNodes.splice(0)
    render.queue.splice(0)
    wasmMocks.renderSegment.mockClear()
    wasmMocks.renderTransition.mockClear()
    wasmMocks.renderAudioTransition.mockClear()
    wasmMocks.getFFmpeg.mockClear()
    wasmMocks.renderSegment.mockImplementation(async () => ({ blobUrl: 'blob:effect', blob: new Blob(), durationSec: 1 }))
    wasmMocks.renderTransition.mockImplementation(async () => ({ blobUrl: 'blob:transition', blob: new Blob(), durationSec: 1 }))
    wasmMocks.renderAudioTransition.mockImplementation(async () => ({ blobUrl: 'blob:audio-transition', blob: new Blob(), durationSec: 1 }))
    editor.selectClip(null)
    editor.setCurrentTime(0)
  })

  it('starts with empty nodes and queue', () => {
    expect(render.nodes).toHaveLength(0)
    expect(render.queue).toHaveLength(0)
    expect(render.processing).toBe(false)
    expect(render.wasmLoadState).toBe('idle')
    expect(render.renderingForPlayback).toBe(false)
  })

  it('previews video effects live in Pixi without loading ffmpeg-wasm', async () => {
    editor.addClip(editor.channels[0].id, {
      fileName: 'load-progress.mp4',
      scrubBlobUrl: 'blob:load-progress',
      sourceDuration: 4,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const block = editor.addEffectBlock(editor.channels[0].id, 'grayscale', 0, 4)!

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(render.nodes).toHaveLength(0)
    expect(wasmMocks.getFFmpeg).not.toHaveBeenCalled()
    expect(wasmMocks.renderSegment).not.toHaveBeenCalled()
    const live = editor.effectBlocks.find((b) => b.id === block.id)
    expect(live?.nodeId?.startsWith('pixi-live:')).toBe(true)
    expect(render.renderingForPlayback).toBe(false)
  })

  it('plays audio transitions live with no ffmpeg-wasm load', async () => {
    const audio = editor.channels[1]
    editor.addClip(audio.id, {
      fileName: 'a1.m4a', scrubBlobUrl: 'blob:a1', sourceDuration: 10,
      inPoint: 0, outPoint: 5, start: 0,
    })
    editor.addClip(audio.id, {
      fileName: 'a2.m4a', scrubBlobUrl: 'blob:a2', sourceDuration: 10,
      inPoint: 0, outPoint: 5, start: 4,
    })

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(wasmMocks.getFFmpeg).not.toHaveBeenCalled()
    expect(wasmMocks.renderAudioTransition).not.toHaveBeenCalled()
    expect(render.transitionNodes).toHaveLength(0)
    expect(render.renderingForPlayback).toBe(false)
  })

  describe('getTopNodeAtStack', () => {
    it('returns null when no nodes exist', () => {
      expect(render.getTopNodeAtStack('clip1', 5)).toBeNull()
    })

    it('returns null when no ready node covers the time', () => {
      render.nodes.push({
        id: 'n1',
        blockId: 'b1',
        clipId: 'clip1',
        parentId: null,
        srcStart: 0,
        srcEnd: 10,
        playbackRate: 1,
        effectId: 'grayscale',
        params: {},
         outputBlobUrl: 'blob:1',
         state: 'ready',
         ramp: null,
        seq: 1,
      })
      expect(render.getTopNodeAtStack('clip1', 15)).toBeNull()
    })

    it('returns the node when it covers the time', () => {
      render.nodes.push({
        id: 'n1',
        blockId: 'b1',
        clipId: 'clip1',
        parentId: null,
        srcStart: 0,
        srcEnd: 10,
        playbackRate: 1,
        effectId: 'grayscale',
        params: {},
         outputBlobUrl: 'blob:1',
         state: 'ready',
         ramp: null,
        seq: 1,
      })
      const result = render.getTopNodeAtStack('clip1', 5)
      expect(result).not.toBeNull()
      expect(result!.id).toBe('n1')
    })

    it('ignores nodes that are not ready', () => {
      render.nodes.push(
        {
          id: 'n1',
          blockId: 'b1',
          clipId: 'clip1',
          parentId: null,
          srcStart: 0,
          srcEnd: 10,
          playbackRate: 1,
          effectId: 'grayscale',
          params: {},
           outputBlobUrl: null,
           state: 'queued',
           ramp: null,
          seq: 1,
        },
        {
          id: 'n2',
          blockId: 'b2',
          clipId: 'clip1',
          parentId: null,
          srcStart: 0,
          srcEnd: 10,
          playbackRate: 1,
          effectId: 'sepia',
          params: {},
           outputBlobUrl: null,
           state: 'rendering',
           ramp: null,
          seq: 2,
        },
      )
      expect(render.getTopNodeAtStack('clip1', 5)).toBeNull()
    })

    it('prefers deeper (higher depth) nodes', () => {
      render.nodes.push(
        {
          id: 'n1',
          blockId: 'b1',
          clipId: 'clip1',
          parentId: null,
          srcStart: 0,
          srcEnd: 10,
          playbackRate: 1,
          effectId: 'grayscale',
          params: {},
           outputBlobUrl: 'blob:1',
           state: 'ready',
           ramp: null,
          seq: 1,
        },
        {
          id: 'n2',
          blockId: 'b2',
          clipId: 'clip1',
          parentId: 'n1',
          srcStart: 0,
          srcEnd: 10,
          playbackRate: 1,
          effectId: 'sepia',
          params: {},
           outputBlobUrl: 'blob:2',
           state: 'ready',
           ramp: null,
          seq: 2,
        },
      )
      const result = render.getTopNodeAtStack('clip1', 5)
      expect(result).not.toBeNull()
      expect(result!.id).toBe('n2')
    })

    it('when depth ties, prefers higher seq', () => {
      render.nodes.push(
        {
          id: 'n1',
          blockId: 'b1',
          clipId: 'clip1',
          parentId: null,
          srcStart: 0,
          srcEnd: 10,
          playbackRate: 1,
          effectId: 'grayscale',
          params: {},
           outputBlobUrl: 'blob:1',
           state: 'ready',
           ramp: null,
          seq: 1,
        },
        {
          id: 'n2',
          blockId: 'b2',
          clipId: 'clip1',
          parentId: null,
          srcStart: 0,
          srcEnd: 10,
          playbackRate: 1,
          effectId: 'sepia',
          params: {},
           outputBlobUrl: 'blob:2',
           state: 'ready',
           ramp: null,
          seq: 5,
        },
      )
      const result = render.getTopNodeAtStack('clip1', 5)
      expect(result).not.toBeNull()
      expect(result!.id).toBe('n2')
    })

    it('filters by clipId correctly', () => {
      render.nodes.push(
        {
          id: 'n1',
          blockId: 'b1',
          clipId: 'clip_a',
          parentId: null,
          srcStart: 0,
          srcEnd: 10,
          playbackRate: 1,
          effectId: 'grayscale',
          params: {},
           outputBlobUrl: 'blob:a',
           state: 'ready',
           ramp: null,
          seq: 1,
        },
        {
          id: 'n2',
          blockId: 'b2',
          clipId: 'clip_b',
          parentId: null,
          srcStart: 0,
          srcEnd: 10,
          playbackRate: 1,
          effectId: 'sepia',
          params: {},
           outputBlobUrl: 'blob:b',
           state: 'ready',
           ramp: null,
          seq: 2,
        },
      )
      expect(render.getTopNodeAtStack('clip_a', 5)).not.toBeNull()
      expect(render.getTopNodeAtStack('clip_a', 5)!.effectId).toBe('grayscale')
      expect(render.getTopNodeAtStack('clip_b', 5)).not.toBeNull()
      expect(render.getTopNodeAtStack('clip_b', 5)!.effectId).toBe('sepia')
    })
  })

  describe('getNodesForClip', () => {
    it('returns filtered nodes for a clip', () => {
      render.nodes.push(
        { id: 'n1', blockId: 'b1', clipId: 'clip1', parentId: null, srcStart: 0, srcEnd: 5, playbackRate: 1, effectId: 'blur', params: {}, ramp: null, outputBlobUrl: null, state: 'queued', seq: 1 },
        { id: 'n2', blockId: 'b2', clipId: 'clip1', parentId: null, srcStart: 5, srcEnd: 10, playbackRate: 1, effectId: 'sepia', params: {}, ramp: null, outputBlobUrl: null, state: 'queued', seq: 2 },
      )
      const clip1Nodes = render.getNodesForClip('clip1')
      expect(clip1Nodes).toHaveLength(2)
      expect(clip1Nodes.every((n) => n.clipId === 'clip1')).toBe(true)
    })

    it('returns empty array when no nodes match', () => {
      expect(render.getNodesForClip('nonexistent')).toHaveLength(0)
    })
  })

  describe('flatten', () => {
    it('returns a pass-through segment when clip has no effect blocks', () => {
      const clip = editor.addClip(editor.channels[0].id, {
        fileName: 'test.mp4',
        scrubBlobUrl: 'blob:test',
        sourceDuration: 20,
        inPoint: 0,
        outPoint: 10,
        start: 0,
      })
      const segs = render.flatten(clip.id)
      expect(segs).toHaveLength(1)
      expect(segs[0].filter).toBeNull()
      expect(segs[0].srcStart).toBe(0)
      expect(segs[0].srcEnd).toBe(10)
    })

    it('returns empty array when clip has no active blocks', () => {
      const clip = editor.addClip(editor.channels[0].id, {
        fileName: 'test.mp4',
        scrubBlobUrl: 'blob:test',
        sourceDuration: 20,
        inPoint: 0,
        outPoint: 10,
        start: 0,
      })
      editor.addEffectBlock(editor.channels[0].id, 'grayscale', 100, 2)
      const segs = render.flatten(clip.id)
      expect(segs).toHaveLength(1)
      expect(segs[0].filter).toBeNull()
    })

    it('includes configured parameters in flattened render segments', () => {
      const clip = editor.addClip(editor.channels[0].id, {
        fileName: 'test.mp4',
        scrubBlobUrl: 'blob:test',
        sourceDuration: 20,
        inPoint: 0,
        outPoint: 10,
        start: 0,
      })
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 0, 10)!
      editor.setEffectParameter([block.id], 'lumaRadius', 22)

      const [segment] = render.flatten(clip.id)

      expect(segment.effects).toEqual([{ id: 'blur', params: {
        lumaRadius: 22,
        lumaPower: 1,
        chromaRadius: 4,
        chromaPower: 1,
      } }])
      expect(segment.filter).toContain("luma_radius='min(22,min(w,h)/2)'")
    })

    it('keeps a ramp continuous when another effect splits its block into regions', () => {
      const clip = editor.addClip(editor.channels[0].id, {
        fileName: 'ramp.mp4',
        scrubBlobUrl: 'blob:ramp',
        sourceDuration: 20,
        inPoint: 2,
        outPoint: 12,
        start: 5,
        playbackRate: 2,
      })
      const ramped = editor.addEffectBlock(editor.channels[0].id, 'blur', 6, 4)!
      editor.setEffectRamp([ramped.id], { mode: 'in-out', curve: 'ease-in-out', amount: 0.25 })
      editor.addEffectBlock(editor.channels[0].id, 'sepia', 8, 1)

      const rampSegments = render.flatten(clip.id)
        .filter((segment) => segment.effects.some((effect) => effect.id === 'blur'))
      const offsets = rampSegments.map((segment) => (
        segment.effects.find((effect) => effect.id === 'blur')!.ramp!.offset
      ))

      expect(offsets).toEqual([0, 2, 3])
      for (const segment of rampSegments) {
        const ramp = segment.effects.find((effect) => effect.id === 'blur')!.ramp
        expect(ramp).toMatchObject({
          mode: 'in-out', curve: 'ease-in-out', amount: 0.25, blockDuration: 4,
        })
        // blur crossfades its boxblur like the Pixi preview (no sendcmd).
        expect(segment.filter).toContain('boxblur=')
        expect(segment.filter).toContain('blend=all_expr=')
        expect(segment.filter).not.toContain('sendcmd=')
      }
    })

    it('covers an effect stretched across two clips (cut segments)', () => {
      const ch = editor.channels[0]
      const left = editor.addClip(ch.id, {
        fileName: 'a.mp4', scrubBlobUrl: 'blob:a', sourceDuration: 20,
        inPoint: 0, outPoint: 5, start: 0,
      })
      const right = editor.addClip(ch.id, {
        fileName: 'b.mp4', scrubBlobUrl: 'blob:b', sourceDuration: 20,
        inPoint: 0, outPoint: 5, start: 5,
      })
      // Effect starts inside the left clip and extends into the right one.
      editor.addEffectBlock(ch.id, 'grayscale', 4, 3)

      const segsLeft = render.flatten(left.id)
      const segsRight = render.flatten(right.id)

      // Left clip: pass-through [0,4), grayscale [4,5)
      const fxLeft = segsLeft.filter((s) => s.filter !== null)
      expect(fxLeft).toHaveLength(1)
      expect(fxLeft[0].srcStart).toBeCloseTo(4)
      expect(fxLeft[0].srcEnd).toBeCloseTo(5)
      // Right clip: grayscale [5,7) mapped to source [0,2)
      const fxRight = segsRight.filter((s) => s.filter !== null)
      expect(fxRight).toHaveLength(1)
      expect(fxRight[0].srcStart).toBeCloseTo(0)
      expect(fxRight[0].srcEnd).toBeCloseTo(2)
    })

    it('maps timeline effect boundaries into source time at the clip rate', () => {
      const clip = editor.addClip(editor.channels[0].id, {
        fileName: 'fast.mp4',
        scrubBlobUrl: 'blob:fast',
        sourceDuration: 20,
        inPoint: 2,
        outPoint: 10,
        start: 5,
        playbackRate: 2,
      })
      editor.addEffectBlock(editor.channels[0].id, 'grayscale', 6, 2)

      const effectSegment = render.flatten(clip.id).find((segment) => segment.filter !== null)

      expect(effectSegment?.srcStart).toBe(4)
      expect(effectSegment?.srcEnd).toBe(8)
    })
  })

  it('does not apply a clip-owned effect to an adjacent clip', () => {
    const channel = editor.channels[0]
    const owner = editor.addClip(channel.id, {
      fileName: 'owner.mp4', scrubBlobUrl: null, sourceDuration: 5, inPoint: 0, outPoint: 5, start: 0,
    })
    const adjacent = editor.addClip(channel.id, {
      fileName: 'adjacent.mp4', scrubBlobUrl: null, sourceDuration: 5, inPoint: 0, outPoint: 5, start: 5,
    })
    const block = editor.addEffectBlock(channel.id, 'sepia', 4, 2)!
    block.ownerClipId = owner.id

    expect(render.flatten(owner.id).some((segment) => segment.effects.some(({ id }) => id === 'sepia'))).toBe(true)
    expect(render.flatten(adjacent.id).some((segment) => segment.effects.some(({ id }) => id === 'sepia'))).toBe(false)
  })

  it('updates effect coverage while moving between clips and stretching across them', () => {
    const channel = editor.channels[0]
    const first = editor.addClip(channel.id, {
      fileName: 'first.mp4', scrubBlobUrl: null, sourceDuration: 5, inPoint: 0, outPoint: 5, start: 0,
    })
    const second = editor.addClip(channel.id, {
      fileName: 'second.mp4', scrubBlobUrl: null, sourceDuration: 5, inPoint: 0, outPoint: 5, start: 5,
    })
    const block = editor.addEffectBlock(channel.id, 'sepia', 0, 5)!
    editor.anchorEffectBlock(block.id, 2)
    const coverage = (clipId: string) => render.flatten(clipId)
      .filter((segment) => segment.effects.some(({ id }) => id === 'sepia'))
      .map(({ srcStart, srcEnd }) => [srcStart, srcEnd])

    editor.moveEffectBlocks([block.id], 2)
    expect(coverage(first.id)).toEqual([[2, 5]])
    expect(coverage(second.id)).toEqual([[0, 2]])

    editor.moveEffectBlock(block.id, 5)
    expect(editor.effectBlocks.find((candidate) => candidate.id === block.id)!.ownerClipId).toBe(second.id)
    expect(coverage(first.id)).toEqual([])
    expect(coverage(second.id)).toEqual([[0, 5]])

    editor.resizeEffectBlockRange(block.id, 0, 10)
    expect(coverage(first.id)).toEqual([[0, 5]])
    expect(coverage(second.id)).toEqual([[0, 5]])
  })

  it('stacks video effects live in Pixi with no wasm render', async () => {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'stack.mp4',
      scrubBlobUrl: 'blob:stack',
      sourceDuration: 20,
      inPoint: 0,
      outPoint: 8,
      start: 0,
      playbackRate: 2,
    })
    const b1 = editor.addEffectBlock(editor.channels[0].id, 'grayscale', 1, 2)!
    const b2 = editor.addEffectBlock(editor.channels[0].id, 'vignette', 1, 2)!

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(render.getNodesForClip(clip.id)).toHaveLength(0)
    expect(wasmMocks.renderSegment).not.toHaveBeenCalled()
    const live1 = editor.effectBlocks.find((b) => b.id === b1.id)
    const live2 = editor.effectBlocks.find((b) => b.id === b2.id)
    expect(live1?.nodeId?.startsWith('pixi-live:')).toBe(true)
    expect(live2?.nodeId?.startsWith('pixi-live:')).toBe(true)
    const segs = render.flatten(clip.id)
    expect(segs.some((s) => s.filter?.includes('hue=s=0'))).toBe(true)
    expect(segs.some((s) => s.filter?.includes('vignette'))).toBe(true)
  })

  it('keeps still images live in Pixi with no root effect render', async () => {
    editor.addClip(editor.channels[0].id, {
      fileName: 'photo.jpg',
      mediaKind: 'image',
      scrubBlobUrl: 'blob:photo',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 10,
      start: 0,
    })
    editor.addEffectBlock(editor.channels[0].id, 'vignette', 0, 10)

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(wasmMocks.renderSegment).not.toHaveBeenCalled()
    expect(render.nodes).toHaveLength(0)
  })

  it('needs zero preview jobs for Pixi video effects', async () => {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'aggregate-progress.mp4',
      scrubBlobUrl: 'blob:aggregate-progress',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    editor.addEffectBlock(editor.channels[0].id, 'grayscale', 0, 2)
    editor.addEffectBlock(editor.channels[0].id, 'sepia', 0, 2)

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(render.renderingForPlayback).toBe(false)
    expect(render.renderProgressTotal).toBe(0)
    expect(wasmMocks.renderSegment).not.toHaveBeenCalled()
    expect(editor.getClipById(clip.id)).toBeTruthy()
  })

  it('evaluates ramp intensity live per frame instead of baking', async () => {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'ramp-preview.mp4',
      scrubBlobUrl: 'blob:ramp-preview',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const block = editor.addEffectBlock(editor.channels[0].id, 'sepia', 0, 4)!
    editor.setEffectRamp([block.id], { mode: 'in', curve: 'linear', amount: 0.5 })

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(render.getNodesForClip(clip.id)).toHaveLength(0)
    expect(wasmMocks.renderSegment).not.toHaveBeenCalled()
    const live = editor.effectBlocks.find((b) => b.id === block.id)
    expect(live?.nodeId?.startsWith('pixi-live:')).toBe(true)
    const segs = render.flatten(clip.id)
    expect(segs.some((s) => s.filter?.includes('blend=all_expr='))).toBe(true)

    editor.setEffectRamp([block.id], { mode: 'in-out', curve: 'ease-in-out', amount: 0.4 })
    await expect(render.prepareForPlayback()).resolves.toBe(true)
    const updated = editor.effectBlocks.find((b) => b.id === block.id)
    expect(updated?.ramp).toMatchObject({ mode: 'in-out', curve: 'ease-in-out', amount: 0.4 })
    expect(wasmMocks.renderSegment).not.toHaveBeenCalled()
  })

  it('crossfades blur live in Pixi instead of sendcmd baking', async () => {
    editor.addClip(editor.channels[0].id, {
      fileName: 'animated-blur.mp4',
      scrubBlobUrl: 'blob:animated-blur',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 0, 4)!
    editor.setEffectParameter([block.id], 'lumaRadius', 41)
    editor.setEffectRamp([block.id], { mode: 'in-out', curve: 'ease-in-out', amount: 0.25 })

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(render.nodes).toHaveLength(0)
    expect(wasmMocks.renderSegment).not.toHaveBeenCalled()
    const { buildFilter } = await import('../../lib/effects')
    const filter = buildFilter('blur', 4, { lumaRadius: 41, lumaPower: 1, chromaRadius: 4, chromaPower: 1 }, {
      mode: 'in-out', curve: 'ease-in-out', amount: 0.25, blockDuration: 4, offset: 0,
    })
    expect(filter).toContain('boxblur=')
    expect(filter).toContain('blend=all_expr=')
    expect(filter).not.toContain('sendcmd=')
  })

  it('keeps interior ramp order live in Pixi with no baked nodes', async () => {
    editor.addClip(editor.channels[0].id, {
      fileName: 'interior-ramp.mp4',
      scrubBlobUrl: 'blob:interior-ramp',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const lower = editor.addEffectBlock(editor.channels[0].id, 'vignette', 0, 4)!
    editor.setEffectRamp([lower.id], { mode: 'in', curve: 'ease-in', amount: 0.5 })
    editor.addEffectBlock(editor.channels[0].id, 'sepia', 0, 4)

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(render.nodes).toHaveLength(0)
    expect(wasmMocks.renderSegment).not.toHaveBeenCalled()
  })

  it('renders video overlaps live in Pixi with no transition nodes', async () => {
    const channel = editor.channels[0]
    editor.addClip(channel.id, {
      fileName: 'left.mp4',
      scrubBlobUrl: 'blob:left',
      sourceDuration: 20,
      inPoint: 0,
      outPoint: 8,
      start: 0,
      playbackRate: 2,
    })
    editor.addClip(channel.id, {
      fileName: 'right.mp4',
      scrubBlobUrl: 'blob:right',
      sourceDuration: 20,
      inPoint: 1,
      outPoint: 9,
      start: 3,
      playbackRate: 0.5,
    })

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(render.transitionNodes.filter((n) => !n.isAudio)).toHaveLength(0)
    expect(wasmMocks.renderTransition).not.toHaveBeenCalled()
    expect(wasmMocks.getFFmpeg).not.toHaveBeenCalled()
  })

  it('keeps image overlaps live with no prerendered transition', async () => {
    const channel = editor.channels[0]
    editor.addClip(channel.id, {
      fileName: 'left.jpg', mediaKind: 'image', scrubBlobUrl: 'blob:left', sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    editor.addClip(channel.id, {
      fileName: 'right.png', mediaKind: 'image', scrubBlobUrl: 'blob:right', sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 1,
    })

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(wasmMocks.renderTransition).not.toHaveBeenCalled()
    expect(render.transitionNodes).toHaveLength(0)
  })

  it('applies clip effects and transforms live with no baked transition inputs', async () => {
    const channel = editor.channels[0]
    const left = editor.addClip(channel.id, {
      fileName: 'left.jpg', mediaKind: 'image', scrubBlobUrl: 'blob:left', sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const right = editor.addClip(channel.id, {
      fileName: 'right.jpg', mediaKind: 'image', scrubBlobUrl: 'blob:right', sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 1,
    })
    editor.setClipTransform(left.id, { positionX: -12, zoomX: 1.1, zoomY: 1.1 })
    editor.setClipTransform(right.id, { positionX: 14, rotation: 8 })
    editor.addEffectBlock(channel.id, 'grayscale', 0, 2)!.ownerClipId = left.id
    editor.addEffectBlock(channel.id, 'sepia', 1, 2)!.ownerClipId = right.id

    await expect(render.prepareForPlayback()).resolves.toBe(true)

    expect(wasmMocks.renderSegment).not.toHaveBeenCalled()
    expect(wasmMocks.renderTransition).not.toHaveBeenCalled()
    expect(render.flatten(left.id).some((s) => s.filter?.includes('hue=s=0'))).toBe(true)

    editor.setClipTransform(left.id, { positionX: -20 })
    await expect(render.prepareForPlayback()).resolves.toBe(true)
    expect(wasmMocks.renderTransition).not.toHaveBeenCalled()
  })

  describe('removeNode and clearForClip', () => {
    beforeEach(() => {
      render.nodes.push(
        { id: 'n1', blockId: 'b1', clipId: 'clip1', parentId: null, srcStart: 0, srcEnd: 5, playbackRate: 1, effectId: 'blur', params: {}, ramp: null, outputBlobUrl: null, state: 'queued', seq: 1 },
        { id: 'n2', blockId: 'b2', clipId: 'clip1', parentId: 'n1', srcStart: 0, srcEnd: 5, playbackRate: 1, effectId: 'sepia', params: {}, ramp: null, outputBlobUrl: null, state: 'queued', seq: 2 },
        { id: 'n3', blockId: 'b3', clipId: 'clip2', parentId: null, srcStart: 0, srcEnd: 5, playbackRate: 1, effectId: 'grayscale', params: {}, ramp: null, outputBlobUrl: null, state: 'queued', seq: 3 },
      )
      render.queue.push('n1', 'n2', 'n3')
    })

    it('removeNode removes the node and its descendants', () => {
      render.removeNode('n1')
      expect(render.nodes.find((n) => n.id === 'n1')).toBeUndefined()
      expect(render.nodes.find((n) => n.id === 'n2')).toBeUndefined()
      expect(render.nodes.find((n) => n.id === 'n3')).toBeTruthy()
    })

    it('clearForClip removes all nodes for the clip', () => {
      render.clearForClip('clip1')
      expect(render.nodes.find((n) => n.clipId === 'clip1')).toBeUndefined()
      expect(render.nodes.find((n) => n.clipId === 'clip2')).toBeTruthy()
    })

    it('removeNode does nothing for unknown node', () => {
      render.removeNode('nonexistent')
      expect(render.nodes).toHaveLength(3)
    })
  })
})
