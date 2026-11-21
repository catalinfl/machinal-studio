import { CanvasSource, Sprite, Texture } from 'pixi.js'
import { LiveScenePlayer, liveSceneFrame, loadLiveScene } from './live-scene'
import { scenePreviewMatrix, scenePreviewGeometry, previewLayerBounds } from './direct-preview'
import type { ClipTransform } from './clip-transform'
import type { DirectLayerAppearance } from './direct-preview'
import type { VideoFit } from './video-fit'

interface PreviewSize {
  width: number
  height: number
}

interface SceneTexture {
  file: string
  host: HTMLDivElement
  canvas: HTMLCanvasElement
  sprite: Sprite
  player?: LiveScenePlayer
  targetTime: number
  frame: number
  captureSize: string
  capturing: boolean
  phase: 'loading' | 'ready' | 'error' | 'disposed'
  direct: boolean
  previewSize?: PreviewSize
}

export class LiveSceneTextures {
  #entries = new Map<string, SceneTexture>()

  constructor(private changed: () => void, private reportError: (message: string) => void, private parent: (key: string) => HTMLElement) {}

  #entry(file: string, time: number, key: string, previewSize?: PreviewSize): SceneTexture {
    let entry = this.#entries.get(key)
    if (entry && entry.file !== file) { this.#release(key); entry = undefined }
    if (!entry) {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none'
      host.setAttribute('aria-hidden', 'true')
      this.parent(key).appendChild(host)
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      entry = { file, host, canvas, sprite: new Sprite(new Texture({ source:new CanvasSource({resource:canvas}) })), targetTime: time, frame: -1, captureSize: '', capturing: false, phase:'loading', direct:false, previewSize }
      this.#entries.set(key, entry)
      void this.#initialize(entry)
    }
    entry.targetTime = time
    if (previewSize) {
      entry.previewSize = previewSize
      entry.player?.setPreviewSize(previewSize.width, previewSize.height)
    }
    return entry
  }

  get(file: string, time: number, key: string, previewSize?: PreviewSize): Sprite | null {
    const entry = this.#entry(file, time, key, previewSize)
    void this.#capture(entry)
    return entry.frame >= 0 ? entry.sprite : null
  }

  prepare(file: string, time: number, key: string, previewSize?: PreviewSize): void {
    this.#entry(file, time, key, previewSize)
  }

  interactionGeometry(key: string, view: PreviewSize, transform: ClipTransform, fit: VideoFit = 'contain') {
    const entry = this.#entries.get(key)
    if (!entry?.player || entry.phase !== 'ready') return null
    const geometry = scenePreviewGeometry(entry.player.source.config, view, transform, fit)
    return { ...geometry, getBounds: () => previewLayerBounds(geometry) }
  }

  present(file: string, time: number, key: string, view: { width: number; height: number; alpha: number; playing: boolean; playbackRate: number; order: number; transform: ClipTransform; fit?: VideoFit } & DirectLayerAppearance): void {
    const entry = this.#entry(file, time, key, view)
    entry.direct = true
    entry.frame = -1
    entry.host.style.cssText = `position:absolute;left:0;top:0;width:${view.width}px;height:${view.height}px;overflow:hidden;pointer-events:none;opacity:${view.alpha};z-index:${view.order};filter:${view.filter || 'none'};mix-blend-mode:${view.blendMode ?? 'normal'}`
    if (entry.player && entry.phase === 'ready') {
      const config = entry.player.source.config
      entry.player.iframe.style.transform = scenePreviewMatrix(config, view, view.transform, view.fit)
      void entry.player.present(time, view.playing, view.playbackRate, view.matrices).catch(cause => {
        if (!this.#isDisposed(entry)) this.reportError(cause instanceof Error ? cause.message : 'Could not display the live scene.')
      })
    }
  }

  hideDirect(activeKeys: Set<string>): void {
    for (const [key, entry] of this.#entries) {
      if (!entry.direct || activeKeys.has(key)) continue
      entry.direct = false
      // Moving an iframe between parents reloads its sandbox; hide it in place.
      entry.host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none'
      void entry.player?.present(entry.targetTime, false).catch(() => {})
    }
  }

  async #initialize(entry: SceneTexture): Promise<void> {
    try {
      const source = await loadLiveScene(entry.file)
      if (this.#isDisposed(entry)) return
      entry.player = new LiveScenePlayer(source, entry.host)
      if (entry.previewSize) entry.player.setPreviewSize(entry.previewSize.width, entry.previewSize.height)
      await entry.player.ready()
      if (this.#isDisposed(entry)) return
      entry.phase = 'ready'
      this.changed()
    } catch (cause) {
      if (!this.#isDisposed(entry)) {
        entry.phase = 'error'
        this.reportError(cause instanceof Error ? cause.message : 'Could not display the live scene.')
      }
    }
  }

  async #capture(entry: SceneTexture): Promise<void> {
    if (!entry.player || entry.phase !== 'ready' || entry.capturing || entry.direct) return
    const frame = liveSceneFrame(entry.player.source, entry.targetTime)
    const captureSize = entry.previewSize ? `${entry.previewSize.width}:${entry.previewSize.height}` : ''
    if (frame === entry.frame && captureSize === entry.captureSize) return
    entry.capturing = true
    let updated = false
    let bitmap: ImageBitmap | undefined
    try {
      bitmap = await entry.player.seek(entry.targetTime, true)
      if (!bitmap) throw new Error('The live scene did not return a preview frame.')
      if (!this.#isDisposed(entry) && !entry.direct) {
        if (entry.canvas.width !== bitmap.width || entry.canvas.height !== bitmap.height) {
          entry.canvas.width = bitmap.width
          entry.canvas.height = bitmap.height
          entry.sprite.texture.destroy(true)
          entry.sprite.texture = new Texture({source:new CanvasSource({resource:entry.canvas})})
        }
        entry.canvas.getContext('2d')?.clearRect(0, 0, bitmap.width, bitmap.height)
        entry.canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
        entry.sprite.texture.source.update()
        entry.frame = frame
        entry.captureSize = captureSize
        updated = true
      }
    } catch (cause) {
      if (!this.#isDisposed(entry)) {
        entry.phase = 'error'
        this.reportError(cause instanceof Error ? cause.message : 'Could not display the live scene.')
      }
    } finally {
      bitmap?.close()
      entry.capturing = false
    }
    if (updated) this.changed()
  }

  retain(keys: Set<string>): void {
    for (const key of this.#entries.keys()) if (!keys.has(key)) this.#release(key)
  }

  #isDisposed(entry: SceneTexture): boolean {
    return entry.phase === 'disposed'
  }

  #release(key: string): void {
    const entry = this.#entries.get(key)
    if (!entry) return
    entry.phase = 'disposed'
    entry.player?.dispose()
    entry.host.remove()
    entry.sprite.destroy({ texture: true, textureSource: true })
    entry.canvas.width = 0
    entry.canvas.height = 0
    this.#entries.delete(key)
  }

  dispose(): void {
    for (const key of this.#entries.keys()) this.#release(key)
  }
}
