import { describe, expect, it } from 'vitest'
import { availableProjectAssets, bindAssetInProjectSource, documentSource, minimizeDocument, parseProjectFile, projectFile, repairLegacyTimelineSource } from '../../lib/composition-file'
import { DEFAULT_CLIP_TRANSFORM } from '../../lib/clip-transform'
import type { CompositionInput } from '../../lib/composition-types'

function fullDefaultsDocument() {
  const clip = {
    id: 'clip_1', assetId: 'video.mp4', start: 0, inPoint: 0, outPoint: 1.2165, playbackRate: 1, volume: 100,
    linkedClipId: 'clip_2', transform: { ...DEFAULT_CLIP_TRANSFORM }, transformKeyframes: [],
    opacity: 1, fadeIn: 0, fadeOut: 0,
  }
  return {
    version: 1, catalogVersion: '1', compilerVersion: '1', revision: 'deadbeef', mode: 'assemble',
    tracks: [
      { id: 'v1', type: 'video', name: 'Video 1', muted: false, hidden: false, locked: false, clips: [{ ...clip, linkedClipId: undefined }] },
      { id: 'a1', type: 'audio', name: 'Audio 1', muted: false, hidden: false, locked: false, clips: [clip] },
    ],
    effects: [{ id: 'fx_1', trackId: 'v1', preset: 'vignette', start: 0, duration: 1.2165, params: {}, ownerClipId: 'clip_1' }],
    transitions: [], texts: [],
    output: { fps: 30, resolution: '1080p', aspect: 'landscape', format: 'mp4', quality: 'normal' },
  }
}

describe('saved composition YAML', () => {
  it('retains fill framing in saved YAML while omitting the backwards-compatible fit default', () => {
    const project: CompositionInput = {
      document: { version: 1, mode: 'assemble', output: { aspect: 'portrait', fit: 'cover' } },
      assets: [], bindings: {},
    }
    expect(parseProjectFile(projectFile(project)).document).toEqual(project.document)
    expect(minimizeDocument({ version: 1, mode: 'assemble', output: { fit: 'contain' } }).output).toBeUndefined()
  })

  it('resolves available media from the live inventory instead of stale YAML assets', () => {
    const deleted = { id: 'deleted', file: 'deleted.mp4', kind: 'video' as const, duration: 5, version: 'v1' }
    const available = { ...deleted, id: 'live', file: 'live.mp4' }
    const alias = { ...available, id: 'recipe-alias', file: 'LIVE.mp4' }
    const added = { ...deleted, id: 'added', file: 'added.mp4' }
    const declared = [deleted, alias]

    expect(availableProjectAssets(declared, [available, added])).toEqual([alias, added])
    expect(declared).toEqual([deleted, alias])
  })

  it('exports only timeline assets, including linked audio, without changing the media inventory', () => {
    const used = { id: 'video.mp4', file: 'video.mp4', kind: 'video' as const, duration: 5, version: 'v1', hasAudio: true }
    const unused = { ...used, id: 'unused.mp4', file: 'unused.mp4' }
    const project: CompositionInput = { document: fullDefaultsDocument() as never, bindings: {}, assets: [unused, used] }

    expect(parseProjectFile(projectFile(project)).assets).toEqual([used])
    expect(project.assets).toEqual([unused, used])
    expect(parseProjectFile(projectFile({ ...project, document: { version: 1, mode: 'assemble' } })).assets).toEqual([])
  })

  it('keeps recipe dependencies in string documents, bindings and generation jobs', () => {
    const assets = ['shot', 'music', 'reference', 'generated', 'unused'].map((id) => ({
      id, file: `${id}.mp4`, kind: 'video' as const, duration: 5, version: 'v1',
    }))
    const project: CompositionInput = {
      document: 'version: 1\nmode: assemble\nsequence:\n  use: shots\n',
      recipe: 'version: 2\nmode: assemble\naudio:\n  - {id: music, use: music, start: 0, from: 0}\nbefore:\n  - {id: image, type: image, assetId: reference, resultAssetId: generated}\n',
      bindings: { shots: ['shot'] }, assets,
    }

    expect(parseProjectFile(projectFile(project)).assets.map((asset) => asset.id)).toEqual(['shot', 'music', 'reference', 'generated'])
  })

  it('adds an asset from the media inventory when binding a filtered recipe', () => {
    const asset = { id: 'shot', file: 'shot.mp4', kind: 'video' as const, duration: 5, version: 'v1' }
    const source = projectFile({ document: { version: 1, mode: 'assemble' }, bindings: {}, assets: [asset] })
    expect(parseProjectFile(source).assets).toEqual([])

    const bound = bindAssetInProjectSource(source, asset.id, [asset])
    expect(parseProjectFile(bound).assets).toEqual([asset])
    expect(parseProjectFile(bound).bindings).toEqual({ shots: ['shot'] })
    expect(bindAssetInProjectSource(bound, asset.id, [asset])).toBe(bound)
  })

  it('preserves editable text, bindings, assets and PNG payloads through a YAML round trip', () => {
    const project: CompositionInput = {
      document: { version: 1, mode: 'assemble', texts: [{ id: 'title', text: 'Salut: #lume\năâîșț', start: 1, duration: 3, fontFamily: 'montserrat', rotation: 15 }] },
      bindings: { shots: ['source'] },
      assets: [{ id: 'source', file: 'shot.mp4', kind: 'video', duration: 5, version: 'sha256:abc' }],
      preparedText: { key: 'text-key', overlays: [{ start: 1, duration: 3, x: 120, y: 80, image: 'iVBORw0KGgo=' }] },
    }
    const yaml = projectFile(project)
    expect(yaml).toMatch(/^document:\n/)
    expect(parseProjectFile(yaml)).toEqual(project)
    expect(parseProjectFile(JSON.stringify(project))).toEqual(project)
  })

  it('saves reusable rules next to the resolved timeline without replacing the rendered document', () => {
    const recipe = { version: 2 as const, mode: 'modify' as const, rules: [
      { id: 'each', target: { kind: 'video' as const, position: 'all' as const }, apply: { look: 'warm-memory' } },
    ] }
    const project: CompositionInput = {
      document: { version: 2, mode: 'assemble' }, recipe, bindings: {}, assets: [],
    }
    expect(parseProjectFile(projectFile(project))).toEqual({
      document: { mode: 'assemble' },
      recipe: { mode: 'modify', rules: recipe.rules },
      bindings: {},
      assets: [],
    })
  })

  it('accepts a standalone recipe and rejects aliases and duplicate fields', () => {
    const source = 'version: 1\nmode: assemble\n'
    expect(parseProjectFile(source)).toEqual({ document: source, bindings: {}, assets: [] })
    expect(() => parseProjectFile('version: 1\nversion: 2')).toThrow()
    expect(() => parseProjectFile('document: &doc {version: 1}\nassets: *doc')).toThrow('aliases')
  })

  it('edits bindings inside a complete recipe without losing its document or assets', () => {
    const source = `document:\n  version: 1\n  mode: assemble\n  inputs:\n    shots: {kind: image, multiple: true}\nbindings: {}\nassets:\n  - {id: shot0, file: shot0.png, kind: image, version: v1}\n`
    const bound = bindAssetInProjectSource(source, 'shot0')
    expect(parseProjectFile(bound).bindings).toEqual({ shots: ['shot0'] })
    expect(parseProjectFile(bound).assets).toEqual([{ id: 'shot0', file: 'shot0.png', kind: 'image', version: 'v1' }])
    expect(parseProjectFile(bound).document).toEqual(parseProjectFile(source).document)
    expect(bindAssetInProjectSource(bound, 'shot0')).toBe(bound)
  })

  it('omits server defaults from the exported document', () => {
    const minimized = minimizeDocument(fullDefaultsDocument() as never)
    expect(minimized).toEqual({
      version: 1, mode: 'assemble',
      tracks: [
        { id: 'v1', type: 'video', name: 'Video 1', clips: [{ id: 'clip_1', assetId: 'video.mp4', start: 0, inPoint: 0, outPoint: 1.217 }] },
        { id: 'a1', type: 'audio', name: 'Audio 1', clips: [{ id: 'clip_1', assetId: 'video.mp4', start: 0, inPoint: 0, outPoint: 1.217, linkedClipId: 'clip_2' }] },
      ],
      effects: [{ id: 'fx_1', trackId: 'v1', preset: 'vignette', start: 0, duration: 1.217, ownerClipId: 'clip_1' }],
    })
    const yaml = projectFile({ document: fullDefaultsDocument() as never, bindings: {}, assets: [] })
    for (const noise of ['catalogVersion', 'compilerVersion', 'revision', 'transform', 'opacity', 'volume', 'playbackRate', 'fadeIn', 'fadeOut', 'params', 'muted', 'transitions', 'texts', '1080p']) {
      expect(yaml).not.toContain(noise)
    }
  })

  it('keeps every non-default value in the exported document', () => {
    const source = fullDefaultsDocument() as any
    source.tracks[0].muted = true
    source.tracks[0].clips[0].volume = 50
    source.tracks[0].clips[0].opacity = 0.5
    source.tracks[0].clips[0].transform = { ...DEFAULT_CLIP_TRANSFORM, zoomX: 2, zoomY: 2 }
    source.tracks[0].clips[0].transformKeyframes = [{ time: 0, transform: { ...DEFAULT_CLIP_TRANSFORM, rotation: 90 } }]
    source.effects[0].params = { strength: 0.25 }
    source.output = { fps: 60, resolution: '1080p', aspect: 'landscape', format: 'mp4', quality: 'normal' }
    const minimized = minimizeDocument(source) as any
    expect(minimized.tracks[0].muted).toBe(true)
    expect(minimized.tracks[0].clips[0].volume).toBe(50)
    expect(minimized.tracks[0].clips[0].opacity).toBe(0.5)
    expect(minimized.tracks[0].clips[0].transform).toEqual({ zoomX: 2, zoomY: 2 })
    expect(minimized.tracks[0].clips[0].transformKeyframes).toEqual([{ time: 0, transform: { rotation: 90 } }])
    expect(minimized.effects[0].params).toEqual({ strength: 0.25 })
    expect(minimized.output).toEqual({ fps: 60 })
  })

  it('repairs an old cut with an out-of-bounds keyframe and emits millisecond times', () => {
    const source = fullDefaultsDocument() as any
    const first = source.tracks[0].clips[0]
    first.outPoint = 1.3834000000000233
    first.transformKeyframes = [
      { time: 0, transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 1.02, zoomY: 1.02 } },
      { time: 0.42, transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 1.02, zoomY: 1.02 } },
      { time: 10.033522, transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 1.02, zoomY: 1.02 } },
    ]
    const asset = { id: 'video.mp4', file: 'video.mp4', kind: 'video' as const, duration: 10.033522, version: 'v1', hasAudio: true }
    const yaml = documentSource(source, [asset])
    const repaired = minimizeDocument(source, [asset]) as any

    expect(yaml).not.toContain('10.033522')
    expect(yaml).not.toContain('1.3834000000000233')
    expect(repaired.tracks[0].clips[0].outPoint).toBe(1.383)
    expect(repaired.tracks[0].clips[0].transformKeyframes.at(-1).time).toBe(1.383)
    expect(repaired.tracks[0].clips[0].transformKeyframes.every((frame: { time: number }) => frame.time <= 1.383)).toBe(true)
    expect(asset.hasAudio).toBe(true)
  })

  it('does not round a source outPoint beyond its actual media duration', () => {
    const source = fullDefaultsDocument() as any
    source.tracks[0].clips[0].outPoint = 10.033522
    const assets = [{ id: 'video.mp4', file: 'video.mp4', kind: 'video' as const, duration: 10.033522, version: 'v1' }]
    const exported = minimizeDocument(source, assets)
    expect(exported.tracks![0].clips[0].outPoint).toBe(10.033)
  })

  it('repairs stale keyframes in pasted YAML without changing a valid authored recipe', () => {
    const stale = `version: 1
mode: assemble
tracks:
  - id: v1
    type: video
    clips:
      - id: first
        assetId: video.mp4
        start: 0
        inPoint: 0
        outPoint: 1.3834000000000233
        transformKeyframes:
          - time: 0.42
            transform: {zoomX: 1.02, zoomY: 1.02}
          - time: 10.033522
            transform: {zoomX: 1.02, zoomY: 1.02}
`
    const assets = [{ id: 'video.mp4', file: 'video.mp4', kind: 'video' as const, duration: 10.033522, version: 'v1' }]
    const repaired = repairLegacyTimelineSource(stale, assets)
    expect(repaired).not.toBe(stale)
    expect(typeof repaired).toBe('object')
    if (typeof repaired === 'string') return
    expect(repaired.tracks![0].clips[0].transformKeyframes.at(-1)?.time).toBe(1.383)
    expect(repairLegacyTimelineSource(stale.replace('10.033522\n', '1.383\n'), assets)).toEqual(stale.replace('10.033522\n', '1.383\n'))
  })
})
