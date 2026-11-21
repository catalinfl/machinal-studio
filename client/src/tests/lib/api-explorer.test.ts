import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_STARTERS, apiCurlExample, buildExplorerInput, checkExplorerRecipe, explorerRequestYaml, uploadExplorerFile } from '../../lib/api-explorer'
import type { CompositionAsset } from '../../lib/composition-types'

vi.mock('../../lib/api', () => ({ API_BASE: 'https://api.example.test', authHeader: () => ({ Authorization: 'Bearer owner-token' }), friendlyHttpError: (_status: number, detail: string) => detail }))
vi.mock('../../lib/session', () => ({ sessionHeader: () => ({ 'X-Session-Id': 'owner-session' }) }))

const asset: CompositionAsset = { id: 'media-1', file: 'clip.mp4', kind: 'video', duration: 8, version: `sha256:${'a'.repeat(64)}` }

afterEach(() => vi.unstubAllGlobals())

describe('API explorer request contract', () => {
  it('binds standalone YAML to registered media and retains saved project inputs', () => {
    const input = buildExplorerInput(API_STARTERS.video, [asset], { shots: [asset.id] })
    expect(input.document).toContain('mode: assemble')
    expect(input.bindings).toEqual({ shots: ['media-1'] })
    expect(input.assets).toEqual([asset])
    const saved = buildExplorerInput('document:\n  version: 1\n  mode: assemble\nbindings:\n  shots: [saved-1]\nassets: []', [asset], {})
    expect(saved.bindings.shots).toEqual(['saved-1'])
    expect(saved.assets).toEqual([asset])
  })

  it('retains a captured timeline snapshot in both requests and exported YAML', () => {
    const source = 'document:\n  version: 2\n  mode: modify\nsnapshot:\n  revision: captured-timeline\n  tracks: []\n  effects: []\n  transitions: []\n  textItems: []\n  selectedIds: []'
    const input = buildExplorerInput(source, [], {})
    expect(input.snapshot?.revision).toBe('captured-timeline')
    expect(explorerRequestYaml(input)).toContain('revision: captured-timeline')
  })

  it.each([
    { filename: 'clip.mp4', kind: 'video', mimeType: 'video/mp4' },
    { filename: 'beaver.png', kind: 'image', mimeType: 'image/png' },
    { filename: ' track (mix) ș.wav', kind: 'audio', mimeType: 'audio/wav' },
  ] as const)('registers $filename using the multipart filename, not the upload success message', async ({ filename, kind, mimeType }) => {
    const registered = { ...asset, file: filename, kind }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(`Upload successful: /data/u_vn5hak3w6p3bas3/${filename} (446355 bytes)\n`))
      .mockResolvedValueOnce(new Response(JSON.stringify([registered]), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const file = new File(['media'], filename, { type: mimeType })
    const signal = new AbortController().signal
    const result = await uploadExplorerFile(file, 'media-1', signal)
    expect(result).toEqual(registered)
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.test/upload')
    expect(fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer owner-token', 'X-Session-Id': 'owner-session' })
    expect(fetch.mock.calls[0][1].body.get('file').name).toBe(filename)
    expect(fetch.mock.calls[0][1].signal).toBe(signal)
    expect(fetch.mock.calls[1][0]).toBe('https://api.example.test/compositions/assets')
    expect(fetch.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer owner-token', 'X-Session-Id': 'owner-session', 'Content-Type': 'application/json' })
    expect(fetch.mock.calls[1][1].signal).toBe(signal)
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ files: [{ id: 'media-1', file: filename }] })
  })

  it('does not register media when the upload fails', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('unsupported file type', { status: 415 }))
    vi.stubGlobal('fetch', fetch)
    await expect(uploadExplorerFile(new File(['media'], 'invalid.txt'), 'media-1', new AbortController().signal)).rejects.toThrow('unsupported file type')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('retains structured recipe diagnostics from HTTP 422', async () => {
    const diagnostics = [{ severity: 'error', code: 'source', path: 'sequence.each.take', message: 'Source window is too short.' }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ diagnostics }), { status: 422, headers: { 'Content-Type': 'application/json' } })))
    const result = await checkExplorerRecipe(buildExplorerInput(API_STARTERS.video, [], {}), 'compile', new AbortController().signal)
    expect(result.diagnostics).toEqual(diagnostics)
    expect(result.requirements).toEqual([])
  })

  it('emits executable YAML request examples without embedding account credentials', () => {
    expect(apiCurlExample('render', 'https://api.example.test')).toContain('--data-binary \'@composition.edit.yaml\'')
    expect(apiCurlExample('render', 'https://api.example.test')).toContain('$MACHINAL_API_KEY')
    expect(apiCurlExample('status', 'https://api.example.test')).toContain('/renders/\'"$JOB_ID"')
    expect(apiCurlExample('compile', 'https://api.example.test')).not.toContain('\n+')
    expect(apiCurlExample('render', 'https://api.example.test', 'docker')).toContain('http://127.0.0.1:8080/v1/projects/')
    expect(apiCurlExample('render', 'https://api.example.test', 'docker')).not.toContain('Authorization')
    expect(apiCurlExample('render', 'https://api.example.test', 'cli')).toBe('edit render composition.edit.yaml --root /path/to/media --output result.mp4')
  })
})
