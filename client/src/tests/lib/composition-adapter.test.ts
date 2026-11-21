import { beforeEach, describe, expect, it, vi } from 'vitest'
import { editor } from '../../stores/editor.svelte'
import { DEFAULT_CLIP_TRANSFORM } from '../../lib/clip-transform'
import { compositionTimeline, snapshotTimeline, cloneJSON } from '../../lib/composition-adapter'
import { captureCompileInput, currentProject, currentTimeline, editorAssets, startDocumentSync } from '../../lib/compositions'
import type { CompilationResult, Composition, CompositionInput, DocumentSession } from '../../lib/composition-types'
import { clearMediaBinSources, registerMediaBinSource, unregisterMediaBinSource } from '../../lib/media-bin'

function fixture(): Composition {
  return {
    id: 'compiled-1', documentRevision: 'document-1', compilerVersion: '1', catalogVersion: '1', duration: 5, textRenderKey: 'text-1',
    output: { aspect: 'portrait', resolution: '720p', fps: 30, format: 'mp4', quality: 'normal' },
    assets: [{ id: 'source', version: 'v1', file: 'shot.mp4', kind: 'video', duration: 10 }],
    tracks: [{ id: 'sequence/video', name: 'Sequence', type: 'video', muted: false, hidden: false, locked: false,
      clips: [{ id: 'clip', assetId: 'source', start: 0, inPoint: 0, outPoint: 5, playbackRate: 1, volume: 100,
        opacity: 0.6, fadeIn: 0.2, fadeOut: 0.3, transform: { ...DEFAULT_CLIP_TRANSFORM }, transformKeyframes: [] }] }],
    effects: [], transitions: [], textItems: [], segments: { clip: [{ srcStart: 0, srcEnd: 5, effects: [] }] },
  }
}

function session(composition: Composition): DocumentSession {
  return {
    kind: 'ready', composition, assets: composition.assets, bindings: { shots: ['source'] },
    document: {
      version: 1, revision: 'document-1', mode: 'assemble', inputs: { shots: { kind: 'video', multiple: true } },
      sequence: { use: 'shots', each: { take: { from: 0, duration: 5 }, source_audio: 'remove' } }, output: composition.output,
    },
  }
}

describe('compiled document application', () => {
  beforeEach(() => {
    clearMediaBinSources()
    editor.clearTimeline()
    editor.resetProjectAspect()
    editor.clearHistory()
  })

  it('preserves framing through compilation, manual edits and project serialization', () => {
    const composition = fixture()
    composition.output.fit = 'cover'
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), session(composition), editor.stateRevision)
    expect(editor.videoFit).toBe('cover')
    expect(currentTimeline().fit).toBe('cover')
    editor.withHistoryTransaction(() => editor.setVideoFit('contain'))
    expect(currentProject().document.output?.fit).toBe('contain')
    expect(editor.documentSession?.kind).toBe('dirty')
    expect(editor.undo()).toBe(true)
    expect(editor.videoFit).toBe('cover')
    expect(currentProject().document.output?.fit).toBe('cover')
  })

  it('applies exact geometry, compositing and aspect as one undoable revision', () => {
    const composition = fixture()
    const initialChannels = cloneJSON(editor.channels)
    editor.applyCompiledTimeline(compositionTimeline(composition, () => 'blob:preview'), session(composition), editor.stateRevision)
    expect(editor.channels[0].clips[0]).toMatchObject({ id: 'clip', start: 0, inPoint: 0, outPoint: 5, opacity: 0.6, fadeIn: 0.2, fadeOut: 0.3 })
    expect(editor.documentSession?.kind).toBe('ready')
    expect(editor.effectiveProjectAspect).toBe('portrait')
    expect(editor.undo()).toBe(true)
    expect(editor.channels).toEqual(initialChannels)
    expect(editor.documentSession).toBeNull()
    expect(editor.projectAspect).toBeNull()
    expect(editor.redo()).toBe(true)
    expect(editor.documentSession?.document.revision).toBe('document-1')
    expect(editor.effectiveProjectAspect).toBe('portrait')
  })

  it('rolls back the whole application when exact-result verification fails', () => {
    const composition = fixture()
    const channels = cloneJSON(editor.channels)
    const revision = editor.stateRevision
    expect(() => editor.applyCompiledTimeline(compositionTimeline(composition, () => null), session(composition), revision, true, () => { throw new Error('parity failure') })).toThrow('parity failure')
    expect(editor.channels).toEqual(channels)
    expect(editor.documentSession).toBeNull()
    expect(editor.stateRevision).toBe(revision)
    expect(editor.canUndo).toBe(false)
  })

  it('rejects stale results before changing the timeline', () => {
    const revision = editor.stateRevision
    editor.setFps(24)
    expect(() => editor.applyCompiledTimeline(compositionTimeline(fixture(), () => null), session(fixture()), revision)).toThrow('Timeline changed')
    expect(editor.fps).toBe(24)
    expect(editor.documentSession).toBeNull()
  })

  it('records a manual trim as a stable override and restores its document through undo', () => {
    const composition = fixture()
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), session(composition), editor.stateRevision)
    editor.withHistoryTransaction(() => editor.trimClip('clip', 'right', -1))
    expect(editor.documentSession?.kind).toBe('dirty')
    expect(editor.documentSession?.document.sequence).toBeDefined()
    expect(editor.documentSession?.document.overrides).toEqual([expect.objectContaining({ target: 'clip', duration: 4 })])
    expect(editor.undo()).toBe(true)
    expect(editor.channels[0].clips[0].outPoint).toBe(5)
    expect(editor.documentSession?.kind).toBe('ready')
    expect(editor.documentSession?.document.overrides).toBeUndefined()
  })

  it('preserves current clip, effect, text and track selection during background synchronization', () => {
    const composition = fixture()
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), session(composition), editor.stateRevision)
    const channelId = editor.channels[0].id
    const effect = editor.addEffectBlock(channelId, 'blur', 0, 2)!
    const text = editor.addTextItem(0, { text: 'Caption' })
    editor.selectItems(['clip'], [effect.id], [text.id])
    editor.selectChannel(channelId)
    const timeline = cloneJSON(currentTimeline())
    editor.clearHistory()

    editor.applyCompiledTimeline(timeline, session(composition), editor.stateRevision, false)

    expect(editor.selectedClipIds).toEqual(['clip'])
    expect(editor.selectedEffectBlockIds).toEqual([effect.id])
    expect(editor.selectedTextItemIds).toEqual([text.id])
    expect(editor.selectedChannelIds).toEqual([channelId])
    expect(editor.canUndo).toBe(false)
  })

  it('drops only selections whose items disappeared during synchronization', () => {
    const composition = fixture()
    const timeline = compositionTimeline(composition, () => null)
    editor.applyCompiledTimeline(timeline, session(composition), editor.stateRevision)
    const effect = editor.addEffectBlock(editor.channels[0].id, 'blur', 0, 2)!
    const text = editor.addTextItem(0, { text: 'Caption' })
    editor.selectItems(['clip'], [effect.id], [text.id])

    editor.applyCompiledTimeline(timeline, session(composition), editor.stateRevision, false)

    expect(editor.selectedClipIds).toEqual(['clip'])
    expect(editor.selectedEffectBlockIds).toEqual([])
    expect(editor.selectedTextItemIds).toEqual([])
  })

  it('does not reopen an inspector closed before synchronization finishes', () => {
    const composition = fixture()
    const timeline = compositionTimeline(composition, () => null)
    editor.applyCompiledTimeline(timeline, session(composition), editor.stateRevision)
    editor.selectClip('clip')
    const revision = editor.stateRevision
    editor.clearSelection()

    editor.applyCompiledTimeline(timeline, session(composition), revision, false)

    expect(editor.selectedClipIds).toEqual([])
  })

  it('clears selection when explicitly applying a replacement composition', () => {
    const composition = fixture()
    const timeline = compositionTimeline(composition, () => null)
    editor.applyCompiledTimeline(timeline, session(composition), editor.stateRevision)
    editor.selectClip('clip')

    editor.applyCompiledTimeline(timeline, session(composition), editor.stateRevision)

    expect(editor.selectedClipIds).toEqual([])
  })

  it('keeps a complete snapshot without browser resources', () => {
    const composition = fixture()
    const timeline = compositionTimeline(composition, () => 'blob:must-not-leak')
    const snapshot = snapshotTimeline(timeline, composition.assets, 'R1')
    expect(snapshot.tracks[0].clips[0].opacity).toBe(0.6)
    expect(JSON.stringify(snapshot)).not.toContain('blob:')
    expect(snapshot.revision).toBe('R1')
  })

  it('captures a previously cut clip with bounded keyframes and millisecond geometry', () => {
    const composition = fixture()
    const clip = composition.tracks[0].clips[0]
    clip.outPoint = 1.3834000000000233
    clip.transformKeyframes = [
      { time: 0, transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 1.02, zoomY: 1.02 } },
      { time: 0.42, transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 1.02, zoomY: 1.02 } },
      { time: 10.033522, transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 1.02, zoomY: 1.02 } },
    ]
    const snapshot = snapshotTimeline(compositionTimeline(composition, () => null), composition.assets, 'R1')
    const captured = snapshot.tracks[0].clips[0]
    expect(captured.outPoint).toBe(1.383)
    expect(captured.transformKeyframes.map((frame) => frame.time)).toEqual([0, 0.42, 1.383])
    expect(captured.transformKeyframes.at(-1)?.transform.zoomX).toBeCloseTo(1.02)
  })

  it('repairs the document of an already open project when preparing it for rendering', () => {
    const composition = fixture()
    const clip = composition.tracks[0].clips[0]
    clip.outPoint = 1.3834000000000233
    clip.transformKeyframes = [{ time: 0, transform: { ...DEFAULT_CLIP_TRANSFORM } },
      { time: 10.033522, transform: { ...DEFAULT_CLIP_TRANSFORM } }]
    const saved = session(composition)
    saved.document = { version: 1, mode: 'assemble', tracks: cloneJSON(composition.tracks) }
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), saved, editor.stateRevision)

    const project = currentProject()
    expect(project.document.tracks![0].clips[0].transformKeyframes.at(-1)?.time).toBe(1.383)
    expect(editor.documentSession?.document.tracks![0].clips[0].transformKeyframes.at(-1)?.time).toBe(10.033522)
  })

  it('repairs legacy YAML before sending it to the compiler', async () => {
    const source = `version: 1
mode: assemble
tracks:
  - id: v1
    type: video
    clips:
      - id: first
        assetId: source
        start: 0
        inPoint: 0
        outPoint: 1.3834000000000233
        transformKeyframes:
          - time: 0
          - time: 10.033522
`
    const input = { document: source, bindings: {}, assets: fixture().assets }
    const captured = await captureCompileInput(input)
    expect(typeof captured.input.document).toBe('object')
    if (typeof captured.input.document === 'string') return
    expect(captured.input.document.tracks![0].clips[0].transformKeyframes.at(-1)?.time).toBe(1.383)
    expect(input.document).toBe(source)
  })

  it('excludes stale session assets while retaining timeline sources and newly imported media', () => {
    const composition = fixture()
    const stale = { ...composition.assets[0], id: 'deleted', file: 'deleted.mp4' }
    composition.assets.push(stale)
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), session(composition), editor.stateRevision)
    registerMediaBinSource({ id: 'new', name: 'new.mp4', kind: 'video', duration: 7 })

    expect(editorAssets().map((asset) => asset.file)).toEqual(['shot.mp4', 'new.mp4'])
    expect(currentProject().assets.map((asset) => asset.file)).toEqual(['shot.mp4', 'new.mp4'])
    expect(editor.documentSession?.assets).toHaveLength(2)
  })

  it('does not send a deleted asset from cached YAML back to the compiler', async () => {
    const asset = fixture().assets[0]
    unregisterMediaBinSource(asset.file)
    const input = { document: { version: 1 as const, mode: 'assemble' as const }, bindings: {}, assets: [asset] }

    expect((await captureCompileInput(input)).input.assets).toEqual([])
    expect(input.assets).toEqual([asset])
  })

  it('invalidates pending compilations and saved metadata when media is permanently deleted', () => {
    const composition = fixture()
    const deleted = { ...composition.assets[0], id: 'deleted', file: 'deleted.mp4' }
    composition.assets.push(deleted)
    const saved = session(composition)
    saved.bindings.extra = [deleted.id]
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), saved, editor.stateRevision)
    const revision = editor.stateRevision

    editor.forgetDocumentAsset('DELETED.mp4')

    expect(editor.stateRevision).toBeGreaterThan(revision)
    expect(editor.documentSession?.assets.map((asset) => asset.id)).toEqual(['source'])
    expect(editor.documentSession?.composition.assets.map((asset) => asset.id)).toEqual(['source'])
    expect(editor.documentSession?.bindings.extra).toEqual([])
    expect(() => editor.applyCompiledTimeline(compositionTimeline(composition, () => null), saved, revision)).toThrow('Timeline changed')
  })

  it('synchronizes deleting the last clip as an empty editable draft without a duration error', async () => {
    const composition = fixture()
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), session(composition), editor.stateRevision)
    registerMediaBinSource({ id: 'source', name: 'shot.mp4', kind: 'video', duration: 10 })
    const request = vi.fn(async (url: string, options: RequestInit) => {
      expect(new URL(url).searchParams.get('draft')).toBe('true')
      const input = JSON.parse(options.body as string) as CompositionInput
      if (typeof input.document === 'string') throw new Error('Expected an explicit timeline')
      const result: CompilationResult = {
        document: input.document,
        composition: { ...composition, duration: 0, tracks: input.document.tracks!, assets: input.assets, segments: {} },
        expectedRevision: input.snapshot!.revision, diagnostics: [], requirements: [], summary: '0 clips, 0s.',
      }
      return new Response(JSON.stringify(result), { status: 200 })
    })
    vi.stubGlobal('fetch', request)
    const stop = startDocumentSync()
    try {
      editor.withHistoryTransaction(() => editor.removeClip(editor.channels[0].id, 'clip'))
      await vi.waitFor(() => expect(editor.documentSession?.kind).toBe('ready'))
      expect(request).toHaveBeenCalledOnce()
      expect(editor.documentSession?.composition.duration).toBe(0)
      expect(editor.channels[0].clips).toEqual([])
      expect(editor.undo()).toBe(true)
      expect(editor.channels[0].clips[0].id).toBe('clip')
    } finally {
      stop()
      vi.unstubAllGlobals()
    }
  })

  it.each(['dirty', 'error'] as const)('synchronizes an empty %s project restored after document sync starts', async (kind) => {
    const composition = fixture()
    composition.tracks[0].clips = []
    composition.duration = 0
    const saved = session(composition)
    saved.document = { version: 1, mode: 'assemble', tracks: composition.tracks }
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), saved, editor.stateRevision)
    const snapshot = editor.captureProjectState()
    snapshot.documentSession = kind === 'error'
      ? { ...saved, kind, message: 'duration: composition duration must be positive and at most 24 hours' }
      : { ...saved, kind }
    editor.clearTimeline()
    editor.clearHistory()
    const request = vi.fn(async (url: string, options: RequestInit) => {
      expect(new URL(url).searchParams.get('draft')).toBe('true')
      const input = JSON.parse(options.body as string) as CompositionInput
      return new Response(JSON.stringify({ document: input.document, composition: { ...composition, assets: input.assets },
        expectedRevision: input.snapshot!.revision, diagnostics: [], requirements: [], summary: '0 clips, 0s.' }), { status: 200 })
    })
    vi.stubGlobal('fetch', request)
    const stop = startDocumentSync()
    try {
      editor.restoreProjectState(snapshot)
      await vi.waitFor(() => expect(editor.documentSession?.kind).toBe('ready'))
      expect(request).toHaveBeenCalledOnce()
      expect(editor.documentSession?.composition.duration).toBe(0)
      expect(editor.canUndo).toBe(false)
    } finally {
      stop()
      vi.unstubAllGlobals()
    }
  })

  it('retries an empty draft restored with the old duration error', async () => {
    const composition = fixture()
    composition.tracks[0].clips = []
    composition.duration = 0
    const saved = session(composition)
    saved.document = { version: 1, mode: 'assemble', tracks: composition.tracks }
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), saved, editor.stateRevision)
    editor.setDocumentError('duration: composition duration must be positive and at most 24 hours')
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const input = JSON.parse(options.body as string) as CompositionInput
      return new Response(JSON.stringify({ document: input.document, composition: { ...composition, assets: input.assets },
        expectedRevision: input.snapshot!.revision, diagnostics: [], requirements: [], summary: '0 clips, 0s.' }), { status: 200 })
    }))
    const stop = startDocumentSync()
    try {
      await vi.waitFor(() => expect(editor.documentSession?.kind).toBe('ready'))
      expect(editor.documentSession?.composition.duration).toBe(0)
    } finally {
      stop()
      vi.unstubAllGlobals()
    }
  })
})
