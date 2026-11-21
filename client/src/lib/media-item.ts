import type { MediaKind, ProjectAspect } from '../stores/editor.svelte'
import type { ScrubMode } from '../stores/scrub.svelte'
import type { LiveSceneSource } from './live-scene'

export interface MediaItem {
  fileName: string
  displayName: string
  sourceId?: string
  sourceRevision?: string
  mediaKind: MediaKind
  scrubName: string
  blobUrl: string | null
  thumbnailUrl?: string | null
  duration: number
  sourceWidth?: number
  sourceHeight?: number
  projectAspect?: ProjectAspect
  mode: ScrubMode
  generated: boolean
  // True for server final exports (render_*.mp4/avi/mp3 from S3 renders/).
  // They stay available after logout/GC eviction and live in the Renders tab.
  isRender: boolean
  state: 'loading' | 'scrubbing' | 'ready' | 'error'
  previewState: 'idle' | 'loading' | 'loaded' | 'skipped' | 'error'
  errorMsg?: string
  scene?: LiveSceneSource
}

export type MediaImportProgress = {
  fileName: string
  index: number
  total: number
  startedAt: number
} & (
  | { phase: 'metadata' | 'saving' }
  | { phase: 'uploading'; loaded: number; size: number; uploadStartedAt: number }
)

export function formatMediaDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export function mediaKindLabel(item: MediaItem): string {
  if (item.scene) return 'Live scene'
  if (item.isRender) {
    if (item.mediaKind === 'audio') return 'Audio render'
    return 'Video render'
  }
  if (item.generated) {
    if (item.mediaKind === 'audio') return 'AI voice'
    if (item.mediaKind === 'image') return 'AI image'
    return 'AI video'
  }
  if (item.mediaKind === 'image') return 'Image'
  return item.mediaKind === 'audio' ? 'Audio' : 'Video'
}

export function mediaOriginLabel(item: MediaItem): string {
  if (item.isRender) return 'Final export'
  if (item.generated) return 'AI generated'
  return item.mode === 'wasm' ? 'Browser import' : 'Server import'
}
