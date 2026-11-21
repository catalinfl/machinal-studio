import { parseRenderedSceneAsset } from '@machinal/scenes/runtime'
import type { CompositionAsset } from './composition-types'
import type { MediaBinSource } from './media-bin'

export interface SceneAssetBinding {
  id: string
  file: string
  local?: boolean
}

export function sceneCompositionAsset(manifest: unknown, binding: SceneAssetBinding): CompositionAsset {
  const asset = parseRenderedSceneAsset(manifest)
  if (!binding.id.trim() || !binding.file.trim()) throw new Error('A scene asset needs an application ID and filename')
  return {
    id: binding.id,
    file: binding.file,
    version: `sha256:${asset.sha256}`,
    kind: 'video',
    duration: asset.duration,
    width: asset.width,
    height: asset.height,
    hasAudio: asset.hasAudio,
    local: binding.local ?? false,
  }
}

export function sceneMediaBinSource(manifest: unknown, binding: SceneAssetBinding, previewUrl: string): MediaBinSource {
  const asset = sceneCompositionAsset(manifest, binding)
  return {
    id: asset.id,
    name: asset.file,
    kind: 'video',
    duration: asset.duration,
    width: asset.width,
    height: asset.height,
    sourceMode: asset.local ? 'wasm' : 'proxy',
    sourceId: asset.id,
    sourceRevision: asset.version,
    previewUrl,
    isRender: true,
  }
}
