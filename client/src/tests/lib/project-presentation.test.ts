import { describe, expect, it } from 'vitest'
import { DEFAULT_CLIP_TRANSFORM } from '../../lib/clip-transform'
import { isPreparedProjectPristine, preparedCompositionJSON, preparedProjectState, projectStateFingerprint, projectStateForOpen, type PreparedComposition } from '../../lib/project-presentation'
import { revisionFingerprint } from '../../lib/composition-adapter'
import type { ProjectState } from '../../lib/project-state'
import type { TextItem } from '../../lib/editor-types'
import type { MediaBinSource } from '../../lib/media-bin'

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

describe('exporting prepared snapshots', () => {
  it('exports exact documents, bindings, pinned assets and prepared text without changing the snapshot', () => {
    const prepared = fixture()
    prepared.composition!.preparedText = { key: 'prepared-caption-render', overlays: [] }
    const before = JSON.stringify(prepared)
    const exported = JSON.parse(preparedCompositionJSON(prepared))
    expect(exported).toEqual({
      document: prepared.document, bindings: prepared.bindings, assets: prepared.composition!.assets,
      preparedText: prepared.composition!.preparedText,
    })
    expect(exported.document.texts[0].text).toBe('  Știință\nși țară! ')
    expect(exported.document.texts[0].words).toEqual(prepared.document!.texts![0].words)
    expect(exported.document.jobs[0].resultTextIds).toEqual(['caption'])
    expect(JSON.stringify(prepared)).toBe(before)
  })

  it('supplies empty bindings when the retained snapshot has none', () => {
    const prepared = fixture()
    delete prepared.bindings
    expect(JSON.parse(preparedCompositionJSON(prepared)).bindings).toEqual({})
  })

  it('rejects incomplete legacy snapshots rather than inventing editable data', () => {
    const prepared = fixture()
    expect(() => preparedCompositionJSON({ ...prepared, document: undefined })).toThrow('no retained editable snapshot')
    expect(() => preparedCompositionJSON({ ...prepared, composition: undefined })).toThrow('no retained editable snapshot')
  })
})

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

  it('opens a media-only saved project as a timeline and keeps every existing source and display name', () => {
    const saved = emptyState()
    saved.media = [
      { id: 'old-poster', name: 'poster.png', kind: 'image', duration: 10, displayName: 'My artwork' },
      { id: 'music', name: 'music.mp3', kind: 'audio', duration: 10, sourceMode: 'wasm' },
    ]
    const restored = projectStateForOpen(saved, { prepared: fixture() })!
    expect(restored.timeline.channels[0].clips).toHaveLength(1)
    expect(restored.media).toHaveLength(2)
    expect(restored.media[0]).toMatchObject({ sourceId: 'poster', sourceRevision: 'sha256:exact', displayName: 'My artwork' })
    expect(restored.media[1]).toEqual({ ...saved.media[1], previewUrl: null, scrubBlobUrl: null, thumbnailUrl: null })
    expect(isPreparedProjectPristine(restored)).toBe(true)
    expect(saved.timeline.channels).toEqual([])
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

  it('keeps prepared project media reference-only without changing runtime scenes', () => {
    const scene = { version: 1 as const, component: '<p>Scene</p>', javascript: 'large-bundle',
      config: { width: 320, height: 180, fps: 30, durationInFrames: 60 } }
    const media: MediaBinSource[] = [
      { id: 'poster', name: 'poster.png', kind: 'image', duration: 10, scene },
      { id: 'extra', name: 'ai_scene_0123456789abcdef0123456789abcdef_01.scene.json', kind: 'video', duration: 2, scene },
    ]
    const prepared = fixture()
    const state = preparedProjectState(prepared, media)!
    expect(state.media).toHaveLength(2)
    for (const source of state.media) expect(source).not.toHaveProperty('scene')
    expect(media[0].scene).toBe(scene)
    expect(media[1].scene).toBe(scene)
    expect(state.timeline.textItems).toEqual(prepared.composition!.textItems)
    expect(isPreparedProjectPristine(state)).toBe(true)
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

  it('uses the same canonical fingerprint as the server independent of key order and escaping', () => {
    const raw = '{"schemaVersion":1,"timeline":{"channels":[],"text":"Știință <>& 🚀\\u2028","numbers":[0.000001,100000000000000000000,1e-7],"10":true,"2":false},"media":[]}'
    const state = JSON.parse(raw) as ProjectState
    expect(projectStateFingerprint(state)).toBe('v2:65dae530ca537bc4')
    const reordered = JSON.parse('{"media":[],"timeline":{"2":false,"10":true,"numbers":[0.000001,1e20,0.0000001],"text":"Știință \\u003c\\u003e\\u0026 🚀\\u2028","channels":[]},"schemaVersion":1}') as ProjectState
    expect(projectStateFingerprint(reordered)).toBe(projectStateFingerprint(state))
  })

  it('recognizes the previous browser fingerprint without treating a manual edit as pristine', () => {
    const state = preparedProjectState(fixture())!
    state.preparedStateFingerprint = revisionFingerprint(JSON.stringify({ schemaVersion: state.schemaVersion, timeline: state.timeline, media: state.media }))
    expect(isPreparedProjectPristine(state)).toBe(true)
    state.timeline.textItems[0].text = 'Manual change'
    expect(isPreparedProjectPristine(state)).toBe(false)
  })

  it('does not invent an editable snapshot for an old filename-only render', () => {
    const old = { updatedAt: '2026-11-06T12:00:00Z', filename: 'render_old.mp4' }
    expect(projectStateForOpen(null, { lastRender: old })).toBeNull()
    expect(preparedProjectState(old)).toBeNull()
  })
})
