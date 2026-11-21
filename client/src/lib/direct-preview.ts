import type { Sprite } from 'pixi.js'
import type { Channel, Clip, EffectBlock } from '../stores/editor.svelte'
import type { ClipTransform } from './clip-transform'
import { getActivePixiEffectsForClip, planPixiEffectStack } from './effects-pixi'
import { isLiveSceneFile } from './live-scene'
import { canPresentDirectEffects } from './direct-preview-effects'
import { videoFitScale, type VideoFit } from './video-fit'

interface PreviewSize {
  width: number
  height: number
}

export interface LayerGeometry {
  x: number
  y: number
  scale: { x: number; y: number }
  anchor: { x: number; y: number }
  rotation: number
  skew: { x: number; y: number }
  texture: PreviewSize
}

export interface DirectLayerAppearance {
  filter?: string
  matrices?: number[][]
  blendMode?: 'normal' | 'plus-lighter'
}

export function canPresentDirectPreview(
  entries: Array<{ channel: Channel; clip: Clip }>,
  effects: EffectBlock[],
  time: number,
  transitionBetween: (left: Clip, right: Clip) => string = () => 'cross-dissolve',
): boolean {
  if (!entries.some(({ clip }) => isLiveSceneFile(clip.fileName))) return false
  const channels = new Map<string, Clip[]>()
  for (const { channel, clip } of entries) {
    const clips = channels.get(channel.id) ?? []
    clips.push(clip)
    channels.set(channel.id, clips)
    if (clips.length > 2 || (clips.length === 2 && transitionBetween(clips[0], clip) !== 'cross-dissolve')) return false
    const active = getActivePixiEffectsForClip(channel.id, clip.id, effects, time, clip.start)
    if (!canPresentDirectEffects(planPixiEffectStack(active, time, { w: 1920, h: 1080 }))) return false
  }
  return true
}

export function previewLayerMatrix(layer: LayerGeometry): string {
  const a = Math.cos(layer.rotation + layer.skew.y) * layer.scale.x
  const b = Math.sin(layer.rotation + layer.skew.y) * layer.scale.x
  const c = -Math.sin(layer.rotation - layer.skew.x) * layer.scale.y
  const d = Math.cos(layer.rotation - layer.skew.x) * layer.scale.y
  const anchorX = layer.anchor.x * layer.texture.width
  const anchorY = layer.anchor.y * layer.texture.height
  return `matrix(${a},${b},${c},${d},${layer.x - a * anchorX - c * anchorY},${layer.y - b * anchorX - d * anchorY})`
}

export function scenePreviewGeometry(source: PreviewSize, view: PreviewSize, transform: ClipTransform, videoFit: VideoFit = 'contain'): LayerGeometry {
  const fit = videoFitScale(source.width, source.height, view.width, view.height, videoFit)
  return {
    x: view.width / 2 + transform.positionX * view.width / 100,
    y: view.height / 2 + transform.positionY * view.height / 100,
    scale: { x: fit * transform.zoomX * (transform.flipH ? -1 : 1), y: fit * transform.zoomY * (transform.flipV ? -1 : 1) },
    anchor: { x: transform.anchorX, y: transform.anchorY },
    rotation: transform.rotation * Math.PI / 180,
    skew: { x: transform.yaw * Math.PI / 180 * 0.55, y: transform.pitch * Math.PI / 180 * 0.55 },
    texture: source,
  }
}

export function scenePreviewMatrix(source: PreviewSize, view: PreviewSize, transform: ClipTransform, fit: VideoFit = 'contain'): string {
  return previewLayerMatrix(scenePreviewGeometry(source, view, transform, fit))
}

export function previewLayerBounds(layer: LayerGeometry) {
  const a = Math.cos(layer.rotation + layer.skew.y) * layer.scale.x
  const b = Math.sin(layer.rotation + layer.skew.y) * layer.scale.x
  const c = -Math.sin(layer.rotation - layer.skew.x) * layer.scale.y
  const d = Math.cos(layer.rotation - layer.skew.x) * layer.scale.y
  const points = [ [0, 0], [layer.texture.width, 0], [0, layer.texture.height], [layer.texture.width, layer.texture.height] ]
    .map(([x, y]) => {
      const dx = x - layer.anchor.x * layer.texture.width
      const dy = y - layer.anchor.y * layer.texture.height
      return { x: layer.x + a * dx + c * dy, y: layer.y + b * dx + d * dy }
    })
  const x = Math.min(...points.map(point => point.x))
  const y = Math.min(...points.map(point => point.y))
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y }
}

export class DirectPreviewLayers {
  #host?: HTMLDivElement
  #media = new Set<HTMLElement>()
  #active = new Set<HTMLElement>()
  #channels = new Map<string, HTMLDivElement>()

  constructor(private parent: () => HTMLElement) {}

  get host(): HTMLDivElement {
    if (!this.#host) {
      this.#host = document.createElement('div')
      this.#host.dataset.directPreview = ''
      this.#host.setAttribute('aria-hidden', 'true')
      this.#host.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);overflow:hidden;pointer-events:none;background:#000;z-index:0'
      this.parent().appendChild(this.#host)
    }
    return this.#host
  }

  begin(view: PreviewSize): void {
    this.host.style.width = `${view.width}px`
    this.host.style.height = `${view.height}px`
    this.#active.clear()
  }

  channelHost(id: string, order?: number): HTMLDivElement {
    let host = this.#channels.get(id)
    if (!host) {
      host = document.createElement('div')
      host.dataset.directPreviewChannel = id
      host.style.cssText = 'position:absolute;inset:0;isolation:isolate;pointer-events:none'
      this.host.appendChild(host)
      this.#channels.set(id, host)
    }
    if (order !== undefined) host.style.zIndex = String(order)
    return host
  }

  present(element: HTMLCanvasElement | HTMLVideoElement, sprite: Sprite, order: number, channelId?: string, appearance: DirectLayerAppearance = {}): void {
    const host = channelId ? this.channelHost(channelId, order) : this.host
    if (element.parentElement !== host) host.appendChild(element)
    element.dataset.directPreviewLayer = element.tagName === 'CANVAS' ? 'image' : 'video'
    element.setAttribute('aria-hidden', 'true')
    element.style.cssText = `position:absolute;left:0;top:0;display:block;width:${sprite.texture.width}px;height:${sprite.texture.height}px;transform-origin:0 0;transform:${previewLayerMatrix(sprite)};opacity:${sprite.alpha};z-index:${order};pointer-events:none;box-shadow:none`
    element.style.filter = appearance.filter ?? ''
    element.style.mixBlendMode = appearance.blendMode ?? 'normal'
    this.#media.add(element)
    this.#active.add(element)
  }

  end(): void {
    for (const element of this.#media) {
      if (this.#active.has(element)) continue
      element.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;display:none'
      delete element.dataset.directPreviewLayer
      this.#media.delete(element)
    }
  }

  dispose(): void {
    this.#active.clear()
    this.end()
    this.#host?.remove()
    this.#channels.clear()
  }
}
