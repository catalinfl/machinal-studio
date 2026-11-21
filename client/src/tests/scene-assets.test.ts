import { describe, expect, it } from 'vitest'
import { sceneCompositionAsset, sceneMediaBinSource } from '../lib/scene-assets'

const manifest = {
  version: 1, file: '/renderer/private/output.mp4', sha256: 'a'.repeat(64), size: 4096,
  width: 640, height: 360, fps: 30, frames: 90, duration: 3,
  hasAudio: true, transparent: false, codec: 'h264', elapsedNanoseconds: 1,
  scene: { version: 1, sceneId: 'intro', props: {}, seed: 'test', config: { width: 640, height: 360, fps: 30, durationInFrames: 90 } },
}

describe('scene asset application boundary', () => {
  it('binds application identity rather than importing the renderer filesystem path', () => {
    const asset = sceneCompositionAsset(manifest, { id: 'scene-1', file: 'scene_intro.mp4' })
    expect(asset).toMatchObject({ id: 'scene-1', file: 'scene_intro.mp4', version: `sha256:${manifest.sha256}`, kind: 'video', duration: 3, hasAudio: true, local: false })
  })

  it('maps a local scene to the existing media-bin contract', () => {
    expect(sceneMediaBinSource(manifest, { id: 'scene-1', file: 'intro.mp4', local: true }, 'blob:scene')).toMatchObject({ sourceMode: 'wasm', sourceId: 'scene-1', previewUrl: 'blob:scene', isRender: true })
  })

  it('rejects stale or inconsistent manifests', () => {
    expect(() => sceneCompositionAsset({ ...manifest, duration: 4 }, { id: 'scene-1', file: 'intro.mp4' })).toThrow('duration')
    expect(() => sceneCompositionAsset({ ...manifest, width: 1280 }, { id: 'scene-1', file: 'intro.mp4' })).toThrow('dimensions')
    expect(() => sceneCompositionAsset({ ...manifest, sha256: 'bad' }, { id: 'scene-1', file: 'intro.mp4' })).toThrow('SHA-256')
  })
})
