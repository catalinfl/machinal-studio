import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAIImageJob } from '../../lib/ai-image'
import { clearMediaBinSources, getMediaBinSources, registerMediaBinSource } from '../../lib/media-bin'
import { editor } from '../../stores/editor.svelte'

const api = vi.hoisted(() => ({
  requestImage: vi.fn(),
  download: vi.fn(),
}))

vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  requestAIImage: api.requestImage,
  downloadFile: api.download,
}))

describe('AI image workflow', () => {
  beforeEach(() => {
    api.requestImage.mockReset().mockResolvedValue({
      id: 'generated-1',
      name: 'ai_image_generated-1.png',
      mediaType: 'image/png',
      width: 1920,
      height: 1080,
      sourceMode: 'proxy',
    })
    api.download.mockReset().mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:generated') })
    clearMediaBinSources()
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.setCurrentTime(2)
    editor.clearSelection()
    editor.clearHistory()
  })

  it('registers a generated image without changing the timeline for Media Bin placement', async () => {
    const result = await executeAIImageJob({ prompt: 'A product cutout', placement: 'media-bin' })

    expect(result.clip).toBeUndefined()
    expect(editor.channels.every((channel) => channel.clips.length === 0)).toBe(true)
    expect(getMediaBinSources()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ai_image_generated-1.png', kind: 'image', sourceMode: 'proxy', scrubBlobUrl: 'blob:generated' }),
    ]))
  })

  it('adds a transparent overlay on an upper video track and preserves base audio', async () => {
    const baseVideo = editor.addClip(editor.channels[0].id, {
      fileName: 'base.mp4', sourceDuration: 12, inPoint: 0, outPoint: 12, start: 0, mediaKind: 'video', scrubBlobUrl: 'blob:base',
    })
    const baseAudio = editor.addClip(editor.channels[1].id, {
      fileName: 'base.mp4', sourceDuration: 12, inPoint: 0, outPoint: 12, start: 0, mediaKind: 'audio', scrubBlobUrl: 'blob:audio',
    })

    const result = await executeAIImageJob({
      prompt: 'A calendar and clock', placement: 'overlay', position: 'right', start: 3, duration: 4,
    })

    expect(api.requestImage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-image-2.6-sunburst', background: 'transparent', aspect: '16:9',
    }), undefined)
    expect(api.requestImage.mock.calls[0][0]).not.toHaveProperty('quality')
    expect(api.requestImage.mock.calls[0][0].prompt).toContain('genuinely transparent alpha channel')
    expect(api.requestImage.mock.calls[0][0].prompt).toContain('Do not draw a checkerboard')
    expect(editor.channels.filter((channel) => channel.type === 'video')).toHaveLength(2)
    expect(result.clip).toMatchObject({ start: 3, opacity: 1, fadeIn: 0.35, fadeOut: 0.35 })
    expect(result.clip?.transform).toMatchObject({ zoomX: 0.62, positionX: 24 })
    expect(editor.getClipById(baseVideo.id)).toBeTruthy()
    expect(editor.getClipById(baseAudio.id)).toBeTruthy()
  })

  it('explicitly asks for a background when opaque output is selected', async () => {
    const result = await executeAIImageJob({ prompt: 'A mountain establishing shot', placement: 'overlay', background: 'opaque', start: 1, duration: 5 })

    expect(api.requestImage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-image-2.6-sunburst', background: 'opaque',
    }), undefined)
    expect(api.requestImage.mock.calls[0][0].prompt).toContain('include a complete, natural background')
    expect(result.clip?.motionPreset).toBe('none')
    expect(result.clip?.transform).toMatchObject({ positionX: 0 })
  })

  it('rejects browser-local references before calling the model', async () => {
    registerMediaBinSource({
      id: 'local-image', name: 'local.png', kind: 'image', duration: 10, sourceMode: 'wasm', scrubBlobUrl: 'blob:local',
    })

    await expect(executeAIImageJob({ prompt: 'Make it watercolor', sourceName: 'local.png', placement: 'media-bin' }))
      .rejects.toThrow('only for images in Proxy mode')
    expect(api.requestImage).not.toHaveBeenCalled()
  })

  it('keeps the final provider prompt within the 4000-character budget', async () => {
    await executeAIImageJob({ prompt: 'a'.repeat(3999), style: 'cinematic editorial photography', placement: 'media-bin', background: 'transparent' })

    const providerPrompt = api.requestImage.mock.calls[0][0].prompt as string
    expect(Array.from(providerPrompt).length).toBeLessThanOrEqual(4000)
    expect(providerPrompt.startsWith('a')).toBe(true)
    expect(providerPrompt).toContain('genuinely transparent alpha channel')
  })
})
