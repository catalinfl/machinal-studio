import type { Component } from 'svelte'
import nativeLedger from '../../../services/scene-renderer/hyperframes/hyperframes-native.json'
import componentRegistry from '../../../services/scene-renderer/hyperframes/hyperframes-components.json'

export type NativeAspect = 'landscape' | 'portrait'
export type NativePreviewSize = { width: number; height: number; fps: number; durationInFrames: number; captionSafeBottom: number }

type MediaRequirement = { id: string; role: string }
type NativeLedgerEntry = {
  id: string
  nativePath: string
  status: string
  visualMode: '2d' | '3d'
  requiredImages?: MediaRequirement[]
  requiredVideos?: MediaRequirement[]
  adaptations?: string[]
  limitations?: string[]
}
type RegistryEntry = {
  id: string
  label?: string
  category?: string
  description?: string
}

export interface NativePort {
  id: string
  label: string
  category: string
  description: string
  nativePath: string
  visualMode: '2d' | '3d'
  requiredImages: MediaRequirement[]
  requiredVideos: MediaRequirement[]
  notes: string[]
}

export type NativePortComponent = Component

const registryById = new Map((componentRegistry as RegistryEntry[]).map(entry => [entry.id, entry]))
const componentLoaders = import.meta.glob('../../../packages/mcp-installer/library/hyperframes-native/**/*.svelte') as Record<string, () => Promise<{ default: NativePortComponent }>>

const nativePortFromEntry = (port: NativeLedgerEntry): NativePort => {
  const entry = registryById.get(port.id)
  return {
    id: port.id,
    label: entry?.label ?? port.id,
    category: entry?.category ?? port.nativePath.split('/')[0] ?? 'other',
    description: entry?.description ?? 'Native Svelte port.',
    nativePath: port.nativePath,
    visualMode: port.visualMode,
    requiredImages: port.requiredImages ?? [],
    requiredVideos: port.requiredVideos ?? [],
    notes: [...(port.adaptations ?? []), ...(port.limitations ?? [])],
  }
}

const ledgerEntries = nativeLedger as NativeLedgerEntry[]
export const nativePorts: NativePort[] = ledgerEntries
  .filter(port => port.status === 'ported')
  .map(nativePortFromEntry)
  .sort((left, right) => left.label.localeCompare(right.label))

const pendingNativePorts: NativePort[] = ledgerEntries
  .filter(port => port.status === 'pending')
  .map(nativePortFromEntry)
  .sort((left, right) => left.label.localeCompare(right.label))

// The standalone dev verifier may mount pending sources for an equivalence
// check. The user-facing gallery continues to resolve only published ports.
export function findNativePort(id: string, includePending = false): NativePort | undefined {
  return nativePorts.find(port => port.id === id)
    ?? (includePending ? pendingNativePorts.find(port => port.id === id) : undefined)
}

export const nativeCategories = ['all', ...new Set(nativePorts.map(port => port.category).sort())]

export function filterNativePorts(ports: NativePort[], query: string, category: string): NativePort[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return ports.filter(port => {
    const matchesCategory = category === 'all' || port.category === category
    const matchesQuery = !normalizedQuery || `${port.label} ${port.id} ${port.category} ${port.description}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
    return matchesCategory && matchesQuery
  })
}

export async function loadNativePortComponent(port: NativePort): Promise<NativePortComponent> {
  const path = `../../../packages/mcp-installer/library/hyperframes-native/${port.nativePath}`
  const load = componentLoaders[path]
  if (!load) throw new Error(`The native component "${port.nativePath}" is not included in the dev gallery.`)
  return (await load()).default
}

export function nativePreviewSize(aspect: NativeAspect): NativePreviewSize {
  return {
    width: aspect === 'landscape' ? 1920 : 1080,
    height: aspect === 'landscape' ? 1080 : 1920,
    fps: 30,
    durationInFrames: 780,
    captionSafeBottom: 0.24,
  }
}
