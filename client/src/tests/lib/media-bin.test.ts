import { beforeEach, describe, expect, it } from 'vitest'
import { clearMediaBinSources, getMediaBinSource, isMediaBinSourceRemoved, mediaDisplayName, registerMediaBinSource, renameMediaBinSource, unregisterMediaBinSource } from '../../lib/media-bin'
import { captureProjectState, restoreProjectState } from '../../lib/project-state'
import { editor } from '../../stores/editor.svelte'

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
