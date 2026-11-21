import { describe, expect, it } from 'vitest'
import {
  baseRenderClipPayload,
  buildAudioClipPayload,
  buildVideoClipPayload,
  buildRenderPayload,
  validateRender,
} from '../../composables/useRenderMenu.svelte'
import type { Clip } from '../../stores/editor.svelte'
import { DEFAULT_CLIP_TRANSFORM } from '../../lib/clip-transform'

const clip: Clip = {
  id: 'clip-1',
  fileName: 'source.mp4',
  sourceMode: 'proxy',
  sourceId: 'source-1',
  mediaKind: 'video',
  scrubBlobUrl: null,
  sourceDuration: 10,
  inPoint: 1,
  outPoint: 6,
  start: 2,
  playbackRate: 1.5,
  transform: DEFAULT_CLIP_TRANSFORM,
  opacity: 0.8,
  fadeIn: 0.25,
  fadeOut: 0.5,
}

describe('useRenderMenu pure helpers', () => {
  it('passes project framing to local and server render payloads', () => {
    const settings = { format: 'mp4' as const, quality: 'normal' as const }
    expect(buildRenderPayload(settings, { w: 1080, h: 1920 }, 30, [], [], [], 'cover').fit).toBe('cover')
    expect(buildRenderPayload(settings, { w: 1080, h: 1920 }, 30, [], [], []).fit).toBe('contain')
  })

  it('maps common clip fields once and preserves media-specific payloads', () => {
    expect(baseRenderClipPayload(clip)).toMatchObject({
      file: 'source.mp4',
      sourceMode: 'proxy',
      sourceId: 'source-1',
      mediaKind: 'video',
      inPoint: 1,
      outPoint: 6,
      start: 2,
      playbackRate: 1.5,
      segments: [],
    })

    expect(buildVideoClipPayload(clip, [{ srcStart: 1, srcEnd: 2, effects: [] }])).toMatchObject({
      transform: clip.transform,
      opacity: 0.8,
      fadeIn: 0.25,
      fadeOut: 0.5,
      segments: [{ srcStart: 1, srcEnd: 2, effects: [] }],
    })

    expect(buildAudioClipPayload({ ...clip, mediaKind: 'audio', volume: 65 })).toMatchObject({
      volume: 65,
      segments: [],
    })
  })

  it('returns validation messages without touching browser or render APIs', () => {
    expect(validateRender('server', 'mp4', true, true)).toBe('Local media can only be rendered on this device')
    expect(validateRender('local', 'mp3', false, false)).toBe('Add an active audio clip to export MP3')
    expect(validateRender('server', 'mp4', false, false)).toBe('no clips to export')
    expect(validateRender('local', 'mp4', false, true)).toBeNull()
  })
})
