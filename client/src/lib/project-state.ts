import { editor } from '../stores/editor.svelte'
import { getMediaBinSources, registerMediaBinSource, type MediaBinSource } from './media-bin'
import { mediaSourceUrl, mediaThumbnailUrl } from './api'
import { restoreLocalSources } from './local-media'
import { isLiveSceneFile } from './live-scene'
import { projectMediaReference } from './project-media'

export interface ProjectState {
  schemaVersion: 1
  preparedCompositionId?: string
  preparedStateFingerprint?: string
  timeline: ReturnType<typeof editor.captureProjectState>
  media: MediaBinSource[]
}

export function captureProjectState(includeTextAssets = false): ProjectState {
  const timeline = editor.captureProjectState(includeTextAssets)
  for (const channel of timeline.channels) {
    for (const clip of channel.clips) clip.scrubBlobUrl = null
  }
  for (const block of timeline.effectBlocks) block.nodeId = null
  const media = getMediaBinSources().map(projectMediaReference)
  return { schemaVersion: 1, timeline, media }
}

export async function restoreProjectState(state: ProjectState, scope: string): Promise<void> {
  if (state?.schemaVersion !== 1 || !Array.isArray(state.timeline?.channels) || !Array.isArray(state.media)) {
    throw new Error('This project could not be read. Your saved data has been kept; try reloading it.')
  }
  const local = state.media.some(source => source.sourceMode === 'wasm') ? await restoreLocalSources(scope) : new Map<string, string>()
  for (const source of state.media) {
    if (isLiveSceneFile(source.name)) {
      registerMediaBinSource({ ...source, previewUrl: null, scrubBlobUrl: null, thumbnailUrl: null })
      continue
    }
    const preview = source.sourceMode === 'wasm' ? local.get(source.sourceId ?? '') : mediaSourceUrl(source.name)
    registerMediaBinSource({ ...source, missing: source.sourceMode === 'wasm' && !preview, previewUrl: preview, scrubBlobUrl: preview,
      thumbnailUrl: source.sourceMode === 'wasm' ? source.kind === 'image' ? preview : null : source.kind === 'audio' ? null : mediaThumbnailUrl(source.name) })
  }
  for (const channel of state.timeline.channels) {
    for (const clip of channel.clips) {
      clip.scrubBlobUrl = isLiveSceneFile(clip.fileName) ? null
        : clip.sourceMode === 'wasm' ? local.get(clip.sourceId ?? '') ?? null : mediaSourceUrl(clip.fileName)
    }
  }
  editor.restoreProjectState(state.timeline)
}
