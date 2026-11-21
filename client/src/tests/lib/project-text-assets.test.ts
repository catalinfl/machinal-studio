import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { compactSessionText, prepareSessionText, sessionTextAssets, textAssetDigest } from '../../lib/project-text-assets'
import { loadProjectTextAsset, loadPreparedComposition, projectConflict, ProjectRequestError } from '../../lib/project-api'
import { preparedCompositionJSON, type PreparedComposition } from '../../lib/project-presentation'
import type { DocumentSession, PreparedText } from '../../lib/composition-types'

function session(prepared: PreparedText): DocumentSession {
  return {
    kind: 'ready', document: { version: 1, mode: 'assemble', texts: [{ id: 'caption', text: '  Știință\nși țară! ', start: 1.1, duration: 1.3,
      words: [{ text: ' Știință', start: 0, end: 0.5 }, { text: 'și țară! ', start: 0.5, end: 1.3 }] }], jobs: [{ id: 'captions', type: 'captions.generate', resultTextIds: ['caption'] }] },
    assets: [], bindings: {}, preparedText: prepared,
    composition: { id: 'composition', compilerVersion: '1', catalogVersion: '1', documentRevision: 'revision', duration: 3,
      output: { aspect: 'portrait', resolution: '1080p', fps: 30, format: 'mp4', quality: 'normal' },
      assets: [], tracks: [], effects: [], transitions: [], textItems: [], textRenderKey: prepared.key, preparedText: structuredClone(prepared), segments: {} },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('immutable project text assets', () => {
  it('replaces both multi-megabyte cache copies with references without changing caption entries', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const prepared = { key: 'caption-key', overlays: [{ start: 1.1, duration: 1.3, x: 12, y: 1400, image: 'x'.repeat(4_000_000) }] }
    const original = session(prepared)
    const baseline = JSON.stringify(original.document)
    const ready = await prepareSessionText(original)
    const compact = compactSessionText(ready)!
    expect(JSON.stringify(compact).length).toBeLessThan(4096)
    expect(compact.preparedText).toBeUndefined()
    expect(compact.composition.preparedText).toBeUndefined()
    expect(compact.preparedTextRef).toEqual(compact.composition.preparedTextRef)
    expect(sessionTextAssets(ready)).toHaveLength(1)
    expect(ready.preparedText).toEqual(prepared)
    expect(original.preparedText).toEqual(prepared)
    expect(JSON.stringify(compact.document)).toBe(baseline)
    expect(original).not.toHaveProperty('preparedTextRef')

    const load = vi.fn(async () => prepared)
    const restored = await prepareSessionText(compact, load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(restored.preparedText).toEqual(prepared)
    expect(restored.composition.preparedText).toEqual(prepared)
    expect(compactSessionText(restored)).toEqual(compact)
    compact.composition.preparedTextRef = { ...compact.preparedTextRef!, key: 'wrong-key' }
    await expect(prepareSessionText(compact, load)).rejects.toThrow('conflicting render keys')
  })

  it('preserves distinct render caches and changes the asset identity if raster bytes change', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const first = session({ key: 'same-key', overlays: [] })
    first.composition.preparedText!.overlays = [{ start: 0, duration: 1, x: 0, y: 0, image: 'different' }]
    const ready = await prepareSessionText(first)
    expect(sessionTextAssets(ready)).toHaveLength(2)
    expect(ready.preparedTextRef!.id).not.toBe(ready.composition.preparedTextRef!.id)
    await expect(prepareSessionText(compactSessionText(ready)!)).rejects.toThrow('could not be restored')
  })

  it('does not remove an inline cache before it has a matching reference', () => {
    const original = session({ key: 'unsaved-key', overlays: [] })
    expect(compactSessionText(original)!.preparedText).toBe(original.preparedText)
    original.preparedTextRef = { id: 'a'.repeat(64), key: 'old-key' }
    expect(compactSessionText(original)!.preparedText).toBe(original.preparedText)
  })

  it('checks bytes and keys on restore and exposes conflicts as structured errors', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const value = { key: 'key', overlays: [] }
    const source = JSON.stringify(value)
    const reference = { id: await textAssetDigest(source), key: value.key }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source)))
    expect(await loadProjectTextAsset('project', reference)).toEqual(value)
    await expect(loadProjectTextAsset('project', { ...reference, id: 'a'.repeat(64) })).rejects.toThrow('integrity')
    await expect(loadProjectTextAsset('project', { ...reference, key: 'other-key' })).rejects.toThrow('do not match')
    const conflict = projectConflict()
    expect(conflict).toBeInstanceOf(ProjectRequestError)
    expect(conflict.status).toBe(409)
  })

  it('hydrates reference-only JSON exports with the exact existing raster cache', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const value = { key: 'export-key', overlays: [{ start: 1.1, duration: 1.3, x: 12, y: 1400, image: 'exact-PNG' }] }
    const source = JSON.stringify(value)
    const original = session(value)
    const { preparedText: _, ...composition } = original.composition
    const prepared: PreparedComposition = { updatedAt: '2026-11-10T12:00:00Z', document: original.document, bindings: {}, composition,
      preparedTextRef: { id: await textAssetDigest(source), key: value.key } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source)))
    const loaded = await loadPreparedComposition('film', prepared)
    const result = JSON.parse(preparedCompositionJSON(loaded))
    expect(result.preparedText).toEqual(value)
    expect(result.document).toEqual(original.document)
    expect(result.document.jobs[0].resultTextIds).toEqual(['caption'])
    expect(prepared.composition?.preparedText).toBeUndefined()
  })
})
