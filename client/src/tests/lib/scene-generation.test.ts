import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendGeneratedScene, registerGeneratedScene, sceneRequest, sceneEditRequest, type GeneratedScene, type SceneDraft } from '../../lib/scene-generation'
import { editor } from '../../stores/editor.svelte'
import { clearMediaBinSources, getMediaBinSources, isAIGeneratedFileName, renameMediaBinSource } from '../../lib/media-bin'

const api = vi.hoisted(() => ({ download: vi.fn(), audio:vi.fn() }))

vi.mock('../../lib/api', async (original) => ({ ...await original<typeof import('../../lib/api')>(), downloadFile: api.download, getAudioPreview:api.audio }))

const scene: GeneratedScene = {
  id: 'scene-id', title: 'Roots unfold', brief: 'An animated seed', start: 0, end: 2, component: '<p>Seed</p>',
  asset: { id: 'scene-id', file: `ai_scene_${'a'.repeat(32)}_01.mp4`, version: `sha256:${'b'.repeat(64)}`, kind: 'video', duration: 2, width: 1280, height: 720, hasAudio: true },
  manifest: { version: 1, file: 'scene.mp4', sha256: 'b'.repeat(64), size: 42, duration: 2, width: 1280, height: 720, fps: 30, frames: 60, hasAudio: true, transparent: false, codec: 'h264', scene: { version: 1, sceneId: 'generated', seed: 'generated', props: {}, config: { width: 1280, height: 720, fps: 30, durationInFrames: 60 } } },
}

const draft: SceneDraft = { mode: 'prompt', prompt: ' A growing tree ', text: '', visualMode: 'auto', duration: 8, language: '', audioSource: '', voice: null, images: [], videos: [] }

describe('scene-to-editor adapter', () => {
  beforeEach(() => {
    api.download.mockReset().mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }))
    api.audio.mockReset().mockResolvedValue('audio:voice')
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:scene'), revokeObjectURL: vi.fn() })
    clearMediaBinSources()
    while (editor.channels.length) editor.removeChannel(editor.channels[0].id)
    editor.setProjectAspect('landscape')
    editor.setFps(30)
    editor.clearHistory()
  })

  it('validates input and matches portrait dimensions without sending voice in prompt mode', () => {
    editor.setProjectAspect('portrait')
    expect(sceneRequest(draft, 'voice.mp3')).toEqual({ prompt: 'A growing tree', duration: 8, width: 1080, height: 1920, fps: 30 })
    expect(() => sceneRequest({ ...draft, mode: 'voice' })).toThrow('recording')
    expect(() => sceneRequest({ ...draft, duration: NaN })).toThrow('length')
  })

  it('honors an explicit vertical screen at Full HD independently of the project', () => {
    expect(sceneRequest({ ...draft, aspect: 'portrait' })).toMatchObject({ width: 1080, height: 1920 })
    expect(sceneRequest({ ...draft, aspect: 'landscape' })).toMatchObject({ width: 1920, height: 1080 })
    expect(sceneRequest({ ...draft, aspect: 'classic' })).toMatchObject({ width: 1440, height: 1080 })
  })

  it('keeps exact scene text separate from art direction and requests real 3D', () => {
    expect(sceneRequest({...draft,text:' Salut {lume}\n',visualMode:'3d'})).toMatchObject({prompt:'A growing tree',text:' Salut {lume}\n',visualMode:'3d'})
    expect(sceneRequest({...draft,prompt:'',text:'Text only'})).toMatchObject({prompt:'',text:'Text only'})
    expect(() => sceneRequest({...draft,text:'ș'.repeat(4001)})).toThrow('scene text')
  })

  it('requests transparent output explicitly and keeps full scenes backwards compatible', () => {
    expect(sceneRequest({ ...draft, transparent: true })).toMatchObject({ transparent: true })
    expect(sceneRequest({ ...draft, transparent: false })).not.toHaveProperty('transparent')
  })

  it('places a transparent live component above all clips at the playhead as one undoable edit', async () => {
    const background = editor.addChannel('video')
    editor.addClip(background.id, { fileName: 'footage.mp4', sourceDuration: 6, inPoint: 0, outPoint: 6, start: 0, scrubBlobUrl: null })
    const upper = editor.addChannel('video')
    upper.locked = true
    editor.setCurrentTime(1.5)
    editor.clearHistory()
    const live: GeneratedScene = { ...scene, asset: { ...scene.asset, file: `ai_scene_${'f'.repeat(32)}_01.scene.json`, hasAudio: false }, source: { version: 1, component: '<p>Effect</p>', javascript: 'bundle', config: { width: 320, height: 180, fps: 30, durationInFrames: 60, transparent: true }, audio: { file: 'voice.wav', start: 3, duration: 10 } } }
    const id = await appendGeneratedScene(live)
    const inserted = editor.getClipById(id)!
    expect(inserted.channel.id).toBe(editor.channels.filter(channel => channel.type === 'video').at(-1)!.id)
    expect(inserted.channel.id).not.toBe(upper.id)
    expect(inserted.clip).toMatchObject({ start: 1.5, inPoint: 0, outPoint: 2 })
    expect(editor.getClipById(inserted.clip.linkedClipId!)!.clip).toMatchObject({ start: 1.5, inPoint: 3, outPoint: 5 })
    expect(editor.channels[0].clips[0]).toMatchObject({ start: 0, outPoint: 6 })
    expect(editor.totalDuration).toBe(6)
    expect(api.download).not.toHaveBeenCalled()
    expect(getMediaBinSources()[0].scene?.config.transparent).toBe(true)
    editor.undo()
    expect(editor.getClipById(id)).toBeNull()
    expect(editor.channels).toHaveLength(2)
    editor.redo()
    expect(editor.getClipById(id)!.clip.start).toBe(1.5)
  })

  it('appends a scene and linked narration as one undoable edit', async () => {
    const channel = editor.addChannel('video')
    editor.addClip(channel.id, { fileName: 'existing.mp4', mediaKind: 'video', sourceDuration: 3, inPoint: 0, outPoint: 3, start: 0, scrubBlobUrl: null })
    editor.clearHistory()
    const id = await appendGeneratedScene(scene)
    const video = editor.getClipById(id)!.clip
    const audio = editor.getClipById(video.linkedClipId!)!.clip
    expect(video).toMatchObject({ start: 3, outPoint: 2, sourceMode: 'proxy' })
    expect(audio).toMatchObject({ start: 3, outPoint: 2, scrubBlobUrl: 'blob:scene', linkedClipId: video.id })
    expect(getMediaBinSources()[0]).toMatchObject({ name: scene.asset.file, displayName: 'Roots unfold', generated: true, isRender: false, sourceRevision: scene.asset.version })
    expect(isAIGeneratedFileName(scene.asset.file)).toBe(true)
    editor.undo()
    expect(editor.getClipById(id)).toBeNull()
    expect(editor.totalDuration).toBe(3)
  })

  it('edits by stored source filename and preserves the scene format rather than the project format', () => {
    const live: GeneratedScene = { ...scene, asset: { ...scene.asset, file: `ai_scene_${'c'.repeat(32)}_01.scene.json` }, source: { version: 1, component: '<p>Seed</p>', javascript: 'bundle', config: { width: 320, height: 180, fps: 24, durationInFrames: 48 } } }
    editor.setProjectAspect('portrait')
    expect(sceneEditRequest(live, { sceneId: live.id, prompt: ' Make the tree blue ', duration: 3 })).toEqual({ sourceFile: live.asset.file, prompt: 'Make the tree blue', duration: 3, width: 320, height: 180, fps: 24 })
    expect(() => sceneEditRequest(scene, { sceneId: scene.id, prompt: 'Change', duration: 3 })).toThrow('live scene')
    expect(() => sceneEditRequest(live, { sceneId: 'another-scene', prompt: 'Change', duration: 3 })).toThrow('live scene')
    expect(() => sceneEditRequest(live, { sceneId: live.id, prompt: ' ', duration: 3 })).toThrow('change')
  })

  it('inserts a live component immediately without downloading or rendering MP4 and links the original voice range', async () => {
    const live:GeneratedScene = { ...scene, asset:{...scene.asset,file:`ai_scene_${'c'.repeat(32)}_02.scene.json`,hasAudio:false},source:{version:1,component:'<p>Scene</p>',javascript:'compiled bundle',config:{width:1280,height:720,fps:30,durationInFrames:60},audio:{file:'voice.wav',start:3,duration:10}} }
    const id = await appendGeneratedScene(live)
    const video = editor.getClipById(id)!.clip
    const audio = editor.getClipById(video.linkedClipId!)!.clip
    expect(api.download).not.toHaveBeenCalled()
    expect(video).toMatchObject({fileName:live.asset.file,scrubBlobUrl:null,inPoint:0,outPoint:2})
    expect(getMediaBinSources()[0]).toMatchObject({ name: live.asset.file, displayName: 'Roots unfold' })
    expect(audio).toMatchObject({fileName:'voice.wav',inPoint:3,outPoint:5,scrubBlobUrl:'audio:voice',linkedClipId:id})
    editor.undo()
    expect(editor.getClipById(id)).toBeNull()
    expect(editor.totalDuration).toBe(0)
  })

  it('uses a vertical Full HD screen when the first scene enters an empty timeline', async () => {
    const live: GeneratedScene = { ...scene, asset: { ...scene.asset, file: `ai_scene_${'d'.repeat(32)}_01.scene.json`, width: 1080, height: 1920 }, source: { version: 1, component: '<p>Vertical</p>', javascript: 'bundle', config: { width: 1080, height: 1920, fps: 30, durationInFrames: 60 } } }
    await appendGeneratedScene(live)
    expect(editor.effectiveProjectAspect).toBe('portrait')
    expect(editor.projectResolution).toEqual({ w: 1080, h: 1920 })
    editor.undo()
    expect(editor.effectiveProjectAspect).toBe('landscape')
  })

  it('uses the subject brief for generic scene titles and preserves manual names on re-registration', () => {
    registerGeneratedScene({ ...scene, title: 'Generated scene' })
    expect(getMediaBinSources()[0].displayName).toBe('An animated seed')
    renameMediaBinSource(scene.asset.file, 'My seed scene')
    registerGeneratedScene(scene)
    expect(getMediaBinSources()[0].displayName).toBe('My seed scene')
  })
})
