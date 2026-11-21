import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../lib/api'
import { uploadExportSources } from '../../lib/export-preflight'
import { rememberLocalSource } from '../../lib/local-media'
import { registerMediaBinSource, clearMediaBinSources } from '../../lib/media-bin'
import { selectProjectSession } from '../../lib/session'
import type { DocumentProject } from '../../lib/composition-types'

afterEach(() => { vi.restoreAllMocks(); clearMediaBinSources() })

describe('approved export uploads', () => {
  it('uploads only used originals once and leaves local project references untouched', async () => {
    selectProjectSession('p_export_test')
    const sourceId = rememberLocalSource(new File(['fixture'], 'original.png', { type: 'image/png', lastModified: 1 }))
    registerMediaBinSource({ id: sourceId, name: 'original.png', sourceId, sourceMode: 'wasm', kind: 'image', duration: 3 })
    const project = { document: { version: 1, mode: 'assemble', tracks: [{ id: 'v', type: 'video', clips: [{ assetId: sourceId, start: 0, inPoint: 0, outPoint: 3 }] }] },
      assets: [{ id: sourceId, file: 'original.png', local: true, kind: 'image', duration: 3, version: 'local' }, { id: 'unused', file: 'unused.png', local: true, kind: 'image', duration: 3, version: 'local' }], bindings: { extra: ['unused'] } } as unknown as DocumentProject
    const baseline = JSON.stringify(project)
    const upload = vi.spyOn(api, 'uploadFile').mockResolvedValue('uploaded')
    const progress = vi.fn()
    const result = await uploadExportSources(project, progress)
    expect(upload).toHaveBeenCalledOnce()
    expect(upload.mock.calls[0][0].name).toMatch(/^export_[a-f0-9]+\.png$/)
    expect(result.assets).toHaveLength(2)
    expect(result.assets[0]).toMatchObject({ id: sourceId, local: false })
    expect(result.assets[0].file).not.toBe('original.png')
    expect(result.assets[1]).toMatchObject({ id: 'unused', file: 'unused.png', local: true })
    expect(result.bindings.extra).toEqual(['unused'])
    expect(JSON.stringify(project)).toBe(baseline)
    const repeated = await uploadExportSources(project, progress)
    expect(upload).toHaveBeenCalledOnce()
    expect(repeated.assets[0].file).toBe(result.assets[0].file)
  })
})
