import type { PreparedText, PreparedTextReference } from './composition-types'
import { textAssetDigest } from './project-text-assets'

const CACHE_NAME = 'machinal-project-text-v1'
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const MAX_CACHE_ENTRIES = 12
const pending = new Map<string, Promise<PreparedText>>()

async function decode(source: string, reference: PreparedTextReference): Promise<PreparedText> {
  if (await textAssetDigest(source) !== reference.id) throw new Error('The saved caption images failed their integrity check.')
  const value = JSON.parse(source) as PreparedText
  if (value.key !== reference.key || !Array.isArray(value.overlays)) throw new Error('The saved caption images do not match their reference.')
  return value
}

async function openCache(owner: string): Promise<Cache | undefined> {
  if (!owner || typeof caches === 'undefined') return undefined
  try { return await caches.open(CACHE_NAME) } catch { return undefined }
}

async function retain(cache: Cache, key: string, source: string): Promise<void> {
  const size = new Blob([source]).size
  if (size > MAX_CACHE_BYTES) return
  await cache.delete(key)
  await cache.put(key, new Response(source, { headers: { 'Content-Type': 'application/json', 'X-Cache-Bytes': String(size) } }))
  const entries = await cache.keys()
  const sizes = await Promise.all(entries.map(async entry => {
    const response = await cache.match(entry)
    const bytes = Number(response?.headers.get('X-Cache-Bytes') ?? MAX_CACHE_BYTES)
    await response?.body?.cancel()
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : MAX_CACHE_BYTES
  }))
  let total = sizes.reduce((sum, bytes) => sum + bytes, 0)
  let count = entries.length
  for (let index = 0; index < entries.length && (total > MAX_CACHE_BYTES || count > MAX_CACHE_ENTRIES); index++) {
    await cache.delete(entries[index])
    total -= sizes[index]
    count--
  }
}

async function restore(owner: string, key: string, reference: PreparedTextReference, load: () => Promise<string>): Promise<PreparedText> {
  const cache = await openCache(owner)
  try {
    const cached = await cache?.match(key)
    if (cached) return await decode(await cached.text(), reference)
  } catch {
    await cache?.delete(key).catch(() => {})
  }
  const source = await load()
  const value = await decode(source, reference)
  // Browser storage is optional; quota/private-mode failures must not discard a valid edit.
  if (cache) await retain(cache, key, source).catch(() => {})
  return value
}

export function loadCachedProjectText(owner: string, project: string, reference: PreparedTextReference, load: () => Promise<string>): Promise<PreparedText> {
  const scope = [owner, project, reference.id, reference.key].map(encodeURIComponent).join('/')
  const key = new URL(`/__machinal_cache__/text/${scope}`, location.origin).href
  const existing = pending.get(key)
  if (existing) return existing
  const result = restore(owner, key, reference, load).finally(() => { pending.delete(key) })
  pending.set(key, result)
  return result
}
