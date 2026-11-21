import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { loadCachedProjectText } from '../../lib/project-text-cache'
import { textAssetDigest } from '../../lib/project-text-assets'

function browserCache() {
  const entries = new Map<string, Response>()
  const url = (key: RequestInfo | URL) => typeof key === 'string' ? key : key instanceof URL ? key.href : key.url
  const cache = {
    match: vi.fn(async (key: RequestInfo | URL) => {
      const stored = entries.get(url(key))
      return stored ? new Response(await stored.clone().text(), { headers: stored.headers }) : undefined
    }),
    put: vi.fn(async (key: RequestInfo | URL, response: Response) => { entries.set(url(key), response.clone()) }),
    delete: vi.fn(async (key: RequestInfo | URL) => entries.delete(url(key))),
    keys: vi.fn(async () => [...entries.keys()].map(key => new Request(key))),
  }
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
  return { cache, entries }
}

async function fixture(key = 'render-key') {
  const value = { key, overlays: [{ start: 1.1, duration: 1.3, x: 12, y: 1400, image: 'data:image/png;base64,EXACT' }] }
  const source = JSON.stringify(value)
  return { value, source, reference: { id: await textAssetDigest(source), key } }
}

afterEach(() => vi.unstubAllGlobals())

describe('persistent caption raster cache', () => {
  it('reopens without any network download and keeps exact bytes without saving signed URLs or auth headers', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const { entries } = browserCache()
    const { value, source, reference } = await fixture()
    const load = vi.fn(async () => source)
    expect(await loadCachedProjectText('alice', 'film', reference, load)).toEqual(value)
    expect(await loadCachedProjectText('alice', 'film', reference, load)).toEqual(value)
    expect(load).toHaveBeenCalledTimes(1)
    expect(entries.size).toBe(1)
    const [url, response] = [...entries][0]
    expect(url).toContain('/alice/film/')
    expect(url).not.toContain('signature')
    expect(response.headers.has('Authorization')).toBe(false)
    expect(await response.clone().text()).toBe(source)
  })

  it('isolates owners and projects and deduplicates only concurrent loads in the same scope', async () => {
    vi.stubGlobal('crypto', webcrypto)
    browserCache()
    const { source, reference } = await fixture()
    const load = vi.fn(async () => source)
    await Promise.all([
      loadCachedProjectText('alice', 'film', reference, load),
      loadCachedProjectText('alice', 'film', reference, load),
      loadCachedProjectText('bob', 'film', reference, load),
      loadCachedProjectText('alice', 'other-film', reference, load),
    ])
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('rejects corrupt cached bytes and refetches without regenerating text', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const { entries } = browserCache()
    const { value, source, reference } = await fixture()
    const load = vi.fn(async () => source)
    await loadCachedProjectText('alice', 'film', reference, load)
    entries.set([...entries.keys()][0], new Response('corrupt'))
    expect(await loadCachedProjectText('alice', 'film', reference, load)).toEqual(value)
    expect(load).toHaveBeenCalledTimes(2)
    await expect(loadCachedProjectText('alice', 'film', { ...reference, key: 'wrong-key' }, load)).rejects.toThrow('do not match')
  })

  it('bounds persistent storage and never treats a failed download as a cached result', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const { entries } = browserCache()
    const first = await fixture('first')
    const load = vi.fn(async () => first.source)
    await loadCachedProjectText('alice', 'film', first.reference, load)
    for (let index = 0; index < 12; index++) {
      const next = await fixture(`next-${index}`)
      await loadCachedProjectText('alice', 'film', next.reference, async () => next.source)
    }
    expect(entries.size).toBe(12)
    await loadCachedProjectText('alice', 'film', first.reference, load)
    expect(load).toHaveBeenCalledTimes(2)
    const failed = await fixture('failed')
    await expect(loadCachedProjectText('alice', 'film', failed.reference, async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(await loadCachedProjectText('alice', 'film', failed.reference, async () => failed.source)).toEqual(failed.value)
  })

  it('keeps loading functional when browser cache storage is disabled', async () => {
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('caches', { open: async () => { throw new Error('private mode') } })
    const { value, source, reference } = await fixture()
    expect(await loadCachedProjectText('alice', 'film', reference, async () => source)).toEqual(value)
  })
})
