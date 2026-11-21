import { describe, expect, it } from 'vitest'
import { DEFAULT_CLIP_TRANSFORM } from '../../lib/clip-transform'
import { preparedCompositionJSON, preparedProjectState, projectStateForOpen, type PreparedComposition } from '../../lib/project-presentation'
import type { ProjectState } from '../../lib/project-state'
import type { TextItem } from '../../lib/editor-types'

function fixture(): PreparedComposition {
  const caption = { id: 'caption', text: '  Știință\nși țară! ', start: 1.1, duration: 1.3, fontFamily: 'montserrat', fontWeight: 700,
    words: [{ text: ' Știință', start: 0, end: 0.5 }, { text: 'și țară! ', start: 0.5, end: 1.3 }] } as TextItem
  return {
    jobId: 'job', updatedAt: '2026-11-06T12:00:00Z', filename: 'render_test.mp4',
    document: { version: 1, mode: 'assemble', texts: [caption], jobs: [{ id: 'captions', type: 'captions.generate', resultTextIds: ['caption'] }] },
    bindings: { shots: ['poster'] },
    composition: {
      id: 'compiled', documentRevision: 'revision', compilerVersion: '1', catalogVersion: '1', duration: 4,
      output: { aspect: 'portrait', fit: 'cover', resolution: '1080p', fps: 24, format: 'mp4', quality: 'high' },
      assets: [{ id: 'poster', file: 'poster.png', version: 'sha256:exact', kind: 'image', duration: 10, width: 1080, height: 1920 }],
      tracks: [{ id: 'video', type: 'video', name: 'Video', muted: false, hidden: false, locked: false,
        clips: [{ id: 'clip', assetId: 'poster', start: 1, inPoint: 2, outPoint: 8, playbackRate: 2, volume: 0,
          transform: { ...DEFAULT_CLIP_TRANSFORM }, transformKeyframes: [], opacity: 0.8, fadeIn: 0.2, fadeOut: 0.3 }] }],
      effects: [], transitions: [], textRenderKey: 'text', segments: {}, textItems: [caption],
    },
  }
}

function emptyState(): ProjectState {
  return { schemaVersion: 1, timeline: { channels: [], effectBlocks: [], transitions: [], textItems: [], fps: 30,
    resolution: '1080p', projectAspect: null, videoFit: 'contain', documentSession: null, currentTime: 0,
    selectedClipIds: [], selectedEffectBlockIds: [], selectedTextItemIds: [] }, media: [] }
}

describe('opening prepared projects', () => {
  it('materializes exact source geometry, output and caption entries without provider work', () => {
    const prepared = fixture()
    const before = JSON.stringify(prepared)
    const state = preparedProjectState(prepared)!
    expect(state.timeline.channels[0].clips[0]).toMatchObject({ fileName: 'poster.png', start: 1, inPoint: 2, outPoint: 8, playbackRate: 2, opacity: 0.8 })
    expect(state.timeline).toMatchObject({ fps: 24, projectAspect: 'portrait', videoFit: 'cover' })
    expect(state.timeline.textItems).toEqual(prepared.composition!.textItems)
    expect(state.timeline.documentSession?.document.jobs?.[0].resultTextIds).toEqual(['caption'])
    expect(state.media[0]).toMatchObject({ name: 'poster.png', sourceRevision: 'sha256:exact', sourceMode: 'proxy' })
    state.timeline.textItems[0].text = 'changed in editor'
    expect(JSON.stringify(prepared)).toBe(before)
  })

  it('hydrates both never-opened projects and previously autosaved empty projects', () => {
    expect(projectStateForOpen(null, { prepared: fixture() })?.timeline.channels[0].clips).toHaveLength(1)
    expect(projectStateForOpen(emptyState(), { prepared: fixture() })?.timeline.channels[0].clips).toHaveLength(1)
  })

  it('never replaces a saved edit or an intentionally cleared document', () => {
    const saved = preparedProjectState(fixture())!
    saved.timeline.textItems[0].text = 'My manual edit'
    expect(projectStateForOpen(saved, { prepared: fixture() })).toBe(saved)
    saved.timeline.channels = []
    saved.timeline.textItems = []
    saved.media = []
    expect(projectStateForOpen(saved, { prepared: fixture() })).toBe(saved)
  })

  it('advances an untouched prepared timeline, but preserves manual changes and intentional clears', () => {
    const saved = preparedProjectState(fixture())!
    const next = fixture()
    next.composition!.id = 'next-compiled'
    expect(projectStateForOpen(saved, { prepared: next })?.preparedCompositionId).toBe('next-compiled')
    saved.timeline.documentSession!.kind = 'dirty'
    expect(projectStateForOpen(saved, { prepared: next })).toBe(saved)
    saved.timeline.documentSession = null
    saved.timeline.channels = []
    saved.timeline.textItems = []
    saved.media = []
    expect(projectStateForOpen(saved, { prepared: next })).toBe(saved)
  })

  it('keeps invalid saved data for the normal recovery error instead of replacing it', () => {
    const invalid = { schemaVersion: 2 } as unknown as ProjectState
    expect(projectStateForOpen(invalid, { prepared: fixture() })).toBe(invalid)
  })

  it('preserves Media Bin changes even when the compiled timeline is still ready', () => {
    const saved = preparedProjectState(fixture())!
    saved.media[0].displayName = 'My renamed artwork'
    const next = fixture()
    next.composition!.id = 'next-compiled'
    expect(projectStateForOpen(saved, { prepared: next })).toBe(saved)
  })

  it('exports an importable JSON recipe with exact UTF-8 captions and resolved job IDs', () => {
    const prepared = fixture()
    const json = preparedCompositionJSON(prepared)
    const parsed = JSON.parse(json)
    expect(parsed.document).toEqual(prepared.document)
    expect(parsed.assets).toEqual(prepared.composition!.assets)
    expect(json).toContain('Știință')
    expect(json).not.toContain('blob:')
  })

  it('does not invent an editable snapshot for an old filename-only render', () => {
    const old = { updatedAt: '2026-11-06T12:00:00Z', filename: 'render_old.mp4' }
    expect(projectStateForOpen(null, { lastRender: old })).toBeNull()
    expect(() => preparedCompositionJSON(old)).toThrow('no retained editable snapshot')
  })
})
