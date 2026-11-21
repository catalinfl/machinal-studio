import type { MediaBinSource } from './media-bin'

export function projectMediaReference(source: MediaBinSource): MediaBinSource {
  // The immutable .scene.json owns its bundle and embedded media, not the autosave.
  const { scene: _scene, ...reference } = source
  return { ...reference, scrubBlobUrl: null, previewUrl: null, thumbnailUrl: null }
}
