import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiProjectRevision, applyAIEditPlan, buildAIProjectContext } from '../../lib/ai-edit'
import { generateCaptions, getAudioPreview, type AIEditPlan } from '../../lib/api'
import { clipEnd, editor, type Clip } from '../../stores/editor.svelte'
import { clearMediaBinSources, registerMediaBinSource } from '../../lib/media-bin'
import { extractAudio } from '../../lib/wasm'

const speech = vi.hoisted(() => ({
  prepare: vi.fn(),
  register: vi.fn(),
}))

vi.mock('../../lib/wasm', () => ({
  extractAudio: vi.fn(async () => ({ blobUrl: 'blob:extracted-audio', blob: new Blob() })),
}))

vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  getAudioPreview: vi.fn(),
  generateCaptions: vi.fn(),
}))

vi.mock('../../lib/speech', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/speech')>(),
  prepareSpeech: speech.prepare,
  registerGeneratedSpeech: speech.register,
}))

function clip(overrides: Partial<Clip> = {}): Omit<Clip, 'id'> {
  return {
    fileName: 'clip.mp4',
    scrubBlobUrl: null,
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 10,
    start: 0,
    ...overrides,
  }
}

describe('AI timeline edits', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    editor.clearTimeline()
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.setCurrentTime(0)
    editor.resetProjectAspect()
    editor.clearHistory()
    clearMediaBinSources()
    vi.mocked(extractAudio).mockReset().mockResolvedValue({ blobUrl: 'blob:extracted-audio', blob: new Blob() })
    vi.mocked(getAudioPreview).mockReset().mockResolvedValue('blob:extracted-audio')
    vi.mocked(generateCaptions).mockReset()
    speech.prepare.mockReset()
    speech.register.mockReset()
  })

  it('builds a compact context without blob URLs or render node IDs', () => {
    registerMediaBinSource({
      id: 'catalog-source',
      name: 'clip.mp4',
      kind: 'video',
      duration: 10,
      sourceId: 'local-source',
      sourceMode: 'wasm',
      scrubBlobUrl: 'blob:media-bin-preview',
    })
    const clipItem = editor.addClip(editor.channels[0].id, clip({
      sourceId: 'local-source',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:large-preview',
    }))
    editor.setClipTransformKeyframes(clipItem.id, { zoomX: 1.1 } as NonNullable<Clip['transform']>, [
      { time: 0, transform: { zoomX: 1.1 } as NonNullable<Clip['transform']> },
      { time: 2, transform: { zoomX: 1.3 } as NonNullable<Clip['transform']> },
    ], 'zoom-in')
    const effect = editor.addEffectBlock(editor.channels[0].id, 'sepia', 1, 2)!
    editor.setEffectBlockNode(effect.id, 'render-resource')
    editor.addTextItem(1, {
      text: 'Active caption',
      duration: 2,
      isCaption: true,
      highlightMode: 'word',
      highlightColor: '#ffcc00',
      animation: 'bounce',
    })
    editor.selectClip(clipItem.id)
    editor.setCurrentTime(2)

    const context = buildAIProjectContext()
    const serialized = JSON.stringify(context)

    expect(context.focus).toMatchObject({ playhead: 2, selectedClipIds: [clipItem.id] })
    expect(context.tracks[0]).toMatchObject({ name: 'Video 1', muted: false, hidden: false })
    expect(context.tracks[0].clips[0]).toMatchObject({ name: 'clip.mp4', sourceId: 'catalog-source', sourceDuration: 10, start: 0, end: 10, sourceIn: 0, sourceOut: 10 })
    expect(context.tracks[0].clips[0].transformKeyframes).toHaveLength(2)
    expect(context.tracks[0].clips[0].motionPreset).toBe('zoom-in')
    expect(context.sources[0]).toMatchObject({ id: 'catalog-source', sourceMode: 'wasm', timelineClipIds: [clipItem.id] })
    expect(context.texts[0].style).toMatchObject({ isCaption: true, highlightMode: 'word', highlightColor: '#ffcc00', animation: 'bounce' })
    expect(serialized).not.toContain('blob:large-preview')
    expect(serialized).not.toContain('blob:media-bin-preview')
    expect(serialized).not.toContain('render-resource')

    const revision = aiProjectRevision(context)
    editor.setCurrentTime(30)
    expect(buildAIProjectContext().focus.playhead).toBe(10)
    expect(aiProjectRevision(buildAIProjectContext())).toBe(revision)
    registerMediaBinSource({ id: 'new-image', name: 'generated.png', kind: 'image', duration: 10, sourceMode: 'proxy' })
    expect(aiProjectRevision(buildAIProjectContext())).toBe(revision)
  })

  it('ripple-deletes linked media and shifts existing effects and text in one undo step', async () => {
    const video = editor.addClip(editor.channels[0].id, clip())
    const audio = editor.addClip(editor.channels[1].id, clip({ mediaKind: 'audio' }))
    video.linkedClipId = audio.id
    audio.linkedClipId = video.id
    const existingEffect = editor.addEffectBlock(editor.channels[0].id, 'vignette', 6, 2)!
    const existingText = editor.addTextItem(6, { duration: 2, text: 'Keep me' })
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Removed two seconds and added a grade.',
      operations: [
        { type: 'delete_range', start: 3, end: 5 },
        { type: 'add_effect', channelId: editor.channels[0].id, effectId: 'sepia', start: 1, duration: 2 },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(2)
    expect(editor.channels[0].clips).toHaveLength(2)
    expect(editor.channels[1].clips).toHaveLength(2)
    expect(editor.channels[0].clips.map((item) => [item.start, item.inPoint, item.outPoint])).toEqual([
      [0, 0, 3],
      [3, 5, 10],
    ])
    expect(editor.channels[0].clips[1].linkedClipId).toBe(editor.channels[1].clips[1].id)
    expect(editor.effectBlocks.find((item) => item.id === existingEffect.id)?.start).toBe(4)
    expect(editor.textItems.find((item) => item.id === existingText.id)?.start).toBe(4)
    expect(editor.effectBlocks.find((item) => item.effectId === 'sepia')?.start).toBe(1)
    expect(editor.totalDuration).toBe(8)

    expect(editor.undo()).toBe(true)
    expect(editor.channels[0].clips).toHaveLength(1)
    expect(editor.channels[0].clips[0]).toMatchObject({ start: 0, inPoint: 0, outPoint: 10 })
    expect(editor.effectBlocks.map((item) => item.id)).toEqual([existingEffect.id])
    expect(editor.textItems[0].start).toBe(6)
    expect(editor.canUndo).toBe(false)
  })

  it('rejects a stale response before applying any operation', async () => {
    editor.addClip(editor.channels[0].id, clip())
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    editor.addTextItem(1, { text: 'User edit' })
    const plan: AIEditPlan = {
      revision,
      summary: 'Stale',
      operations: [{ type: 'delete_range', start: 2, end: 4 }],
    }

    await expect(applyAIEditPlan(plan, revision)).rejects.toThrow(/Timeline changed/)
    expect(editor.channels[0].clips).toHaveLength(1)
    expect(editor.textItems).toHaveLength(1)
  })

  it('rolls back the complete AI transaction when one operation fails', async () => {
    editor.addClip(editor.channels[0].id, clip())
    editor.setCurrentTime(8)
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const stateRevision = editor.stateRevision
    const plan: AIEditPlan = {
      revision,
      summary: 'Invalid provider plan',
      operations: [
        { type: 'delete_range', start: 1, end: 3 },
        { type: 'add_effect', channelId: editor.channels[0].id, effectId: 'not-a-preset', start: 1, duration: 2 },
      ],
    }

    await expect(applyAIEditPlan(plan, revision)).rejects.toThrow(/Unknown effect/)
    expect(editor.textItems).toHaveLength(0)
    expect(editor.effectBlocks).toHaveLength(0)
    expect(editor.channels[0].clips).toHaveLength(1)
    expect(editor.channels[0].clips[0]).toMatchObject({ start: 0, inPoint: 0, outPoint: 10 })
    expect(editor.currentTime).toBe(8)
    expect(editor.canUndo).toBe(false)
    expect(editor.stateRevision).toBe(stateRevision)
    expect(aiProjectRevision(buildAIProjectContext())).toBe(revision)
  })

  it('restores project metadata when adding media fails later in the plan', async () => {
    registerMediaBinSource({
      id: 'portrait',
      name: 'portrait.jpg',
      kind: 'image',
      duration: 10,
      width: 1080,
      height: 1920,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:portrait',
    })
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Invalid media plan',
      operations: [
        { type: 'add_media', sourceId: 'portrait', resultId: 'photo', channelId: editor.channels[0].id, start: 0, sourceIn: 0, sourceOut: 10, includeAudio: false },
        { type: 'apply_preset', clipId: 'missing', presetId: 'fine-film' },
      ],
    }

    await expect(applyAIEditPlan(plan, revision)).rejects.toThrow(/missing/)
    expect(editor.channels[0].clips).toHaveLength(0)
    expect(editor.projectAspect).toBeNull()
    expect(aiProjectRevision(buildAIProjectContext())).toBe(revision)
  })

  it('refuses to desynchronize a linked clip when its partner track is locked', async () => {
    const video = editor.addClip(editor.channels[0].id, clip())
    const audio = editor.addClip(editor.channels[1].id, clip({ mediaKind: 'audio' }))
    video.linkedClipId = audio.id
    audio.linkedClipId = video.id
    editor.toggleLock(editor.channels[1].id)
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Unsafe cut',
      operations: [{ type: 'delete_range', start: 2, end: 4 }],
    }

    await expect(applyAIEditPlan(plan, revision)).rejects.toThrow(/locked linked clip/)
    expect(editor.channels[0].clips[0]).toMatchObject({ inPoint: 0, outPoint: 10 })
    expect(editor.channels[1].clips[0]).toMatchObject({ inPoint: 0, outPoint: 10 })
  })

  it('refuses a partial delete through a ramped effect instead of changing its envelope', async () => {
    editor.addClip(editor.channels[0].id, clip())
    const effect = editor.addEffectBlock(editor.channels[0].id, 'sepia', 1, 6)!
    editor.setEffectRamp([effect.id], { mode: 'in-out', curve: 'ease-in-out', amount: 0.4 })
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Unsafe ramp edit',
      operations: [{ type: 'delete_range', start: 3, end: 5 }],
    }

    await expect(applyAIEditPlan(plan, revision)).rejects.toThrow(/ramped effect/)
    expect(editor.effectBlocks[0]).toMatchObject({ start: 1, duration: 6, ramp: { amount: 0.4 } })
  })

  it('adds media from the Media Bin and keeps only extracted video audio linked', async () => {
    registerMediaBinSource({
      id: 'source-1',
      name: 'source.mp4',
      kind: 'video',
      duration: 12,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:source',
    })
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Add source',
      operations: [{
        type: 'add_media',
        sourceId: 'source-1',
        resultId: 'new-video',
        channelId: editor.channels[0].id,
        start: 2,
        sourceIn: 1,
        sourceOut: 5,
        includeAudio: true,
      }],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    const video = editor.channels[0].clips[0]
    const audio = editor.channels[1].clips[0]
    expect(video).toMatchObject({ fileName: 'source.mp4', start: 2, inPoint: 1, outPoint: 5 })
    expect(video.linkedClipId).toBe(audio.id)
    expect(audio.linkedClipId).toBe(video.id)
    expect(audio.scrubBlobUrl).toBe('blob:extracted-audio')
  })

  it('rebuilds a linked video as captioned highlights with a transition', async () => {
    registerMediaBinSource({
      id: 'FF.mp4', name: 'FF.mp4', kind: 'video', duration: 20,
      sourceMode: 'proxy', scrubBlobUrl: 'blob:ff',
    })
    const original = editor.addClip(editor.channels[0].id, clip({
      fileName: 'FF.mp4', mediaKind: 'video', sourceMode: 'proxy', sourceDuration: 20, outPoint: 20,
    }))
    const originalAudio = editor.addClip(editor.channels[1].id, clip({
      fileName: 'FF.mp4', mediaKind: 'audio', sourceDuration: 20, outPoint: 20,
    }))
    original.linkedClipId = originalAudio.id
    originalAudio.linkedClipId = original.id
    editor.selectClip(original.id)
    vi.mocked(generateCaptions).mockImplementation(async ({ start, duration }) => {
      expect(duration).toBe(8)
      expect(start).not.toBe(0)
      const cueStart = start === 2 ? 1 : 3
      return { cues: [{ start: cueStart, end: cueStart + 1, text: 'Salut', words: [
        { text: 'Salut', start: cueStart, end: cueStart + 1 },
      ] }] }
    })
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const videoTrack = editor.channels[0].id
    const plan: AIEditPlan = {
      revision, summary: 'Keep highlights with captions',
      operations: [
        { type: 'delete_clip', clipId: original.id },
        { type: 'add_media', sourceId: 'FF.mp4', resultId: 'first', channelId: videoTrack, start: 0, sourceIn: 2, sourceOut: 10, includeAudio: true },
        { type: 'add_media', sourceId: 'FF.mp4', resultId: 'second', channelId: videoTrack, start: 6, sourceIn: 12, sourceOut: 20, includeAudio: true },
        { type: 'add_transition', channelId: videoTrack, leftClipId: 'first', rightClipId: 'second', effectId: 'cross-dissolve', duration: 2 },
        { type: 'add_text', start: 0, duration: 8, text: 'placeholder', textPresetId: 'active-word' },
        { type: 'add_text', start: 6, duration: 8, text: 'placeholder', textPresetId: 'active-word' },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(6)
    expect(generateCaptions).toHaveBeenCalledTimes(2)
    expect(editor.getClipById(original.id)).toBeNull()
    expect(editor.getClipById(originalAudio.id)).toBeNull()
    expect(editor.channels[0].clips.map((item) => [item.start, item.inPoint, item.outPoint])).toEqual([
      [0, 2, 10], [6, 12, 20],
    ])
    const rebuiltAudio = editor.channels.filter((channel) => channel.type === 'audio').flatMap((channel) => channel.clips)
    expect(rebuiltAudio.map((item) => item.start).sort((a, b) => a - b)).toEqual([0, 6])
    expect(editor.channels[0].clips.every((item) => rebuiltAudio.some((audio) => audio.id === item.linkedClipId))).toBe(true)
    expect(editor.transitions).toHaveLength(1)
    expect(editor.totalDuration).toBe(14)
    expect(editor.textItems.map((item) => [item.text, item.start])).toEqual([['Salut', 1], ['Salut', 9]])
    expect(editor.undo()).toBe(true)
    expect(editor.getClipById(original.id)).not.toBeNull()
    expect(editor.getClipById(originalAudio.id)).not.toBeNull()
  })

  it('adds matching video and music cuts without the video source audio', async () => {
    registerMediaBinSource({
      id: 'nature',
      name: '1 Minute - Nature.mp4',
      kind: 'video',
      duration: 60,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:nature',
    })
    registerMediaBinSource({
      id: 'music',
      name: 'Assassination Red Magick.mp3',
      kind: 'audio',
      duration: 180,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:music',
    })
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Added the requested video and replacement music cut.',
      operations: [
        {
          type: 'add_media',
          sourceId: 'nature',
          resultId: 'new-video',
          channelId: editor.channels[0].id,
          start: 0,
          sourceIn: 5,
          sourceOut: 10,
          includeAudio: false,
        },
        {
          type: 'add_media',
          sourceId: 'music',
          resultId: 'new-music',
          channelId: editor.channels[1].id,
          start: 0,
          sourceIn: 5,
          sourceOut: 10,
          includeAudio: false,
        },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(2)
    expect(editor.channels[0].clips).toHaveLength(1)
    expect(editor.channels[0].clips[0]).toMatchObject({
      fileName: '1 Minute - Nature.mp4',
      start: 0,
      inPoint: 5,
      outPoint: 10,
    })
    expect(editor.channels[0].clips[0].linkedClipId).toBeUndefined()
    expect(extractAudio).not.toHaveBeenCalled()
    expect(editor.channels[1].clips).toHaveLength(1)
    expect(editor.channels[1].clips[0]).toMatchObject({
      fileName: 'Assassination Red Magick.mp3',
      mediaKind: 'audio',
      start: 0,
      inPoint: 5,
      outPoint: 10,
    })
    expect(editor.channels[1].clips[0].linkedClipId).toBeUndefined()
  })

  it('does not create phantom audio when a video has no decodable audio stream', async () => {
    vi.mocked(getAudioPreview).mockResolvedValueOnce(null)
    registerMediaBinSource({
      id: 'silent-video',
      name: 'silent.mp4',
      kind: 'video',
      duration: 8,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:silent-video',
    })
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Add silent video.',
      operations: [{
        type: 'add_media',
        sourceId: 'silent-video',
        resultId: 'new-video',
        channelId: editor.channels[0].id,
        start: 0,
        sourceIn: 0,
        sourceOut: 5,
        includeAudio: true,
      }],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    expect(editor.channels[0].clips).toHaveLength(1)
    expect(editor.channels[0].clips[0].linkedClipId).toBeUndefined()
    expect(editor.channels[1].clips).toHaveLength(0)
  })

  it('removes only linked source audio and keeps the video clip', async () => {
    const video = editor.addClip(editor.channels[0].id, clip({ mediaKind: 'video' }))
    const audio = editor.addClip(editor.channels[1].id, clip({ mediaKind: 'audio', scrubBlobUrl: 'blob:audio' }))
    video.linkedClipId = audio.id
    audio.linkedClipId = video.id
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Remove original audio.',
      operations: [{ type: 'remove_source_audio', clipId: video.id }],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    expect(editor.getClipById(video.id)?.clip.linkedClipId).toBeUndefined()
    expect(editor.getClipById(audio.id)).toBeNull()
    expect(editor.channels[0].clips).toHaveLength(1)

    expect(editor.undo()).toBe(true)
    expect(editor.getClipById(video.id)?.clip.linkedClipId).toBe(audio.id)
    expect(editor.getClipById(audio.id)?.clip.linkedClipId).toBe(video.id)
  })

  it('trims existing video, removes its audio, and aligns replacement music atomically', async () => {
    registerMediaBinSource({
      id: 'music',
      name: 'Assassination Red Magick.mp3',
      kind: 'audio',
      duration: 180,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:music',
    })
    const video = editor.addClip(editor.channels[0].id, clip({
      fileName: '1 Minute - Nature.mp4',
      mediaKind: 'video',
      sourceDuration: 60,
      outPoint: 60,
    }))
    const sourceAudio = editor.addClip(editor.channels[1].id, clip({
      fileName: '1 Minute - Nature.mp4',
      mediaKind: 'audio',
      scrubBlobUrl: 'blob:nature-audio',
      sourceDuration: 60,
      outPoint: 60,
    }))
    video.linkedClipId = sourceAudio.id
    sourceAudio.linkedClipId = video.id
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Use Nature 5-10s with replacement music.',
      operations: [
        { type: 'update_clip', clipId: video.id, inPoint: 5, outPoint: 10 },
        { type: 'remove_source_audio', clipId: video.id },
        {
          type: 'add_media',
          sourceId: 'music',
          resultId: 'new-music',
          channelId: editor.channels[1].id,
          start: 0,
          sourceIn: 0,
          sourceOut: 5,
          includeAudio: false,
        },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(3)
    expect(editor.getClipById(video.id)?.clip).toMatchObject({ start: 0, inPoint: 5, outPoint: 10 })
    expect(editor.getClipById(video.id)?.clip.linkedClipId).toBeUndefined()
    expect(editor.getClipById(sourceAudio.id)).toBeNull()
    expect(editor.channels[1].clips).toHaveLength(1)
    expect(editor.channels[1].clips[0]).toMatchObject({
      fileName: 'Assassination Red Magick.mp3',
      start: 0,
      inPoint: 0,
      outPoint: 5,
    })
    expect(editor.totalDuration).toBe(5)

    expect(editor.undo()).toBe(true)
    expect(editor.getClipById(video.id)?.clip).toMatchObject({ start: 0, inPoint: 0, outPoint: 60 })
    expect(editor.getClipById(sourceAudio.id)).not.toBeNull()
  })

  it('adds and styles an image sequence with result-referenced transitions and music', async () => {
    registerMediaBinSource({
      id: 'beach',
      name: 'Beach.jpg',
      kind: 'image',
      duration: 10,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:beach',
    })
    registerMediaBinSource({
      id: 'forest',
      name: 'Forest.png',
      kind: 'image',
      duration: 10,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:forest',
    })
    registerMediaBinSource({
      id: 'song',
      name: 'Summer Song.mp3',
      kind: 'audio',
      duration: 30,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:song',
    })
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Add all photos with transitions and music.',
      operations: [
        { type: 'add_media', sourceId: 'beach', resultId: 'photo1', channelId: editor.channels[0].id, start: 0, sourceIn: 0, sourceOut: 10, includeAudio: false },
        { type: 'add_media', sourceId: 'forest', resultId: 'photo2', channelId: editor.channels[0].id, start: 9, sourceIn: 0, sourceOut: 10, includeAudio: false },
        { type: 'add_media', sourceId: 'song', resultId: 'music', channelId: editor.channels[1].id, start: 0, sourceIn: 0, sourceOut: 19, includeAudio: false },
        { type: 'add_transition', channelId: editor.channels[0].id, leftClipId: 'photo1', rightClipId: 'photo2', effectId: 'cross-dissolve', duration: 1 },
        { type: 'apply_preset', clipId: 'photo1', presetId: 'fine-film' },
        { type: 'apply_preset', clipId: 'photo2', presetId: 'fine-film' },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(6)
    expect(editor.channels[0].clips.map((item) => ({ name: item.fileName, start: item.start }))).toEqual([
      { name: 'Beach.jpg', start: 0 },
      { name: 'Forest.png', start: 9 },
    ])
    expect(editor.channels[1].clips[0]).toMatchObject({ fileName: 'Summer Song.mp3', start: 0, outPoint: 19 })
    expect(buildAIProjectContext().transitions[0]).toMatchObject({
      leftClipId: editor.channels[0].clips[0].id,
      rightClipId: editor.channels[0].clips[1].id,
      preset: 'cross-dissolve',
      duration: 1,
    })
    expect(editor.effectBlocks.filter((block) => block.clipLookId === 'fine-film')).toHaveLength(10)
  })

  it('applies short-form and active-word text presets from AI plans', async () => {
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Added an active-word caption.',
      operations: [{
        type: 'add_text',
        start: 1,
        duration: 4,
        text: 'Make this moment count',
        textPresetId: 'active-word',
      }],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    expect(editor.textItems[0]).toMatchObject({
      start: 1,
      duration: 4,
      text: 'Make this moment count',
      isCaption: true,
      highlightMode: 'word',
      highlightColor: '#f4ea58',
      animation: 'rise',
    })
    expect(editor.textItems[0].words).toEqual([
      { text: 'Make', start: 0, end: 1 },
      { text: 'this', start: 1, end: 2 },
      { text: 'moment', start: 2, end: 3 },
      { text: 'count', start: 3, end: 4 },
    ])
  })

  it('times AI captions from transcribed words after transitions and keeps them off the overlap', async () => {
    const left = editor.addClip(editor.channels[0].id, clip({ fileName: 'left.mp4', mediaKind: 'video', sourceMode: 'proxy', outPoint: 4 }))
    const right = editor.addClip(editor.channels[0].id, clip({ fileName: 'right.mp4', mediaKind: 'video', sourceMode: 'proxy', start: 4, outPoint: 4 }))
    vi.mocked(generateCaptions).mockImplementation(async ({ file }) => ({ cues: file === 'left.mp4'
      ? [{ start: 3.1, end: 3.9, text: 'before overlap', words: [
        { text: 'before', start: 3.1, end: 3.35 }, { text: 'overlap', start: 3.7, end: 3.9 },
      ] }]
      : [{ start: 0.1, end: 0.9, text: 'early spoken', words: [
        { text: 'early', start: 0.1, end: 0.2 }, { text: 'spoken', start: 0.7, end: 0.9 },
      ] }],
    }))
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Caption the speech and transition between clips.',
      operations: [
        { type: 'add_text', start: 3, duration: 1, text: 'model guessed text', textPresetId: 'active-word' },
        { type: 'add_text', start: 4, duration: 1, text: 'model guessed more', textPresetId: 'active-word' },
        { type: 'add_transition', channelId: editor.channels[0].id, leftClipId: left.id, rightClipId: right.id, effectId: 'cross-dissolve', duration: 0.5 },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(3)
    expect(generateCaptions).toHaveBeenCalledTimes(2)
    const overlapStart = editor.getClipById(right.id)!.clip.start
    const overlapEnd = clipEnd(editor.getClipById(left.id)!.clip)
    expect(editor.textItems.map((item) => [item.text, item.sourceClipId, item.start])).toEqual([
      ['before', left.id, 3.1],
      ['spoken', right.id, 4.45],
    ])
    expect(editor.textItems[1].words[0]).toMatchObject({ text: 'spoken', start: 0 })
    expect(editor.textItems[1].words[0].end).toBeCloseTo(0.2)
    expect(editor.textItems.every((item) => item.start >= overlapEnd || item.start + item.duration <= overlapStart)).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.textItems).toHaveLength(0)
  })

  it('maps nonuniform transcribed word times through source trims and playback speed', async () => {
    const video = editor.addClip(editor.channels[0].id, clip({
      fileName: 'speech.mp4', mediaKind: 'video', sourceMode: 'proxy',
      start: 5, inPoint: 2, outPoint: 6, playbackRate: 2,
    }))
    vi.mocked(generateCaptions).mockResolvedValue({ cues: [{
      start: 0.2, end: 1.1, text: 'first second', words: [
        { text: 'first', start: 0.2, end: 0.35 },
        { text: 'second', start: 0.8, end: 1.1 },
      ],
    }] })
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision, summary: 'Captions',
      operations: [{ type: 'add_text', start: 5, duration: 2, text: 'premature guess', textPresetId: 'active-word' }],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    expect(generateCaptions).toHaveBeenCalledWith({ file: 'speech.mp4', start: 2, duration: 4, language: 'ro' }, undefined)
    expect(editor.textItems).toHaveLength(1)
    expect(editor.textItems[0].sourceClipId).toBe(video.id)
    expect(editor.textItems[0].text).toBe('first second')
    expect(editor.textItems[0].start).toBeCloseTo(5.1)
    expect(editor.textItems[0].words[1].start).toBeCloseTo(0.3)
    expect(editor.textItems[0].words[1].end).toBeCloseTo(0.45)
  })

  it('captions the complete visual sequence from one AI caption request without transcribing music', async () => {
    const first = editor.addClip(editor.channels[0].id, clip({ fileName: 'first.mp4', mediaKind: 'video', sourceMode: 'proxy', outPoint: 4 }))
    const second = editor.addClip(editor.channels[0].id, clip({ fileName: 'second.mp4', mediaKind: 'video', sourceMode: 'proxy', start: 4, outPoint: 4 }))
    editor.addClip(editor.channels[1].id, clip({ fileName: 'music.mp3', mediaKind: 'audio', sourceMode: 'proxy', outPoint: 8 }))
    vi.mocked(generateCaptions).mockImplementation(async ({ file }) => ({ cues: [{
      start: 0.5, end: 0.8, text: file, words: [{ text: file, start: 0.5, end: 0.8 }],
    }] }))
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())

    expect(await applyAIEditPlan({
      revision, summary: 'Caption the footage',
      operations: [{ type: 'add_text', start: 0, duration: 8, text: 'guessed speech', textPresetId: 'clean-phrase' }],
    }, revision)).toBe(2)
    expect(vi.mocked(generateCaptions).mock.calls.map(([request]) => request.file)).toEqual(['first.mp4', 'second.mp4'])
    expect(editor.textItems.map((item) => [item.text, item.sourceClipId, item.start])).toEqual([
      ['first.mp4', first.id, 0.5], ['second.mp4', second.id, 4.5],
    ])
  })

  it('adds active-word timing for custom AI text styles', async () => {
    const existing = editor.addTextItem(0, { text: 'Original title', duration: 2 })
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Turned the title into an active-word caption.',
      operations: [{
        type: 'update_text',
        textId: existing.id,
        text: 'Read every word',
        duration: 3,
        style: { highlightMode: 'word', highlightColor: '#ffcc00', animation: 'bounce', animationDuration: 0.4 },
      }],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    expect(editor.textItems[0]).toMatchObject({
      text: 'Read every word',
      duration: 3,
      isCaption: true,
      highlightMode: 'word',
      highlightColor: '#ffcc00',
      animation: 'bounce',
      animationDuration: 0.4,
    })
    expect(editor.textItems[0].words).toEqual([
      { text: 'Read', start: 0, end: 1 },
      { text: 'every', start: 1, end: 2 },
      { text: 'word', start: 2, end: 3 },
    ])
  })

  it('generates deferred AI image jobs only when the plan is applied', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'generated', name: 'generated.png', mediaType: 'image/png', width: 1920, height: 1080, sourceMode: 'proxy',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(new Blob(['image'], { type: 'image/png' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:generated') })
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Add a transparent calendar overlay.',
      imageJobs: [{
        id: 'calendar', prompt: 'A calendar cutout', placement: 'overlay', position: 'right', start: 2, duration: 4,
        background: 'transparent', quality: 'high', motionPreset: 'none',
      }],
      operations: [],
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const generatedClip = editor.channels.flatMap((channel) => channel.clips).find((item) => item.fileName === 'generated.png')
    expect(generatedClip).toMatchObject({ start: 2, outPoint: 4, fadeIn: 0.35, fadeOut: 0.35 })
    expect(editor.undo()).toBe(true)
    expect(editor.channels.flatMap((channel) => channel.clips).some((item) => item.fileName === 'generated.png')).toBe(false)
  })

  it('generates deferred speech and places it on an unlocked audio track', async () => {
    speech.prepare.mockResolvedValue({
      asset: { id: 'voice', name: 'voice_welcome_to_a1b2c3d4.mp3', mediaType: 'audio/mpeg', sourceMode: 'proxy' },
      blobUrl: 'blob:voice',
      duration: 3.5,
    })
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Added the requested voice-over.',
      speechJobs: [{
        id: 'intro', input: 'Welcome to the show', model: 'google/gemini-3.1-flash-tts-preview',
        voice: 'Kore', start: 2, volume: 85,
      }],
      operations: [],
    }

    expect(speech.prepare).not.toHaveBeenCalled()
    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    expect(speech.prepare).toHaveBeenCalledWith({
      input: 'Welcome to the show', model: 'google/gemini-3.1-flash-tts-preview', voice: 'Kore',
    }, undefined)
    expect(editor.channels[1].clips[0]).toMatchObject({
      fileName: 'voice_welcome_to_a1b2c3d4.mp3', start: 2, inPoint: 0, outPoint: 3.5, volume: 85,
    })
    expect(speech.register).toHaveBeenCalledOnce()
    expect(editor.undo()).toBe(true)
    expect(editor.channels[1].clips).toHaveLength(0)
  })

  it('builds a motion-preset slideshow and limits music to the image sequence', async () => {
    for (const [id, name] of [['beach', 'Beach.jpg'], ['forest', 'Forest.jpg'], ['mountain', 'Mountain.jpg']] as const) {
      registerMediaBinSource({
        id,
        name,
        kind: 'image',
        duration: 10,
        sourceMode: 'proxy',
        scrubBlobUrl: `blob:${id}`,
      })
    }
    registerMediaBinSource({
      id: 'assassination',
      name: 'Assassination Red Magick.mp3',
      kind: 'audio',
      duration: 60,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:assassination',
    })
    const revision = aiProjectRevision(buildAIProjectContext())
    const videoChannelId = editor.channels[0].id
    const plan: AIEditPlan = {
      revision,
      summary: 'Add all images with motion and scoped music.',
      operations: [
        { type: 'add_media', sourceId: 'beach', resultId: 'image1', channelId: videoChannelId, start: 0, sourceIn: 0, sourceOut: 10, includeAudio: false },
        { type: 'add_media', sourceId: 'forest', resultId: 'image2', channelId: videoChannelId, start: 8, sourceIn: 0, sourceOut: 10, includeAudio: false },
        { type: 'add_media', sourceId: 'mountain', resultId: 'image3', channelId: videoChannelId, start: 16, sourceIn: 0, sourceOut: 10, includeAudio: false },
        { type: 'add_transition', channelId: videoChannelId, leftClipId: 'image1', rightClipId: 'image2', effectId: 'cross-dissolve', duration: 2 },
        { type: 'add_transition', channelId: videoChannelId, leftClipId: 'image2', rightClipId: 'image3', effectId: 'cross-dissolve', duration: 2 },
        { type: 'update_clip', clipId: 'image1', motionPreset: 'ken-burns' },
        { type: 'update_clip', clipId: 'image2', motionPreset: 'pan-left' },
        { type: 'update_clip', clipId: 'image3', motionPreset: 'zoom-in' },
        { type: 'add_media', sourceId: 'assassination', resultId: 'music', channelId: editor.channels[1].id, start: 0, sourceIn: 0, sourceOut: 26, includeAudio: false },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(9)
    expect(editor.channels[0].clips.map((item) => [item.fileName, item.start, clipEnd(item) - item.start, item.motionPreset])).toEqual([
      ['Beach.jpg', 0, 10, 'ken-burns'],
      ['Forest.jpg', 8, 10, 'pan-left'],
      ['Mountain.jpg', 16, 10, 'zoom-in'],
    ])
    expect(buildAIProjectContext().transitions.map((transition) => transition.duration)).toEqual([2, 2])
    expect(editor.channels[1].clips[0]).toMatchObject({ fileName: 'Assassination Red Magick.mp3', start: 0, inPoint: 0, outPoint: 26 })
    expect(editor.effectBlocks).toHaveLength(0)

    expect(editor.undo()).toBe(true)
    expect(editor.channels[0].clips).toHaveLength(0)
    expect(editor.channels[1].clips).toHaveLength(0)
  })

  it('realigns presets applied before a transition across the final clip geometry', async () => {
    const channel = editor.channels[0]
    const left = editor.addClip(channel.id, clip({
      fileName: 'Left.mp4',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    }))
    const right = editor.addClip(channel.id, clip({
      fileName: 'Right.mp4',
      sourceDuration: 10,
      inPoint: 3,
      outPoint: 8,
      start: 5,
    }))
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Apply looks and add a transition.',
      operations: [
        { type: 'apply_preset', clipId: left.id, presetId: 'balanced-enhance' },
        { type: 'apply_preset', clipId: right.id, presetId: 'balanced-enhance' },
        {
          type: 'add_transition',
          channelId: channel.id,
          leftClipId: left.id,
          rightClipId: right.id,
          effectId: 'cross-dissolve',
          duration: 1,
        },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(3)
    const liveLeft = editor.getClipById(left.id)!.clip
    const liveRight = editor.getClipById(right.id)!.clip
    const leftBlocks = editor.effectBlocks.filter((block) => block.ownerClipId === left.id)
    const rightBlocks = editor.effectBlocks.filter((block) => block.ownerClipId === right.id)
    expect(leftBlocks).toHaveLength(3)
    expect(rightBlocks).toHaveLength(3)
    expect(leftBlocks.every((block) => (
      Math.abs(block.start - liveLeft.start) < 0.001
      && Math.abs(block.start + block.duration - clipEnd(liveLeft)) < 0.001
    ))).toBe(true)
    expect(rightBlocks.every((block) => (
      Math.abs(block.start - liveRight.start) < 0.001
      && Math.abs(block.start + block.duration - clipEnd(liveRight)) < 0.001
    ))).toBe(true)
  })

  it('applies two-second images with exact one-second transitions atomically', async () => {
    for (const [id, name] of [['one', 'One.jpg'], ['two', 'Two.jpg'], ['three', 'Three.jpg']] as const) {
      registerMediaBinSource({
        id,
        name,
        kind: 'image',
        duration: 10,
        sourceMode: 'proxy',
        scrubBlobUrl: `blob:${id}`,
      })
    }
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Add all images for two seconds with one-second transitions.',
      operations: [
        { type: 'add_media', sourceId: 'one', resultId: 'image1', channelId: editor.channels[0].id, start: 0, sourceIn: 0, sourceOut: 2, includeAudio: false },
        { type: 'add_media', sourceId: 'two', resultId: 'image2', channelId: editor.channels[0].id, start: 1, sourceIn: 0, sourceOut: 2, includeAudio: false },
        { type: 'add_media', sourceId: 'three', resultId: 'image3', channelId: editor.channels[0].id, start: 2, sourceIn: 0, sourceOut: 2, includeAudio: false },
        { type: 'add_transition', channelId: editor.channels[0].id, leftClipId: 'image1', rightClipId: 'image2', effectId: 'cross-dissolve', duration: 1 },
        { type: 'add_transition', channelId: editor.channels[0].id, leftClipId: 'image2', rightClipId: 'image3', effectId: 'cross-dissolve', duration: 1 },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(5)
    expect(editor.channels[0].clips.map((item) => [item.fileName, item.start, item.outPoint - item.inPoint])).toEqual([
      ['One.jpg', 0, 2],
      ['Two.jpg', 1, 2],
      ['Three.jpg', 2, 2],
    ])
    expect(buildAIProjectContext().transitions.map((transition) => transition.duration)).toEqual([1, 1])
    expect(editor.undo()).toBe(true)
    expect(editor.channels[0].clips).toHaveLength(0)
    expect(editor.transitions).toHaveLength(0)
  })

  it('can modify an existing clip and add another clip in the same plan', async () => {
    registerMediaBinSource({
      id: 'next-photo',
      name: 'Next.jpg',
      kind: 'image',
      duration: 10,
      sourceMode: 'proxy',
      scrubBlobUrl: 'blob:next',
    })
    const existing = editor.addClip(editor.channels[0].id, clip({ fileName: 'Existing.mp4' }))
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Style existing footage and continue with a photo.',
      operations: [
        { type: 'update_clip', clipId: existing.id, outPoint: 6 },
        { type: 'apply_preset', clipId: existing.id, presetId: 'creator-natural' },
        { type: 'add_media', sourceId: 'next-photo', resultId: 'next', channelId: editor.channels[0].id, start: 5, sourceIn: 0, sourceOut: 10, includeAudio: false },
        { type: 'apply_preset', clipId: 'next', presetId: 'creator-natural' },
        { type: 'add_transition', channelId: editor.channels[0].id, leftClipId: existing.id, rightClipId: 'next', effectId: 'wipe-left', duration: 1 },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(5)
    expect(editor.getClipById(existing.id)?.clip.outPoint).toBe(6)
    expect(editor.channels[0].clips.map((item) => item.fileName)).toEqual(['Existing.mp4', 'Next.jpg'])
    expect(editor.transitions).toHaveLength(1)
    expect(editor.effectBlocks.filter((block) => block.clipLookId === 'creator-natural')).toHaveLength(8)
  })

  it('keeps the timeline start when changing only the source window', async () => {
    const clipItem = editor.addClip(editor.channels[0].id, clip({ sourceDuration: 20, outPoint: 20 }))
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Use source seconds five to ten.',
      operations: [{ type: 'update_clip', clipId: clipItem.id, inPoint: 5, outPoint: 10 }],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    expect(editor.getClipById(clipItem.id)?.clip).toMatchObject({ start: 0, inPoint: 5, outPoint: 10 })
    expect(editor.totalDuration).toBe(5)
  })

  it('uses the editor razor action for explicit split operations', async () => {
    const clipItem = editor.addClip(editor.channels[0].id, clip())
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Split at five seconds.',
      operations: [{ type: 'split_clip', clipId: clipItem.id, time: 5 }],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(1)
    expect(editor.channels[0].clips.map((item) => [item.start, item.inPoint, item.outPoint])).toEqual([
      [0, 0, 5],
      [5, 5, 10],
    ])
  })

  it('moves a clip, applies a complete look, and updates transform values', async () => {
    const clipItem = editor.addClip(editor.channels[0].id, clip({ sourceDuration: 10 }))
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Style clip',
      operations: [
        { type: 'move_clip', clipId: clipItem.id, start: 3 },
        { type: 'apply_preset', clipId: clipItem.id, presetId: 'fine-film' },
        { type: 'update_clip', clipId: clipItem.id, transform: { zoomX: 1.4, positionX: 12, flipH: true } },
      ],
    }

    expect(await applyAIEditPlan(plan, revision)).toBe(3)
    expect(editor.getClipById(clipItem.id)?.clip).toMatchObject({ start: 3, transform: { zoomX: 1.4, positionX: 12, flipH: true } })
    expect(editor.effectBlocks.some((block) => block.ownerClipId === clipItem.id && block.clipLookId === 'fine-film')).toBe(true)
  })

  it('applies transitions and uses undo as a separate AI operation', async () => {
    const left = editor.addClip(editor.channels[0].id, clip({ outPoint: 4, start: 0 }))
    const right = editor.addClip(editor.channels[0].id, clip({ outPoint: 4, start: 3 }))
    editor.clearHistory()
    let revision = aiProjectRevision(buildAIProjectContext())
    const transitionPlan: AIEditPlan = {
      revision,
      summary: 'Add transition',
      operations: [{
        type: 'add_transition',
        channelId: editor.channels[0].id,
        leftClipId: left.id,
        rightClipId: right.id,
        effectId: 'cross-dissolve',
        duration: 0.5,
      }],
    }
    expect(await applyAIEditPlan(transitionPlan, revision)).toBe(1)
    expect(editor.transitions).toHaveLength(1)
    expect(buildAIProjectContext().transitions[0]).toMatchObject({
      trackId: editor.channels[0].id,
      leftClipId: left.id,
      rightClipId: right.id,
      preset: 'cross-dissolve',
      duration: 0.5,
    })

    editor.addTextItem(0, { text: 'Undo me' })
    revision = aiProjectRevision(buildAIProjectContext())
    const undoPlan: AIEditPlan = { revision, summary: 'Undo', operations: [{ type: 'undo' }] }
    expect(await applyAIEditPlan(undoPlan, revision)).toBe(1)
    expect(editor.textItems).toHaveLength(0)
  })

  it('rolls back when a provider requests an impossible video transition duration', async () => {
    const left = editor.addClip(editor.channels[0].id, clip({ mediaKind: 'video', outPoint: 2, start: 0 }))
    const right = editor.addClip(editor.channels[0].id, clip({ mediaKind: 'video', outPoint: 2, start: 1 }))
    editor.clearHistory()
    const revision = aiProjectRevision(buildAIProjectContext())
    const plan: AIEditPlan = {
      revision,
      summary: 'Invalid transition',
      operations: [{
        type: 'add_transition',
        channelId: editor.channels[0].id,
        leftClipId: left.id,
        rightClipId: right.id,
        effectId: 'cross-dissolve',
        duration: 1,
      }],
    }

    await expect(applyAIEditPlan(plan, revision)).rejects.toThrow(/requested 1s transition/)
    expect(editor.transitions).toHaveLength(0)
    expect(editor.getClipById(right.id)?.clip.start).toBe(1)
    expect(editor.canUndo).toBe(false)
  })
})
