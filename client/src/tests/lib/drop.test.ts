import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDroppedClip, attachPreparedSourceAudio, insertPreparedMedia, prepareMediaInsertion, type PreparedMediaInsertion } from '../../lib/drop'
import { getAudioPreview } from '../../lib/api'
import { extractAudio } from '../../lib/wasm'
import * as localMedia from '../../lib/local-media'
import { clipEnd, editor } from '../../stores/editor.svelte'
import { mediaProcessing } from '../../stores/media-processing.svelte'

vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  getAudioPreview: vi.fn(),
}))
vi.mock('../../lib/wasm', () => ({ extractAudio: vi.fn() }))

describe('timeline media insertion', () => {
  beforeEach(() => {
    vi.mocked(getAudioPreview).mockReset().mockResolvedValue('blob:server-audio')
    vi.mocked(extractAudio).mockReset()
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.clearHistory()
  })

  it('adds linked audio for a very long server video without loading WASM', async () => {
    const added = await addDroppedClip(editor.channels[0], {
      fileName: 'large.mp4', sourceMode: 'proxy', mediaKind: 'video',
      scrubBlobUrl: 'blob:large-proxy', sourceDuration: 7200,
    }, 0)
    expect(getAudioPreview).toHaveBeenCalledExactlyOnceWith('large.mp4')
    expect(extractAudio).not.toHaveBeenCalled()
    expect(added?.linkedAudio?.scrubBlobUrl).toBe('blob:server-audio')
    expect(added?.linkedAudio?.outPoint).toBe(7200)
    expect(editor.getClipById(added!.primary.id)?.clip.linkedClipId).toBe(added?.linkedAudio?.id)
    expect(mediaProcessing.active).toBe(false)
  })

  it('uses server audio for video dropped directly on an audio channel', async () => {
    const prepared = await prepareMediaInsertion(editor.channels[1], {
      fileName: 'large.mp4', scrubMode: 'proxy', mediaKind: 'video',
      scrubBlobUrl: 'blob:large-proxy', sourceDuration: 7200,
    })
    expect(prepared?.audioBlobUrl).toBe('blob:server-audio')
    expect(extractAudio).not.toHaveBeenCalled()
  })

  it('leaves a confirmed silent server video unpaired', async () => {
    vi.mocked(getAudioPreview).mockResolvedValueOnce(null)
    const added = await addDroppedClip(editor.channels[0], {
      fileName: 'silent.mp4', sourceMode: 'proxy', scrubBlobUrl: 'blob:silent', sourceDuration: 7200,
    }, 0)
    expect(added?.primary).toBeDefined()
    expect(added?.linkedAudio).toBeUndefined()
    expect(editor.channels[1].clips).toHaveLength(0)
  })

  it('does not disguise server audio failures as silent videos', async () => {
    vi.mocked(getAudioPreview).mockRejectedValueOnce(new Error('Cannot prepare audio: HTTP 500'))
    await expect(addDroppedClip(editor.channels[0], {
      fileName: 'large.mp4', sourceMode: 'proxy', scrubBlobUrl: 'blob:large', sourceDuration: 7200,
    }, 0)).resolves.toBeNull()
    expect(mediaProcessing.error).toContain('Cannot prepare audio')
    expect(mediaProcessing.active).toBe(false)
    expect(mediaProcessing.longVideoActive).toBe(false)
  })

  it('reuses the video URL for huge local videos without WASM extract', async () => {
    vi.spyOn(localMedia, 'getLocalSource').mockReturnValueOnce({ size: 2 * 1024 * 1024 * 1024 } as File)
    const added = await addDroppedClip(editor.channels[0], {
      fileName: 'huge.mp4', sourceMode: 'wasm', sourceId: 'src-huge', mediaKind: 'video',
      scrubBlobUrl: 'blob:huge-video', sourceDuration: 7200,
    }, 0)
    expect(extractAudio).not.toHaveBeenCalled()
    expect(added?.primary).toBeDefined()
    expect(added?.linkedAudio?.scrubBlobUrl).toBe('blob:huge-video')
    expect(mediaProcessing.active).toBe(false)
  })

  it('does not let a dropped long clip fully cover a short clip', () => {
    const channel = editor.channels[0]
    const shortClip = editor.addClip(channel.id, {
      fileName: 'short.mp4',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:short',
      sourceDuration: 1,
      inPoint: 0,
      outPoint: 1,
      start: 0,
    })
    const prepared: PreparedMediaInsertion = {
      parsed: { fileName: 'long.mp4', mediaKind: 'video' },
      mediaKind: 'video',
      scrubBlobUrl: 'blob:long',
      audioBlobUrl: null,
      sourceDuration: 10,
    }

    const added = insertPreparedMedia(channel, prepared, 0, { includeAudio: false })

    expect(added).not.toBeNull()
    const overlap = Math.min(clipEnd(shortClip), clipEnd(added!.primary))
      - Math.max(shortClip.start, added!.primary.start)
    expect(added!.primary.start).toBeCloseTo(0.55)
    expect(overlap).toBeCloseTo(0.45)
    expect(overlap).toBeLessThan(shortClip.outPoint / 2)
  })

  it('keeps linked video and audio channels together when routing an overlapping drop', async () => {
    const firstVideo = editor.channels[0]
    const firstAudio = editor.channels[1]
    const existingVideo = editor.addClip(firstVideo.id, {
      fileName: 'short.mp4',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:short',
      sourceDuration: 1,
      inPoint: 0,
      outPoint: 1,
      start: 0,
    })
    const existingAudio = editor.addClip(firstAudio.id, {
      fileName: 'short.mp4',
      mediaKind: 'audio',
      scrubBlobUrl: 'blob:short-audio',
      sourceDuration: 1,
      inPoint: 0,
      outPoint: 1,
      start: 0,
    })
    existingVideo.linkedClipId = existingAudio.id
    existingAudio.linkedClipId = existingVideo.id

    const added = await addDroppedClip(firstVideo, {
      fileName: 'long.mp4',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:long',
      sourceDuration: 10,
    }, 0, { includeAudio: false })
    const linkedAudio = attachPreparedSourceAudio(added!.primary.id, {
      parsed: { fileName: 'long.mp4', mediaKind: 'video' },
      mediaKind: 'video',
      scrubBlobUrl: 'blob:long',
      audioBlobUrl: 'blob:long-audio',
      sourceDuration: 10,
    })

    const videoChannels = editor.channels.filter((channel) => channel.type === 'video')
    expect(videoChannels).toHaveLength(2)
    expect(firstVideo.clips).toHaveLength(1)
    expect(added?.primary.start).toBe(0)
    expect(videoChannels[1].clips.map((clip) => clip.id)).toEqual([added?.primary.id])
    expect(editor.channels.map((channel) => channel.type)).toEqual(['video', 'audio', 'video', 'audio'])
    expect(editor.channels[0].id).toBe(firstVideo.id)
    expect(editor.channels[1].id).toBe(firstAudio.id)
    expect(editor.channels[3].clips.map((clip) => clip.id)).toContain(linkedAudio?.id)
  })

  it('keeps a video drop on the same channel at exactly 50% overlap', async () => {
    const firstVideo = editor.channels[0]
    editor.addClip(firstVideo.id, {
      fileName: 'existing.mp4',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:existing',
      sourceDuration: 4,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })

    const added = await addDroppedClip(firstVideo, {
      fileName: 'half-overlap.mp4',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:half-overlap',
      sourceDuration: 2,
    }, 3, { includeAudio: false })

    expect(editor.channels.filter((channel) => channel.type === 'video')).toHaveLength(1)
    expect(firstVideo.clips.map((clip) => clip.id)).toContain(added?.primary.id)
  })

  it('routes a short video away from a much longer overlapping video', async () => {
    const firstVideo = editor.channels[0]
    const existing = editor.addClip(firstVideo.id, {
      fileName: 'long.mp4',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:long',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 10,
      start: 0,
    })

    const added = await addDroppedClip(firstVideo, {
      fileName: 'short.mp4',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:short',
      sourceDuration: 1,
    }, 4, { includeAudio: false })

    const videoChannels = editor.channels.filter((channel) => channel.type === 'video')
    expect(videoChannels).toHaveLength(2)
    expect(firstVideo.clips.map((clip) => clip.id)).toEqual([existing.id])
    expect(videoChannels[1].clips.map((clip) => clip.id)).toEqual([added?.primary.id])
    expect(added?.primary.start).toBe(4)
  })

  it('routes an overlapping audio drop to another audio channel', async () => {
    const firstAudio = editor.channels[1]
    const existing = editor.addClip(firstAudio.id, {
      fileName: 'long.mp3',
      mediaKind: 'audio',
      scrubBlobUrl: 'blob:long-audio',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 10,
      start: 0,
    })

    const added = await addDroppedClip(firstAudio, {
      fileName: 'short.mp3',
      mediaKind: 'audio',
      scrubBlobUrl: 'blob:short-audio',
      sourceDuration: 1,
    }, 4)

    const audioChannels = editor.channels.filter((channel) => channel.type === 'audio')
    expect(audioChannels).toHaveLength(2)
    expect(firstAudio.clips.map((clip) => clip.id)).toEqual([existing.id])
    expect(audioChannels[1].clips.map((clip) => clip.id)).toEqual([added?.primary.id])
    expect(added?.primary.start).toBe(4)
  })

  it('initializes video audio placed on an audio channel at 100 percent', () => {
    const prepared: PreparedMediaInsertion = {
      parsed: { fileName: 'video.mp4', mediaKind: 'video' },
      mediaKind: 'video',
      scrubBlobUrl: 'blob:video',
      audioBlobUrl: 'blob:video-audio',
      sourceDuration: 5,
    }

    const added = insertPreparedMedia(editor.channels[1], prepared, 0)

    expect(added?.primary.volume).toBe(100)
  })

  it('initializes linked source audio at 100 percent', () => {
    const video = editor.addClip(editor.channels[0].id, {
      fileName: 'video.mp4',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:video',
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })

    const audio = attachPreparedSourceAudio(video.id, {
      parsed: { fileName: 'video.mp4', mediaKind: 'video' },
      mediaKind: 'video',
      scrubBlobUrl: 'blob:video',
      audioBlobUrl: 'blob:video-audio',
      sourceDuration: 5,
    })

    expect(audio?.volume).toBe(100)
  })

  it('marks a very long audio drop for global preparation feedback', async () => {
    const beginLongVideo = vi.spyOn(mediaProcessing, 'beginLongVideo')
    const endLongVideo = vi.spyOn(mediaProcessing, 'endLongVideo')

    try {
      const added = await addDroppedClip(editor.channels[1], {
        fileName: 'long.mp3',
        mediaKind: 'audio',
        scrubBlobUrl: 'blob:long-audio',
        sourceDuration: 20,
      }, 0)

      expect(added).not.toBeNull()
      expect(beginLongVideo).toHaveBeenCalledWith('audio')
      expect(endLongVideo).toHaveBeenCalledOnce()
    } finally {
      beginLongVideo.mockRestore()
      endLongVideo.mockRestore()
    }
  })
})
