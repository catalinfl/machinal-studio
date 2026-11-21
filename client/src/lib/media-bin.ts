import type { MediaKind } from '../stores/editor.svelte'
import type { ScrubMode } from '../stores/scrub.svelte'
import type { LiveSceneSource } from './live-scene'
import { peekProjectSessionId } from './session'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import { conciseSceneName, sceneFileDisplayName } from './scene-name'

export const MEDIA_NAME_MAX_LENGTH = 120

export interface MediaBinSource {
  id: string
  name: string
  displayName?: string
  kind: MediaKind
  duration: number
  width?: number
  height?: number
  sourceMode?: ScrubMode
  sourceId?: string
  sourceRevision?: string
  scrubBlobUrl?: string | null
  previewUrl?: string | null
  thumbnailUrl?: string | null
  generated?: boolean
  isRender?: boolean
  scene?: LiveSceneSource
}

const sources = new SvelteMap<string, MediaBinSource>()
const removedSources = new SvelteSet<string>()
const pendingLoads = new Set<Promise<unknown>>()
const deferredLoads = new Set<() => Promise<unknown>>()
const sourceListeners = new Set<(source: MediaBinSource) => void>()
const removalListeners = new Set<(name: string) => void>()
const GENERATED_SOURCES_KEY = 'scrub-generated-media'

function generatedStorageKey(): string {
  const session = peekProjectSessionId()
  return session ? `${GENERATED_SOURCES_KEY}:${session}` : GENERATED_SOURCES_KEY
}

// AI-generated assets use deterministic server-side names that survive a page
// reload, unlike blob: URLs or in-memory state:
// - speech: voice_<words>_<8hex>.mp3 (see saveGeneratedSpeech)
// - image:  ai_image_<32hex>.<ext>   (see saveGeneratedImage)
// Detecting them by name keeps the Media Bin "AI" tab populated after refresh,
// even when localStorage was cleared or is unavailable.
const VOICE_GENERATED_RE = /^voice_(?:.+_)?[0-9a-f]{8}\.mp3$/i
const IMAGE_GENERATED_RE = /^ai_image_.+\.(png|jpe?g|webp)$/i
const SCENE_GENERATED_RE = /^ai_scene_[0-9a-f]{32}_\d{2}\.(?:mp4|scene\.json)$/i

export function isAIGeneratedFileName(name: string): boolean {
  const base = name.trim()
  return VOICE_GENERATED_RE.test(base) || IMAGE_GENERATED_RE.test(base) || SCENE_GENERATED_RE.test(base)
}

function storedGeneratedNames(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const names = JSON.parse(localStorage.getItem(generatedStorageKey()) ?? '[]')
    return new Set(Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistGeneratedSource(key: string, generated: boolean): void {
  if (typeof localStorage === 'undefined') return
  const names = storedGeneratedNames()
  if (generated) names.add(key)
  else names.delete(key)
  try {
    localStorage.setItem(generatedStorageKey(), JSON.stringify([...names]))
  } catch {}
}

export function isGeneratedMediaSource(name: string): boolean {
  if (isAIGeneratedFileName(name)) return true
  return storedGeneratedNames().has(name.toLowerCase())
}

export function registerMediaBinSource(source: MediaBinSource): void {
  const key = source.name.toLowerCase()
  removedSources.delete(key)
  const nameImpliesGenerated = isAIGeneratedFileName(source.name)
  const generated = nameImpliesGenerated
    ? true
    : source.generated
      ?? sources.get(key)?.generated
      ?? isGeneratedMediaSource(key)
  const registered = { ...sources.get(key), ...source, id: source.id || source.name, generated }
  if (!registered.displayName && registered.scene) {
    registered.displayName = conciseSceneName(registered.scene.title, registered.scene.text, registered.scene.explanation)
  }
  sources.set(key, registered)
  if (nameImpliesGenerated || source.generated !== undefined) persistGeneratedSource(key, generated)
  for (const listener of sourceListeners) listener({ ...registered })
}

export function getMediaBinSources(): MediaBinSource[] {
  return [...sources.values()].map((source) => ({ ...source }))
}

export function getMediaBinSource(name: string): Readonly<MediaBinSource> | undefined {
  return sources.get(name.toLowerCase())
}

export function mediaDisplayName(name: string): string {
  return getMediaBinSource(name)?.displayName || sceneFileDisplayName(name) || name
}

export function renameMediaBinSource(name: string, displayName: string): void {
  const value = displayName.trim()
  if (!value) throw new Error('Enter a name for this media item.')
  if (value.length > MEDIA_NAME_MAX_LENGTH) throw new Error(`Use ${MEDIA_NAME_MAX_LENGTH} characters or fewer.`)
  const source = getMediaBinSource(name)
  if (!source) throw new Error('This media item is no longer available. Refresh the library and try again.')
  registerMediaBinSource({ ...source, displayName: value === source.name ? undefined : value })
}

export function subscribeMediaBinSources(listener: (source: MediaBinSource) => void): () => void {
  sourceListeners.add(listener)
  return () => sourceListeners.delete(listener)
}

export function unregisterMediaBinSource(name: string): void {
  const key = name.toLowerCase()
  removedSources.add(key)
  sources.delete(key)
  persistGeneratedSource(key, false)
  for (const listener of removalListeners) listener(name)
}

export function isMediaBinSourceRemoved(name: string): boolean {
  return removedSources.has(name.toLowerCase())
}

export function subscribeMediaBinRemovals(listener: (name: string) => void): () => void {
  removalListeners.add(listener)
  return () => removalListeners.delete(listener)
}

export function trackMediaBinLoad<T>(load: Promise<T>): Promise<T> {
  pendingLoads.add(load)
  load.then(
    () => pendingLoads.delete(load),
    () => pendingLoads.delete(load),
  )
  return load
}

export function deferMediaBinLoad(load: () => Promise<unknown>): () => void {
  deferredLoads.add(load)
  return () => deferredLoads.delete(load)
}

export async function waitForMediaBinLoads(): Promise<void> {
  while (deferredLoads.size > 0 || pendingLoads.size > 0) {
    const loads = [...deferredLoads]
    deferredLoads.clear()
    for (const load of loads) trackMediaBinLoad(Promise.resolve().then(load))
    await Promise.allSettled([...pendingLoads])
  }
}

export function clearMediaBinSources(): void {
  sources.clear()
  removedSources.clear()
  deferredLoads.clear()
  if (typeof localStorage !== 'undefined') localStorage.removeItem(generatedStorageKey())
}
