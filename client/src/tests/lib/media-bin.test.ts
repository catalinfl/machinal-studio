import { beforeEach, describe, expect, it } from 'vitest'
import { clearMediaBinSources, getMediaBinSource, isMediaBinSourceRemoved, mediaDisplayName, registerMediaBinSource, renameMediaBinSource, unregisterMediaBinSource } from '../../lib/media-bin'
import { captureProjectState, restoreProjectState } from '../../lib/project-state'
import { editor } from '../../stores/editor.svelte'
import type { LiveSceneSource } from '../../lib/live-scene'

describe('project media names', () => {
  beforeEach(() => {
    clearMediaBinSources()
    editor.clearTimeline()
    editor.clearHistory()
  })

  it('changes only display metadata and retains it through source updates', () => {
    const source = { id: 'original', name: 'poster.png', kind: 'image' as const, duration: 10,
      sourceId: 'original', sourceRevision: 'revision-1', previewUrl: 'original-preview', generated: true }
    registerMediaBinSource(source)
    renameMediaBinSource(source.name, '  Opening title  ')
    registerMediaBinSource({ ...source, duration: 12 })

    expect(getMediaBinSource(source.name)).toMatchObject({ ...source, duration: 12, displayName: 'Opening title' })
    expect(getMediaBinSource('Opening title')).toBeUndefined()
    expect(mediaDisplayName(source.name)).toBe('Opening title')
  })

  it('saves independent names per project for the same original reference', async () => {
    registerMediaBinSource({ id: 'shared-original', name: 'poster.png', kind: 'image', duration: 10 })
    const first = captureProjectState()
    renameMediaBinSource('poster.png', 'Second project title')
    const second = captureProjectState()

    clearMediaBinSources()
    await restoreProjectState(first, 'first-project')
    expect(mediaDisplayName('poster.png')).toBe('poster.png')
    clearMediaBinSources()
    await restoreProjectState(second, 'second-project')
    expect(mediaDisplayName('poster.png')).toBe('Second project title')
    expect(getMediaBinSource('poster.png')?.id).toBe('shared-original')
  })

  it('supports duplicate display names without merging physical references', () => {
    for (const name of ['one.png', 'two.png']) {
      registerMediaBinSource({ id: name, name, kind: 'image', duration: 10 })
      renameMediaBinSource(name, 'Title')
    }

    expect(captureProjectState().media).toHaveLength(2)
    expect(mediaDisplayName('one.png')).toBe('Title')
    expect(mediaDisplayName('two.png')).toBe('Title')
  })

  it('autosaves scene references without copying compiled bundles or embedded media', async () => {
    const name = 'ai_scene_0123456789abcdef0123456789abcdef_01.scene.json'
    const scene: LiveSceneSource = { version: 1, component: '<p>Scene</p>', javascript: 'x'.repeat(1024 * 1024),
      config: { width: 320, height: 180, fps: 30, durationInFrames: 60 },
      images: { image_1: 'data:image/png;base64,AAAA' } }
    registerMediaBinSource({ id: 'scene', name, displayName: 'Opening', kind: 'video', duration: 2,
      sourceRevision: 'sha256:scene', scene, generated: true })

    const saved = captureProjectState()
    expect(saved.media[0]).not.toHaveProperty('scene')
    expect(saved.media[0]).toMatchObject({ name, displayName: 'Opening', sourceRevision: 'sha256:scene', generated: true })
    expect(JSON.stringify(saved).length).toBeLessThan(4096)
    expect(getMediaBinSource(name)?.scene).toBe(scene)

    clearMediaBinSources()
    await restoreProjectState(saved, 'scene-project')
    expect(getMediaBinSource(name)).toMatchObject({ name, displayName: 'Opening', scrubBlobUrl: null, previewUrl: null })
  })

  it('opens legacy inline scenes but does not send them back on the next autosave', async () => {
    const state = captureProjectState()
    const scene: LiveSceneSource = { version: 1, component: '<p>Legacy</p>', javascript: 'legacy-bundle',
      config: { width: 320, height: 180, fps: 30, durationInFrames: 60 } }
    const name = 'ai_scene_0123456789abcdef0123456789abcdef_01.scene.json'
    state.media.push({ id: 'legacy', name, kind: 'video', duration: 2, scene })

    await restoreProjectState(state, 'legacy-project')
    expect(getMediaBinSource(name)?.scene).toEqual(scene)
    expect(captureProjectState().media[0]).not.toHaveProperty('scene')
    expect(state.media[0].scene).toBe(scene)
  })

  it('does not dirty the saved project when only the runtime scene finishes loading', () => {
    const reference = { id: 'scene', name: 'ai_scene_0123456789abcdef0123456789abcdef_01.scene.json',
      kind: 'video' as const, duration: 2 }
    registerMediaBinSource(reference)
    const before = JSON.stringify(captureProjectState())
    registerMediaBinSource({ ...reference, scene: { version: 1, component: '<p>Scene</p>', javascript: 'browser-bundle',
      config: { width: 320, height: 180, fps: 30, durationInFrames: 60 } } })
    expect(JSON.stringify(captureProjectState())).toBe(before)
  })

  it('uses persisted scene titles for MCP scenes and keeps them after reopening without the bundle', async () => {
    const name = `ai_scene_${'a'.repeat(32)}_01.scene.json`
    expect(mediaDisplayName(name)).toBe('Scene 1')
    const scene: LiveSceneSource = { version: 1, title: 'Rădăcini în creștere', component: '<p>Roots</p>', javascript: 'bundle',
      config: { width: 320, height: 180, fps: 30, durationInFrames: 60 } }
    registerMediaBinSource({ id: 'scene', name, kind: 'video', duration: 2, scene })
    expect(mediaDisplayName(name)).toBe('Rădăcini în creștere')
    const saved = captureProjectState()
    expect(saved.media[0]).toMatchObject({ name, displayName: 'Rădăcini în creștere' })
    expect(saved.media[0]).not.toHaveProperty('scene')
    clearMediaBinSources()
    await restoreProjectState(saved, 'named-scenes')
    expect(mediaDisplayName(name)).toBe('Rădăcini în creștere')
    registerMediaBinSource({ id: 'scene', name, kind: 'video', duration: 2, scene: { ...scene, title: 'Other title' } })
    expect(mediaDisplayName(name)).toBe('Rădăcini în creștere')
  })

  it('derives legacy scene names from available copy without changing that copy or manual names', () => {
    const name = `ai_scene_${'a'.repeat(32)}_02.scene.json`
    const scene: LiveSceneSource = { version: 1, text: '  Pădurea\nprinde viață  ', component: '<p>Forest</p>', javascript: 'bundle',
      config: { width: 320, height: 180, fps: 30, durationInFrames: 60 } }
    registerMediaBinSource({ id: 'scene', name, kind: 'video', duration: 2, scene })
    expect(mediaDisplayName(name)).toBe('Pădurea prinde viață')
    expect(scene.text).toBe('  Pădurea\nprinde viață  ')
    renameMediaBinSource(name, 'My forest')
    registerMediaBinSource({ id: 'scene', name, kind: 'video', duration: 2, scene: { ...scene, title: 'New title' } })
    expect(mediaDisplayName(name)).toBe('My forest')
  })

  it('validates names and can return to the original filename', () => {
    registerMediaBinSource({ id: 'poster', name: 'poster.png', kind: 'image', duration: 10 })
    expect(() => renameMediaBinSource('poster.png', '  ')).toThrow('Enter a name')
    expect(() => renameMediaBinSource('poster.png', 'x'.repeat(121))).toThrow('120 characters')
    expect(() => renameMediaBinSource('missing.png', 'Title')).toThrow('no longer available')
    renameMediaBinSource('poster.png', 'Title')
    renameMediaBinSource('poster.png', 'poster.png')
    expect(mediaDisplayName('poster.png')).toBe('poster.png')
    expect(getMediaBinSource('poster.png')?.displayName).toBeUndefined()
  })

  it('remembers deletions even before metadata registration and clears them on reimport or project change', () => {
    unregisterMediaBinSource('UNLOADED.mp4')
    expect(isMediaBinSourceRemoved('unloaded.mp4')).toBe(true)
    registerMediaBinSource({ id: 'unloaded', name: 'unloaded.mp4', kind: 'video', duration: 5 })
    expect(isMediaBinSourceRemoved('unloaded.mp4')).toBe(false)
    unregisterMediaBinSource('unloaded.mp4')
    clearMediaBinSources()
    expect(isMediaBinSourceRemoved('unloaded.mp4')).toBe(false)
  })
})
