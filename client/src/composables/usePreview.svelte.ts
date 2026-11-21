import 'pixi.js/unsafe-eval'
import { onMount, onDestroy } from 'svelte'
import { Application, Sprite, Texture, Graphics, Rectangle } from 'pixi.js'
import {
  aspectLabel,
  clipEnd,
  clipPlaybackRate,
  clipSourceTimeAt,
  editor,
  PROJECT_ASPECT_ORDER,
  textDesignSize,
  type Channel,
  type Clip,
  type MediaKind,
  type TextItem,
} from '../stores/editor.svelte'
import { render } from '../stores/render.svelte'
import { activeCaptionWordState, layoutTextItem, rasterizeTextCanvas, textAnchorRatio, textAnimationOffset, textAnimationYOffset, textFontsReady, textItemSignature } from '../lib/text-render'
import { clipTransform, clipTransformAt, normalizeClipTransform, type ClipTransform, type ClipTransformKeyframe } from '../lib/clip-transform'
import { clipAlphaAt } from '../lib/clip-compositing'
import { addPointerDragListeners } from '../lib/pointer-drag'
import { getMediaBinSource } from '../lib/media-bin'
import {
  applyPixiPerfBudget,
  getActivePixiEffectsForClip,
  planPixiEffectStack,
  planPixiTransition,
  pixiHistorySignature,
  type PixiFrameSize,
} from '../lib/effects-pixi'
import { PixiHistory } from '../lib/pixi-history'
import type { Filter } from 'pixi.js'
import { isLiveSceneFile } from '../lib/live-scene'
import { LiveSceneTextures } from '../lib/live-scene-textures'
import { indexPreviewMedia, previewClipsInRange } from '../lib/preview-media'
import { canPresentDirectPreview, DirectPreviewLayers, type LayerGeometry } from '../lib/direct-preview'
import { DirectPreviewEffects, directEffectMatrices } from '../lib/direct-preview-effects'
import { PixiPreviewFilters } from '../lib/pixi-preview-filters'
import { PreviewPlayback } from '../lib/preview-playback'
import { videoFitScale } from '../lib/video-fit'

export interface PreviewProps {
  readonly onOpenClipInspector?: () => void
}

interface ActiveMedia {
  blobUrl: string | null
  targetTime: number
  playbackRate: number
  cacheKey: string
  mediaKind?: MediaKind
}

interface VisualMediaLayer extends ActiveMedia {
  alpha: number
}

interface InteractiveImageLayer {
  clipId: string
  channelId: string
  cacheKey: string
  sprite: LayerGeometry & { getBounds: () => { x: number; y: number; width: number; height: number } }
  hitCanvas?: HTMLCanvasElement
}

interface ImageDrag {
  id: string
  pointerId: number
  clientX: number
  clientY: number
  transform: ClipTransform
  keyframes: ClipTransformKeyframe[]
}

interface ImageSelectionRect {
  left: number
  top: number
  width: number
  height: number
}

interface ImageResize {
  id: string
  pointerId: number
  centerX: number
  centerY: number
  startDistance: number
  transform: ClipTransform
  keyframes: ClipTransformKeyframe[]
}

type ImageInteraction =
  | { kind: 'idle' }
  | { kind: 'dragging'; drag: ImageDrag }
  | { kind: 'resizing'; resize: ImageResize }

const MAX_IMAGE_PREVIEW_EDGE = 2048
// How far ahead of the playhead the incoming clip's element is seeked so a
// hard cut between two different source windows never waits for an async
// seek on the exact cut frame. Covers the first playback right after an AI
// cut, when the second element is still cold (second viewing is already warm).
const VIDEO_PREWARM_SEC = 0.75
const VIDEO_PREWARM_EPS = 0.08
const MEDIA_PRELOAD_SEC = 2
const LOW_POWER_FRAME_INTERVAL_MS = 1000 / 30

export function usePreview(props: PreviewProps) {
  let stageEl = $state<HTMLDivElement | undefined>(undefined)
  let app: Application | null = null
  let rafId = 0
  let resizeObserver: ResizeObserver | null = null
  let previewDestroyed = false
  let sceneError = $state('')
  let textError = $state('')
  const directLayers = new DirectPreviewLayers(() => stageEl ?? document.body)
  const directEffects = new DirectPreviewEffects(() => stageEl ?? document.body)
  const previewFilters = new PixiPreviewFilters()

  const sceneTextures = new LiveSceneTextures(
    () => { if (!previewDestroyed) renderActiveClips() },
    message => { sceneError = message },
    key => directLayers.channelHost(editor.getClipById(key.slice('clip:'.length))?.channel.id ?? key),
  )

  const videoCache = new Map<string, { element: HTMLVideoElement; blobUrl: string }>()
  const imageCache = new Map<string, { element: HTMLImageElement | null; blobUrl: string }>()
  const audioVoiceCache = new Map<string, { element: HTMLVideoElement; blobUrl: string }>()
  const canvasCache = new Map<string, HTMLCanvasElement>()
  const spriteCache = new Map<string, Sprite>()
  const effectHistories = new Map<string, { signature: string; history: PixiHistory }>()
  const imageSourceSizes = new WeakMap<Sprite, PixiFrameSize>()
  const textSpriteCache = new Map<string, { signature: string; sprite: Sprite }>()
  const textLayoutCache = new Map<string, { signature: string; item: TextItem }>()

  let textDrag: { id: string; pointerId: number; clientX: number; clientY: number; x: number; y: number } | null = null
  let lastImageTap: { time: number; clipId: string } = { time: 0, clipId: '' }
  let stopTextDrag: (() => void) | null = null
  let stopImageDrag: (() => void) | null = null
  let stopImageResize: (() => void) | null = null
  let interactiveImageLayers: InteractiveImageLayer[] = []
  let imageSelectionRect = $state<ImageSelectionRect | null>(null)
  const mediaIndex = $derived(indexPreviewMedia(editor.channels))
  let activeClips = $derived(previewClipsInRange(mediaIndex, editor.currentTime))
  const nearbyClips = $derived(previewClipsInRange(mediaIndex, editor.currentTime, editor.currentTime + MEDIA_PRELOAD_SEC))
  let selectedImage = $derived(activeClips.find(({ channel, clip }) => (
    channel.type === 'video'
    && editor.selectedClipIds.includes(clip.id)
  )) ?? null)
  let selectedImageActive = $derived(selectedImage !== null)
  let selectedImageZoom = $derived(selectedImage
    ? clipTransformAt(selectedImage.clip, editor.currentTime - selectedImage.clip.start).zoomX
    : 1)
  let selectedImageLocked = $derived(selectedImage?.channel.locked ?? false)
  const selectedMediaLabel = $derived(selectedImage && isLiveSceneFile(selectedImage.clip.fileName) ? 'scene' : selectedImage?.clip.mediaKind === 'image' ? 'image' : 'video')
  let imageInteraction = $state.raw<ImageInteraction>({ kind: 'idle' })
  const draggingImage = $derived(imageInteraction.kind === 'dragging')
  const resizingImage = $derived(imageInteraction.kind === 'resizing')
  let muted = $state(false)
  let volume = $state(100)
  let pixiFps = $state(60)
  let lastTickMs = 0
  const device = navigator as Navigator & { deviceMemory?: number }
  const lowPowerPreview = (device.deviceMemory !== undefined && device.deviceMemory <= 4) || (device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 4)
  let lastPresentedMs = 0
  // Last successfully drawn video textures, held for a single frame when the
  // incoming clip's element is still seeking (first preview after a cut).
  // Holding one frozen frame hides the 1-black-frame flash; showing the new
  // (still black/seeking) texture would be more visible.
  let lastVideoHoldKeys: string[] = []

  const playback = new PreviewPlayback(() => ({ muted, volume }))

  function continuousMediaCacheKey(clip: Clip): string {
    return mediaIndex.cacheKeys.get(clip.id) ?? `clip:${clip.id}`
  }

  function previewSize(): { width: number; height: number } {
    const preset = editor.projectResolution
    const stageW = stageEl?.clientWidth || 640
    const stageH = stageEl?.clientHeight || 360
    const aspect = preset.w / preset.h
    let w = stageW
    let h = w / aspect
    if (h > stageH) { h = stageH; w = h * aspect }
    return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }
  }

  function resizeApp() {
    const renderer = app?.renderer
    if (!renderer || !stageEl) return
    const { width, height } = previewSize()
    renderer.resize(width, height)
  }

  $effect(() => {
    editor.resolution
    editor.effectiveProjectAspect
    if (app) resizeApp()
  })

  $effect(() => {
    for (const { channel: ch, clip } of nearbyClips) {
      if (ch.type === 'video' && isLiveSceneFile(clip.fileName)) continue
      if (!clip.scrubBlobUrl) continue
      const cacheKey = continuousMediaCacheKey(clip)
      if (ch.type === 'audio') getOrCreateAudioVoice(cacheKey, clip.scrubBlobUrl)
      else {
        try { getOrCreateSprite(clip.scrubBlobUrl, cacheKey, clip.mediaKind ?? 'video') } catch { /* preload is best-effort */ }
      }
    }
    releaseUnusedVisualMedia()
  })

  function getOrCreateVideo(blobUrl: string, cacheKey = blobUrl): HTMLVideoElement | null {
    const cached = videoCache.get(cacheKey)
    if (cached?.blobUrl === blobUrl) return cached.element
    if (cached) releaseVideo(cacheKey)
    const v = document.createElement('video')
    v.playsInline = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    v.volume = 1
    v.muted = false
    v.style.position = 'absolute'
    v.style.left = '-9999px'
    v.style.top = '0'
    v.style.width = '1px'
    v.style.height = '1px'
    v.style.opacity = '0'
    v.style.pointerEvents = 'none'
    v.src = blobUrl
    document.body.appendChild(v)
    videoCache.set(cacheKey, { element: v, blobUrl })

    if (v.readyState < HTMLMediaElement.HAVE_METADATA) {
      v.addEventListener('loadedmetadata', () => renderActiveClips(), { once: true })
      v.addEventListener('loadeddata', () => renderActiveClips(), { once: true })
      v.addEventListener('canplay', () => renderActiveClips(), { once: true })
      v.addEventListener('seeked', () => renderActiveClips())
      v.addEventListener('error', () => {
        if (videoCache.get(cacheKey)?.element !== v) return
        console.error('[preview] video failed to load', blobUrl, {
          code: v.error?.code,
          message: v.error?.message,
          networkState: v.networkState,
          readyState: v.readyState,
        })
      }, { once: true })
    }
    return v
  }

  function releaseVideo(cacheKey: string) {
    const cached = videoCache.get(cacheKey)
    if (!cached) return
    videoCache.delete(cacheKey)
    const voiceKey = `video:${cacheKey}`
    playback.release(voiceKey, cached.element)
    try { cached.element.pause() } catch {}
    cached.element.removeAttribute('src')
    try { cached.element.load() } catch {}
    cached.element.remove()
    destroyOwnedSprite(spriteCache.get(cacheKey))
    spriteCache.delete(cacheKey)
    releaseCanvas(cacheKey)
  }

  function getOrCreateAudioVoice(voiceKey: string, blobUrl: string): HTMLVideoElement {
    const cached = audioVoiceCache.get(voiceKey)
    if (cached) {
      if (cached.blobUrl !== blobUrl) {
        releaseAudioVoice(voiceKey)
        return getOrCreateAudioVoice(voiceKey, blobUrl)
      }
      playback.register(voiceKey, cached.element, true)
      return cached.element
    }
    const element = document.createElement('video')
    element.playsInline = true
    element.preload = 'auto'
    element.crossOrigin = 'anonymous'
    element.volume = 1
    element.muted = false
    element.style.position = 'absolute'
    element.style.left = '-9999px'
    element.style.top = '0'
    element.style.width = '1px'
    element.style.height = '1px'
    element.style.opacity = '0'
    element.style.pointerEvents = 'none'
    element.dataset.previewAudioVoice = voiceKey
    element.src = blobUrl
    document.body.appendChild(element)
    audioVoiceCache.set(voiceKey, { element, blobUrl })
    playback.register(voiceKey, element, true)
    return element
  }

  function releaseAudioVoice(voiceKey: string) {
    const cached = audioVoiceCache.get(voiceKey)
    if (!cached) return
    playback.release(voiceKey, cached.element)
    cached.element.removeAttribute('src')
    try { cached.element.load() } catch {}
    cached.element.remove()
    audioVoiceCache.delete(voiceKey)
  }

  function getOrCreateImageSprite(blobUrl: string, cacheKey: string): Sprite | null {
    let cached = imageCache.get(cacheKey)
    if (cached && cached.blobUrl !== blobUrl) {
      releaseImage(cacheKey)
      cached = undefined
    }
    const existingSprite = spriteCache.get(cacheKey)
    if (existingSprite && cached?.blobUrl === blobUrl) return existingSprite
    let image = cached?.element
    if (!image) {
      image = new Image()
      image.decoding = 'async'
      // Same as video elements below: anonymous CORS keeps the preview
      // canvas readable. Without it any remote (server) image taints the
      // canvas and Pixi's texImage2D upload throws SecurityError, which
      // used to kill the whole preview RAF loop.
      try { image.crossOrigin = 'anonymous' } catch { /* test doubles may not support it */ }
      const entry = { element: image, blobUrl }
      image.onload = () => {
        if (imageCache.get(cacheKey) === entry) renderActiveClips()
      }
      image.onerror = () => {
        if (imageCache.get(cacheKey) === entry) console.error('[preview] image failed to load', blobUrl)
      }
      imageCache.set(cacheKey, entry)
      cached = entry
      try { image.src = blobUrl } catch { return null }
    }
    if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    const previewScale = Math.min(1, MAX_IMAGE_PREVIEW_EDGE / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * previewScale))
    const height = Math.max(1, Math.round(sourceHeight * previewScale))
    const canvas = getOrCreateCanvas(cacheKey, width, height)
    const context = canvas.getContext('2d')
    if (!context) return null
    try {
      context.drawImage(image, 0, 0, width, height)
      // Probe readability before handing the canvas to WebGL: a tainted
      // canvas throws here (synchronously) instead of later inside
      // texImage2D, where it would break the Pixi render loop.
      if (typeof context.getImageData === 'function') context.getImageData(0, 0, 1, 1)
    } catch {
      return null
    }
    let sprite: Sprite
    try {
      sprite = new Sprite(Texture.from(canvas))
    } catch {
      return null
    }
    spriteCache.set(cacheKey, sprite)
    imageSourceSizes.set(sprite, { w: sourceWidth, h: sourceHeight })
    image.onload = null
    image.onerror = null
    try { image.src = '' } catch { /* ignore */ }
    if (cached?.element === image) cached.element = null
    return sprite
  }

  function releaseImage(cacheKey: string) {
    const cached = imageCache.get(cacheKey)
    if (!cached) return
    imageCache.delete(cacheKey)
    if (cached.element) {
      cached.element.onload = null
      cached.element.onerror = null
      try { cached.element.src = '' } catch { /* ignore */ }
    }
    destroyOwnedSprite(spriteCache.get(cacheKey))
    spriteCache.delete(cacheKey)
    releaseCanvas(cacheKey)
  }

  function destroyOwnedSprite(sprite: Sprite | undefined) {
    sprite?.destroy({ texture: true, textureSource: true })
  }

  function releaseCanvas(cacheKey: string) {
    const canvas = canvasCache.get(cacheKey)
    if (!canvas) return
    canvasCache.delete(cacheKey)
    canvas.width = 0
    canvas.height = 0
    canvas.remove()
  }

  function getOrCreateCanvas(cacheKey: string, w: number, h: number): HTMLCanvasElement {
    let c = canvasCache.get(cacheKey)
    if (c) {
      if (c.width !== w) c.width = w
      if (c.height !== h) c.height = h
      return c
    }
    c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.style.display = 'none'
    document.body.appendChild(c)
    canvasCache.set(cacheKey, c)
    return c
  }

  function getOrCreateSprite(blobUrl: string, cacheKey = blobUrl, mediaKind: MediaKind = 'video'): Sprite | null {
    if (mediaKind === 'image') return getOrCreateImageSprite(blobUrl, cacheKey)
    const v = getOrCreateVideo(blobUrl, cacheKey)
    let sp = spriteCache.get(cacheKey)
    if (sp) return sp
    if (!v || v.readyState < HTMLMediaElement.HAVE_METADATA) return null
    const vw = v.videoWidth
    const vh = v.videoHeight
    if (!vw || !vh) return null
    const c = getOrCreateCanvas(cacheKey, vw, vh)
    const ctx = c.getContext('2d')
    if (!ctx) return null
    try { ctx.drawImage(v, 0, 0, vw, vh) } catch { /* frame not decoded yet or tainted */ }
    try {
      sp = new Sprite(Texture.from(c))
    } catch {
      return null
    }
    spriteCache.set(cacheKey, sp)
    return sp
  }

  function fitSprite(sp: Sprite) {
    if (!app) return
    const tw = sp.texture.width
    const th = sp.texture.height
    if (!tw || !th) return
    const scale = videoFitScale(tw, th, app.screen.width, app.screen.height, editor.videoFit)
    sp.scale.set(scale)
    sp.anchor.set(0.5)
    sp.x = app.screen.width / 2
    sp.y = app.screen.height / 2
    sp.filterArea = undefined
  }

  function applyClipTransform(sp: Sprite, clip: Clip, elapsed: number) {
    if (!app) return
    const transform = clipTransformAt(clip, elapsed)
    const tw = sp.texture.width
    const th = sp.texture.height
    if (!tw || !th) return
    const fit = videoFitScale(tw, th, app.screen.width, app.screen.height, editor.videoFit)
    sp.anchor.set(transform.anchorX, transform.anchorY)
    sp.scale.set(
      fit * transform.zoomX * (transform.flipH ? -1 : 1),
      fit * transform.zoomY * (transform.flipV ? -1 : 1),
    )
    sp.x = app.screen.width / 2 + transform.positionX * app.screen.width / 100
    sp.y = app.screen.height / 2 + transform.positionY * app.screen.height / 100
    sp.rotation = transform.rotation * Math.PI / 180
    sp.skew?.set?.(transform.yaw * Math.PI / 180 * 0.55, transform.pitch * Math.PI / 180 * 0.55)
  }

  function getOrCreateTextSprite(item: TextItem): Sprite | null {
    if (!app) return null
    if (!textFontsReady(item)) return null
    const layoutSignature = `${textItemSignature(item, 1)}|${item.x}|${item.y}|${item.start}|${item.duration}|${item.animation}|${item.animationDuration}|${JSON.stringify(item.words)}|${editor.effectiveProjectAspect}`
    let layout = textLayoutCache.get(item.id)
    if (layout?.signature !== layoutSignature) {
      try {
        layout = { signature: layoutSignature, item: layoutTextItem(item, editor.effectiveProjectAspect) }
      } catch (cause) {
        textError = cause instanceof Error ? cause.message : 'Text preview is unavailable. Review the text style; saved captions have not been changed.'
        return null
      }
      textLayoutCache.set(item.id, layout)
    }
    item = layout!.item
    const design = textDesignSize(editor.effectiveProjectAspect)
    const scale = app.screen.height / design.h
    const wordState = activeCaptionWordState(item, editor.currentTime)
    const signature = `${layoutSignature}|${textItemSignature(item, scale, wordState.index, wordState.progress)}`
    const cached = textSpriteCache.get(item.id)
    let sprite = cached?.sprite
    if (!sprite || cached?.signature !== signature) {
      if (sprite && 'destroy' in sprite) destroyOwnedSprite(sprite)
      const canvas = rasterizeTextCanvas(item, scale, { activeWordIndex: wordState.index, activeWordProgress: wordState.progress })
      sprite = new Sprite(Texture.from(canvas))
      sprite.anchor.set(textAnchorRatio(item), 0.5)
      textSpriteCache.set(item.id, { signature, sprite })
    }
    const baseX = item.x * app.screen.width / design.w
    const topLeftX = baseX - sprite.texture.width * textAnchorRatio(item)
    sprite.x = baseX + textAnimationOffset(item, editor.currentTime, app.screen.width, sprite.texture.width, topLeftX)
    sprite.y = item.y * app.screen.height / design.h + textAnimationYOffset(item, editor.currentTime, app.screen.height)
    sprite.alpha = 1
    return sprite
  }

  function eventScreenPoint(event: PointerEvent): { x: number; y: number } | null {
    if (!app) return null
    const canvas = app.canvas as HTMLCanvasElement
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    return {
      x: (event.clientX - bounds.left) * app.screen.width / bounds.width,
      y: (event.clientY - bounds.top) * app.screen.height / bounds.height,
    }
  }

  function imageLayerContainsPoint(layer: InteractiveImageLayer, point: { x: number; y: number }): boolean {
    const sp = layer.sprite
    const width = sp.texture.width
    const height = sp.texture.height
    const scaleX = sp.scale.x
    const scaleY = sp.scale.y
    if (!width || !height || !scaleX || !scaleY) return false
    const rotation = sp.rotation || 0
    const skewX = sp.skew?.x || 0
    const skewY = sp.skew?.y || 0
    const a = Math.cos(rotation + skewY) * scaleX
    const b = Math.sin(rotation + skewY) * scaleX
    const c = -Math.sin(rotation - skewX) * scaleY
    const d = Math.cos(rotation - skewX) * scaleY
    const determinant = a * d - b * c
    if (Math.abs(determinant) < 1e-9) return false
    const dx = point.x - sp.x
    const dy = point.y - sp.y
    const localX = (d * dx - c * dy) / determinant + sp.anchor.x * width
    const localY = (-b * dx + a * dy) / determinant + sp.anchor.y * height
    if (localX < 0 || localX >= width || localY < 0 || localY >= height) return false
    const canvas = layer.hitCanvas
    const context = canvas?.getContext('2d')
    if (!context || typeof context.getImageData !== 'function') return true
    try { return context.getImageData(Math.floor(localX), Math.floor(localY), 1, 1).data[3] > 8 } catch { return true }
  }

  function imageLayerAt(point: { x: number; y: number }): InteractiveImageLayer | null {
    const topFirst = [...interactiveImageLayers].reverse()
    const selected = topFirst.find((layer) => editor.selectedClipIds.includes(layer.clipId) && imageLayerContainsPoint(layer, point))
    return selected ?? topFirst.find((layer) => imageLayerContainsPoint(layer, point)) ?? null
  }

  function sameSelectionRect(left: ImageSelectionRect | null, right: ImageSelectionRect | null): boolean {
    if (!left || !right) return left === right
    return Math.abs(left.left - right.left) < 0.1
      && Math.abs(left.top - right.top) < 0.1
      && Math.abs(left.width - right.width) < 0.1
      && Math.abs(left.height - right.height) < 0.1
  }

  function syncImageSelectionRect() {
    if (!app || !stageEl) return
    const layer = [...interactiveImageLayers].reverse().find(({ clipId }) => editor.selectedClipIds.includes(clipId))
    if (!layer || typeof layer.sprite.getBounds !== 'function') {
      if (imageSelectionRect) imageSelectionRect = null
      return
    }
    const bounds = layer.sprite.getBounds()
    const canvasBounds = (app.canvas as HTMLCanvasElement).getBoundingClientRect()
    const stageBounds = stageEl.getBoundingClientRect()
    if (canvasBounds.width <= 0 || canvasBounds.height <= 0) return
    const next = {
      left: canvasBounds.left - stageBounds.left + bounds.x * canvasBounds.width / app.screen.width,
      top: canvasBounds.top - stageBounds.top + bounds.y * canvasBounds.height / app.screen.height,
      width: bounds.width * canvasBounds.width / app.screen.width,
      height: bounds.height * canvasBounds.height / app.screen.height,
    }
    if (!sameSelectionRect(imageSelectionRect, next)) imageSelectionRect = next
  }

  function onStagePointerDown(event: PointerEvent) {
    if (!app || event.button !== 0 || textDrag || imageInteraction.kind !== 'idle') return
    const point = eventScreenPoint(event)
    if (!point) return
    const activeItems = editor.getActiveTextItemsAt(editor.currentTime)
    for (let index = activeItems.length - 1; index >= 0; index--) {
      const item = activeItems[index]
      const sprite = textSpriteCache.get(item.id)?.sprite
      if (!sprite) continue
      const resource = sprite.texture.source.resource
      const hitCanvas = resource instanceof HTMLCanvasElement ? resource : undefined
      if (!imageLayerContainsPoint({ clipId: item.id, channelId: '', cacheKey: '', sprite, hitCanvas }, point)) continue
      event.preventDefault()
      editor.selectTextItem(item.id)
      editor.beginHistory()
      textDrag = { id: item.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: item.x, y: item.y }
      stageEl?.setPointerCapture?.(event.pointerId)
      stopTextDrag?.()
      stopTextDrag = addPointerDragListeners({ onMove: onTextPointerMove, onEnd: onTextPointerUp })
      return
    }
    const layer = imageLayerAt(point)
    if (!layer) return
    const found = editor.getClipById(layer.clipId)
    if (!found || found.channel.id !== layer.channelId) return
    event.preventDefault()
    editor.selectClip(layer.clipId)
    // Single tap only selects so the layer can be dragged freely; a second
    // tap opens the inspector (double-tap works for mouse and touch alike).
    const now = event.timeStamp
    const isDoubleTap = layer.clipId === lastImageTap.clipId && now - lastImageTap.time < 400
    lastImageTap = { time: now, clipId: layer.clipId }
    if (isDoubleTap) props.onOpenClipInspector?.()
    syncImageSelectionRect()
    if (found.channel.locked) return
    editor.beginHistory()
    imageInteraction = { kind: 'dragging', drag: {
      id: layer.clipId,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      transform: { ...clipTransform(found.clip) },
      keyframes: (found.clip.transformKeyframes ?? []).map((keyframe) => ({ time: keyframe.time, transform: { ...keyframe.transform } })),
    } }
    stageEl?.setPointerCapture?.(event.pointerId)
    stopImageDrag?.()
    stopImageDrag = addPointerDragListeners({ onMove: onImagePointerMove, onEnd: onImagePointerUp })
  }

  function onImagePointerMove(event: PointerEvent) {
    if (imageInteraction.kind !== 'dragging' || !app) return
    const drag = imageInteraction.drag
    if (event.pointerId !== drag.pointerId) return
    const bounds = (app.canvas as HTMLCanvasElement).getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const positionX = (event.clientX - drag.clientX) * 100 / bounds.width
    const positionY = (event.clientY - drag.clientY) * 100 / bounds.height
    const movedTransform = (transform: ClipTransform) => normalizeClipTransform({ ...transform, positionX: transform.positionX + positionX, positionY: transform.positionY + positionY })
    if (drag.keyframes.length > 0) {
      editor.setClipTransformKeyframes(drag.id, movedTransform(drag.transform), drag.keyframes.map((keyframe) => ({ time: keyframe.time, transform: movedTransform(keyframe.transform) })))
    } else {
      const next = movedTransform(drag.transform)
      editor.setClipTransform(drag.id, { positionX: next.positionX, positionY: next.positionY })
    }
    renderActiveClips()
  }

  function onImagePointerUp(event: PointerEvent) {
    if (imageInteraction.kind !== 'dragging' || event.pointerId !== imageInteraction.drag.pointerId) return
    imageInteraction = { kind: 'idle' }
    stopImageDrag?.()
    stopImageDrag = null
    editor.endHistory()
  }

  function scaleImageTransforms(id: string, ratio: number, transform: ClipTransform, keyframes: ClipTransformKeyframe[]) {
    const scaledTransform = (value: ClipTransform) => normalizeClipTransform({ ...value, zoomX: value.zoomX * ratio, zoomY: value.zoomY * ratio })
    if (keyframes.length > 0) {
      editor.setClipTransformKeyframes(id, scaledTransform(transform), keyframes.map((keyframe) => ({ time: keyframe.time, transform: scaledTransform(keyframe.transform) })))
    } else {
      const next = scaledTransform(transform)
      editor.setClipTransform(id, { zoomX: next.zoomX, zoomY: next.zoomY })
    }
    renderActiveClips()
  }

  function startImageResize(event: PointerEvent) {
    if (!imageSelectionRect || event.button !== 0 || textDrag || imageInteraction.kind !== 'idle') return
    const layer = [...interactiveImageLayers].reverse().find(({ clipId }) => editor.selectedClipIds.includes(clipId))
    if (!layer) return
    const found = editor.getClipById(layer.clipId)
    if (!found || found.channel.locked || !stageEl) return
    event.preventDefault()
    event.stopPropagation()
    const stageBounds = stageEl.getBoundingClientRect()
    const centerX = stageBounds.left + imageSelectionRect.left + imageSelectionRect.width / 2
    const centerY = stageBounds.top + imageSelectionRect.top + imageSelectionRect.height / 2
    editor.beginHistory()
    imageInteraction = { kind: 'resizing', resize: {
      id: layer.clipId,
      pointerId: event.pointerId,
      centerX,
      centerY,
      startDistance: Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
      transform: { ...clipTransform(found.clip) },
      keyframes: (found.clip.transformKeyframes ?? []).map((keyframe) => ({ time: keyframe.time, transform: { ...keyframe.transform } })),
    } }
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    stopImageResize?.()
    stopImageResize = addPointerDragListeners({ onMove: onImageResizePointerMove, onEnd: onImageResizePointerUp })
  }

  function onImageResizePointerMove(event: PointerEvent) {
    if (imageInteraction.kind !== 'resizing') return
    const resize = imageInteraction.resize
    if (event.pointerId !== resize.pointerId) return
    const distance = Math.hypot(event.clientX - resize.centerX, event.clientY - resize.centerY)
    scaleImageTransforms(resize.id, distance / resize.startDistance, resize.transform, resize.keyframes)
  }

  function onImageResizePointerUp(event: PointerEvent) {
    if (imageInteraction.kind !== 'resizing' || event.pointerId !== imageInteraction.resize.pointerId) return
    imageInteraction = { kind: 'idle' }
    stopImageResize?.()
    stopImageResize = null
    editor.endHistory()
  }

  function resizeImageWithKeyboard(event: KeyboardEvent) {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    const layer = [...interactiveImageLayers].reverse().find(({ clipId }) => editor.selectedClipIds.includes(clipId))
    if (!layer) return
    const found = editor.getClipById(layer.clipId)
    if (!found || found.channel.locked) return
    event.preventDefault()
    event.stopPropagation()
    const ratio = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1.05 : 1 / 1.05
    const transform = { ...clipTransform(found.clip) }
    const keyframes = (found.clip.transformKeyframes ?? []).map((keyframe) => ({ time: keyframe.time, transform: { ...keyframe.transform } }))
    editor.beginHistory()
    scaleImageTransforms(layer.clipId, ratio, transform, keyframes)
    editor.endHistory()
  }

  function onTextPointerMove(event: PointerEvent) {
    if (!textDrag || event.pointerId !== textDrag.pointerId || !app) return
    const bounds = (app.canvas as HTMLCanvasElement).getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const design = textDesignSize(editor.effectiveProjectAspect)
    editor.updateTextItem(textDrag.id, {
      x: textDrag.x + (event.clientX - textDrag.clientX) * design.w / bounds.width,
      y: textDrag.y + (event.clientY - textDrag.clientY) * design.h / bounds.height,
    })
  }

  function onTextPointerUp(event: PointerEvent) {
    if (!textDrag || event.pointerId !== textDrag.pointerId) return
    textDrag = null
    stopTextDrag?.()
    stopTextDrag = null
    editor.endHistory()
  }

  function updateVideoFrame(v: HTMLVideoElement, cacheKey: string) {
    const c = canvasCache.get(cacheKey)
    if (!c || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    if (c.width !== v.videoWidth) c.width = v.videoWidth
    if (c.height !== v.videoHeight) c.height = v.videoHeight
    try { ctx.drawImage(v, 0, 0, c.width, c.height) } catch { /* tainted or not decoded yet */ }
  }

  function originalMedia(clip: Clip, sourceTime: number, cacheKey: string): ActiveMedia {
    let targetTime = sourceTime
    const stopBlock = editor.effectBlocks.find((b) => (
      !b.ownerClipId || b.ownerClipId === clip.id
    ) && b.effectId === 'stop-motion'
      && editor.currentTime >= b.start && editor.currentTime < b.start + b.duration)
    if (stopBlock) {
      const fps = Math.max(1, Math.round(Number(stopBlock.params.fps ?? 12)))
      targetTime = Math.floor(sourceTime * fps) / fps
    }
    return {
      blobUrl: clip.scrubBlobUrl,
      targetTime,
      playbackRate: clipPlaybackRate(clip),
      cacheKey,
      mediaKind: clip.mediaKind ?? 'video',
    }
  }

  function resolveActiveBlob(clip: Clip, sourceTime: number, originalCacheKey: string): ActiveMedia {
    return originalMedia(clip, sourceTime, originalCacheKey)
  }

  function resolveVisualLayers(clip: Clip, sourceTime: number, originalCacheKey: string): VisualMediaLayer[] {
    return [{ ...resolveActiveBlob(clip, sourceTime, originalCacheKey), alpha: 1 }]
  }

  function pixiFrameSize(): PixiFrameSize {
    if (!app) return { w: 1920, h: 1080 }
    return { w: Math.max(1, Math.round(app.screen.width)), h: Math.max(1, Math.round(app.screen.height)) }
  }

  function applyPixiEffectStack(sp: Sprite, channelId: string, clip: Clip, timelineTime: number) {
    if (!app) return
    const source = getMediaBinSource(clip.fileName)
    const imageSize = imageSourceSizes.get(sp)
    const frame: PixiFrameSize = {
      w: Math.max(1, source?.width || imageSize?.w || sp.texture.width || 1920),
      h: Math.max(1, source?.height || imageSize?.h || sp.texture.height || 1080),
      fps: editor.fps,
    }
    const sampleTime = Math.floor(timelineTime * editor.fps + 0.00001) / editor.fps
    const active = getActivePixiEffectsForClip(channelId, clip.id, editor.effectBlocks, sampleTime, clip.start)
    if (active.length === 0) {
      effectHistories.get(clip.id)?.history.dispose()
      effectHistories.delete(clip.id)
      previewFilters.releaseEffects(clip.id)
      sp.filters = []
      return
    }
    const plans = applyPixiPerfBudget(planPixiEffectStack(active, sampleTime, frame), pixiFps)
    const signature = pixiHistorySignature(active)
    let cached = effectHistories.get(clip.id)
    if (!cached || cached.signature !== signature) {
      cached?.history.dispose()
      cached = { signature, history: new PixiHistory() }
      effectHistories.set(clip.id, cached)
    }
    // Pixi filters sample the fitted screen image, not the original media.
    // Keep blur distances in source pixels, including downscaled proxies.
    const built = previewFilters.effects(clip.id, plans, frame, {
      x: sp.scale.x * sp.texture.width / frame.w,
      y: sp.scale.y * sp.texture.height / frame.h,
    }, cached.history)
    sp.filters = [...built.filters]
    if (built.transform) {
      const tw = sp.texture.width || 1
      const th = sp.texture.height || 1
      const fit = videoFitScale(tw, th, app.screen.width, app.screen.height, editor.videoFit)
      sp.x += built.transform.dx * fit
      sp.y += built.transform.dy * fit
      sp.rotation += (built.transform.rotation * Math.PI) / 180
      if (sp.skew && typeof sp.skew.set === 'function') {
        const prevX = (sp.skew as unknown as { x: number }).x ?? 0
        const prevY = (sp.skew as unknown as { y: number }).y ?? 0
        ;(sp.skew as unknown as { set: (x: number, y: number) => void }).set(prevX + built.transform.shearX, prevY + built.transform.shearY)
      }
      if (built.transform.mirrorH) sp.scale.x *= -1
      if (built.transform.mirrorV) sp.scale.y *= -1
      // Cover zoom from shake/weave/wobble transforms (mirrors FFmpeg's
      // crop-then-scale which hides displaced edges).
      if (built.transform.scaleX !== 1) sp.scale.x *= built.transform.scaleX
      if (built.transform.scaleY !== 1) sp.scale.y *= built.transform.scaleY
    }
  }

  function getOverlapProgress(clip: Clip, otherClip: Clip, currentTime: number): number | null {
    const overlapStart = Math.max(clip.start, otherClip.start)
    const overlapEnd = Math.min(clipEnd(clip), clipEnd(otherClip))
    if (currentTime < overlapStart || currentTime >= overlapEnd) return null
    const overlapDuration = overlapEnd - overlapStart
    if (overlapDuration <= 0) return null
    return (currentTime - overlapStart) / overlapDuration
  }

  function syncActivePlayback(
    active: Array<{ channel: Channel; clip: Clip }>,
    audioActive: Array<{ channel: Channel; clip: Clip }>,
    activeVoiceKeys: Set<string>,
  ) {
    const handled = new Set<string>()
    const audioFirst = [...active].sort((a, b) => {
      const av = a.channel.type === 'audio' ? 0 : 1
      const bv = b.channel.type === 'audio' ? 0 : 1
      return av - bv
    })
    for (const entry of audioFirst) {
      // Scene JSON is rendered by its sandbox; treating it as video reloads it every frame.
      if (entry.channel.type === 'video' && isLiveSceneFile(entry.clip.fileName)) continue
      // Audio transitions are live: every overlap is a crossfade rendered
      // per-voice with gain ramps, exactly like the ffmpeg acrossfade export
      // (linear triangular curve). No rendered transition blob is used, so the
      // transition is audible instantly on both timeline and program playback.
      const sourceTime = clipSourceTimeAt(entry.clip, editor.currentTime)
      const originalCacheKey = continuousMediaCacheKey(entry.clip)
      const media: ActiveMedia[] = entry.channel.type === 'video'
        ? resolveVisualLayers(entry.clip, sourceTime, originalCacheKey)
        : [resolveActiveBlob(entry.clip, sourceTime, originalCacheKey)]
      const isAudioChannel = entry.channel.type === 'audio'
      for (const resolved of media) {
        if (!resolved.blobUrl || (!isAudioChannel && resolved.mediaKind === 'image')) continue
        const voiceKey = isAudioChannel
          ? resolved.cacheKey
          : `video:${resolved.cacheKey}`
        if (handled.has(voiceKey)) continue
        handled.add(voiceKey)
        activeVoiceKeys.add(voiceKey)
        const v = isAudioChannel
          ? getOrCreateAudioVoice(voiceKey, resolved.blobUrl)
          : getOrCreateVideo(resolved.blobUrl, resolved.cacheKey)
        if (!v) continue
        playback.register(voiceKey, v, isAudioChannel)
        playback.sync(voiceKey, v, resolved.targetTime, editor.playing, resolved.playbackRate, editor.fps)

        let gainScale = 1
        if (isAudioChannel) {
          const clip = entry.clip
          for (const other of audioActive) {
            if (other.clip.id === clip.id || other.channel.id !== entry.channel.id) continue
            const overlapProgress = getOverlapProgress(clip, other.clip, editor.currentTime)
            if (overlapProgress === null) continue
            gainScale = Math.min(gainScale, clip.start < other.clip.start ? 1 - overlapProgress : overlapProgress)
          }
        }
        const wantMuted = isAudioChannel ? (muted || entry.channel.muted) : true
        const clipVolume = (entry.clip.volume ?? 100) / 100
        playback.setGain(voiceKey, v, isAudioChannel, wantMuted, gainScale * clipVolume)
      }
    }
  }

  function isVideoFrameReady(cacheKey: string): boolean {
    const v = videoCache.get(cacheKey)?.element
    if (!v) return false
    try {
      if (v.seeking) return false
    } catch { /* test doubles may not implement seeking */ }
    return v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  }

  function prewarmUpcomingVideo(activeCacheKeys: Set<string>) {
    const now = editor.currentTime
    const prewarmedKeys = new Set<string>()
    for (const { channel, clip } of nearbyClips) {
      const startsIn = clip.start - now
      if (!(startsIn > 0 && startsIn <= VIDEO_PREWARM_SEC)) continue
      if (channel.type === 'video' && isLiveSceneFile(clip.fileName)) {
        const upcoming = previewClipsInRange(mediaIndex, clip.start).filter(entry => entry.channel.type === 'video')
        if (canPresentDirectPreview(upcoming, editor.effectBlocks, clip.start, directTransitionId)) sceneTextures.prepare(clip.fileName, clip.inPoint, `clip:${clip.id}`, app?.screen)
        else sceneTextures.get(clip.fileName, clip.inPoint, `clip:${clip.id}`, app?.screen)
        continue
      }
      if (!clip.scrubBlobUrl || clip.mediaKind === 'image') continue
      const cacheKey = continuousMediaCacheKey(clip)
      // Seeking a continuous voice early would jump the clip still on screen.
      if (activeCacheKeys.has(cacheKey) || prewarmedKeys.has(cacheKey)) continue
      prewarmedKeys.add(cacheKey)
      try {
        const v = channel.type === 'audio'
          ? getOrCreateAudioVoice(cacheKey, clip.scrubBlobUrl)
          : getOrCreateVideo(clip.scrubBlobUrl, cacheKey)
        if (!v || v.seeking || v.readyState < HTMLMediaElement.HAVE_METADATA) continue
        if (Number.isFinite(clip.inPoint) && Math.abs(v.currentTime - clip.inPoint) > VIDEO_PREWARM_EPS) v.currentTime = clip.inPoint
        if (channel.type === 'video') getOrCreateSprite(clip.scrubBlobUrl, cacheKey, clip.mediaKind ?? 'video')
      } catch { /* one cold clip must not break the frame */ }
    }
  }

  function directTransitionId(left: Clip, right: Clip): string {
    return editor.getTransitionBetween(left.id, right.id)?.effectId ?? 'cross-dissolve'
  }

  function directClipAppearance(channel: Channel, clip: Clip, videoActive: Array<{ channel: Channel; clip: Clip }>) {
    const time = Math.floor(editor.currentTime * editor.fps + 0.00001) / editor.fps
    const effects = getActivePixiEffectsForClip(channel.id, clip.id, editor.effectBlocks, time, clip.start)
    const plans = planPixiEffectStack(effects, time, pixiFrameSize())
    const filter = isLiveSceneFile(clip.fileName) ? '' : directEffects.filter(clip.id, plans)
    const siblings = videoActive.filter(entry => entry.channel.id === channel.id)
    const progress = siblings.length === 2 ? getOverlapProgress(siblings[0].clip, siblings[1].clip, editor.currentTime) : null
    return {
      filter,
      matrices: directEffectMatrices(plans),
      alpha: progress === null ? 1 : siblings[0].clip.id === clip.id ? 1 - progress : progress,
      blendMode: progress === null ? 'normal' as const : 'plus-lighter' as const,
    }
  }

  function presentDirectScenes(videoActive: Array<{ channel: Channel; clip: Clip }>): boolean {
    if (!app) return false
    const direct = !!stageEl && canPresentDirectPreview(videoActive, editor.effectBlocks, editor.currentTime, directTransitionId)
    const keys = new Set<string>()
    const { width, height } = app.screen
    directLayers.begin(app.screen)
    if (direct) {
      videoActive.forEach(({ channel, clip }, order) => {
        if (!isLiveSceneFile(clip.fileName)) return
        if (channel.hidden) return
        const key = `clip:${clip.id}`
        keys.add(key)
        directLayers.channelHost(channel.id, order)
        const appearance = directClipAppearance(channel, clip, videoActive)
        sceneTextures.present(clip.fileName, clipSourceTimeAt(clip, editor.currentTime), key, {
          width,
          height,
          alpha: clipAlphaAt(clip, editor.currentTime) * appearance.alpha,
          filter: appearance.filter,
          matrices: appearance.matrices,
          blendMode: appearance.blendMode,
          playing: editor.playing,
          playbackRate: clipPlaybackRate(clip),
          order,
          transform: clipTransformAt(clip, editor.currentTime - clip.start),
          fit: editor.videoFit,
        })
        const sprite = sceneTextures.interactionGeometry(key, app!.screen, clipTransformAt(clip, editor.currentTime - clip.start), editor.videoFit)
        if (sprite && clipAlphaAt(clip, editor.currentTime) * appearance.alpha > 0.02) {
          interactiveImageLayers.push({ clipId: clip.id, channelId: channel.id, cacheKey: key, sprite })
        }
      })
    }
    sceneTextures.hideDirect(keys)
    if (app.renderer.background) app.renderer.background.alpha = direct ? 0 : 1
    ;(app.canvas as HTMLCanvasElement).style.visibility = direct && editor.getActiveTextItemsAt(editor.currentTime).length === 0 ? 'hidden' : ''
    return direct
  }

  function renderActiveClips() {
    if (!app) return
    releaseUnusedVisualMedia()
    app.stage.removeChildren()
    interactiveImageLayers = []

    const active = activeClips
    const videoActive = active.filter((a) => a.channel.type === 'video')
    const audioActive = active.filter((a) => a.channel.type === 'audio')
    const bottomVideoChannelId = videoActive[0]?.channel.id
    const activeVoiceKeys = new Set<string>()

    if (videoActive.length === 0 && audioActive.length === 0) {
      const g = new Graphics()
      g.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x111111 })
      g.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x222222, alpha: 0.3 })
      app.stage.addChild(g)
      playback.stopInactive(new Set())
    }

    syncActivePlayback(active, audioActive, activeVoiceKeys)
    const directComposition = presentDirectScenes(videoActive)

    const consumed = new Set<string>()
    const drawnMedia = new Set<string>()

    function drawClipSprite(
      channel: Channel,
      clip: Clip,
      alpha: number,
      extraFilters: Filter[] | null = null,
      move: { x: number; y: number; scale: number } | null = null,
    ): void {
      const liveScene = isLiveSceneFile(clip.fileName)
      if (!clip.scrubBlobUrl && !liveScene) return
      const sourceTime = clipSourceTimeAt(clip, editor.currentTime)
      const originalCacheKey = continuousMediaCacheKey(clip)
      for (const layer of resolveVisualLayers(clip, sourceTime, originalCacheKey)) {
        if (!layer.blobUrl && !liveScene) continue
        // A held decoded texture can receive the current cut's treatments
        // while its shared video element finishes seeking the next frame.
        if (!directComposition && !liveScene && (layer.mediaKind ?? 'video') !== 'image'
          && !isVideoFrameReady(layer.cacheKey)
          && !lastVideoHoldKeys.includes(layer.cacheKey)) continue
        try {
          const sp = liveScene
            ? sceneTextures.get(clip.fileName, layer.targetTime, `clip:${clip.id}`, app?.screen)
            : getOrCreateSprite(layer.blobUrl!, layer.cacheKey, layer.mediaKind ?? 'video')
          if (!sp) continue
          fitSprite(sp)
          applyClipTransform(sp, clip, editor.currentTime - clip.start)
          if (!directComposition) applyPixiEffectStack(sp, channel.id, clip, editor.currentTime)
          if (extraFilters && extraFilters.length > 0) {
            const current: Filter[] = Array.isArray(sp.filters) ? (sp.filters as Filter[]) : []
            sp.filters = [...current, ...extraFilters]
            // Filter.filterArea is LOCAL: Pixi applies the sprite transform to
            // it, so app.screen here collapses to a small misplaced rect and
            // the xfade only renders inside it. Cover the sprite's own quad
            // instead: the back-texture copy then holds clip A pixels for
            // exactly this screen region, and letterbox stays stage black for
            // both clips (black->black is identity for every transition).
            const tw = sp.texture.width || 1
            const th = sp.texture.height || 1
            sp.filterArea = new Rectangle(-sp.anchor.x * tw, -sp.anchor.y * th, tw, th)
          }
          if (move && app) {
            sp.x += move.x * app.screen.width
            sp.y += move.y * app.screen.height
            sp.scale.x *= move.scale
            sp.scale.y *= move.scale
          }
          sp.alpha = alpha * layer.alpha
          if (!channel.hidden) {
            if (directComposition) {
              const element = layer.mediaKind === 'image' ? canvasCache.get(layer.cacheKey) : videoCache.get(layer.cacheKey)?.element
              const appearance = directClipAppearance(channel, clip, videoActive)
              sp.alpha *= appearance.alpha
              if (element) directLayers.present(element, sp, videoActive.findIndex(entry => entry.clip.id === clip.id), channel.id, appearance)
            } else app!.stage.addChild(sp)
            if (sp.alpha > 0.02 && !(liveScene && directComposition)) {
              interactiveImageLayers.push({
                clipId: clip.id, channelId: channel.id, cacheKey: layer.cacheKey, sprite: sp,
                hitCanvas: clip.mediaKind === 'image' ? canvasCache.get(layer.cacheKey) : undefined,
              })
            }
          }
          if (!directComposition) drawnMedia.add(layer.cacheKey)
        } catch (cause) {
          if (liveScene) sceneError = cause instanceof Error ? cause.message : 'Could not display the live scene.'
          // A single unloadable/tainted image must not hide the other clips.
          continue
        }
      }
    }

    const liveTransition = (() => {
      if (!bottomVideoChannelId) return null
      const ch = editor.channels.find((c) => c.id === bottomVideoChannelId)
      if (!ch) return null
      const sorted = videoActive.filter(entry => entry.channel.id === ch.id).map(entry => entry.clip)
      for (let i = 0; i < sorted.length - 1; i++) {
        const left = sorted[i]
        const right = sorted[i + 1]
        const progress = getOverlapProgress(left, right, editor.currentTime)
        if (progress === null) continue
        const placed = editor.getTransitionBetween(left.id, right.id)
        const transitionId = placed?.effectId ?? 'cross-dissolve'
        return { channel: ch, left, right, progress, plan: planPixiTransition(transitionId, progress), transitionId }
      }
      return null
    })()

    if (liveTransition && !directComposition && !liveTransition.channel.hidden) {
      const { channel, left, right, plan } = liveTransition
      consumed.add(left.id)
      consumed.add(right.id)
      const leftAlpha = clipAlphaAt(left, editor.currentTime)
      const rightAlpha = clipAlphaAt(right, editor.currentTime)
      drawClipSprite(channel, left, leftAlpha * plan.alphaA, null, plan.moveA)
      const revealFilter = previewFilters.transition(right.id, plan.reveal, editor.projectResolution)
      const extraB = revealFilter ? [revealFilter] : null
      drawClipSprite(channel, right, rightAlpha * plan.alphaB, extraB, plan.moveB)
    }

    videoActive.forEach((entry) => {
      const { clip, channel } = entry
      if (directComposition && isLiveSceneFile(clip.fileName)) return
      if (consumed.has(clip.id)) return
      if (liveTransition && channel.id === liveTransition.channel.id
        && !directComposition && (clip.id === liveTransition.left.id || clip.id === liveTransition.right.id)) return
      let clipAlpha = clipAlphaAt(clip, editor.currentTime)
      const inLiveOverlap = liveTransition && channel.id === liveTransition.channel.id
        && (clip.id === liveTransition.left.id || clip.id === liveTransition.right.id)
      if (!inLiveOverlap && !directComposition) {
        for (const other of videoActive) {
          if (other.clip.id === clip.id || other.channel.id !== channel.id) continue
          const overlapProgress = getOverlapProgress(clip, other.clip, editor.currentTime)
          if (overlapProgress !== null && clip.start > other.clip.start) clipAlpha = Math.min(clipAlpha, overlapProgress)
        }
      }
      drawClipSprite(channel, clip, clipAlpha)
    })
    // Pre-seek the incoming hard-cut clip while the outgoing one is still on
    // screen, so the async seek finishes before the exact cut frame.
    try {
      const activeKeys = new Set<string>()
      for (const entry of [...videoActive, ...audioActive]) {
        try {
          activeKeys.add(continuousMediaCacheKey(entry.clip))
        } catch { /* best-effort */ }
      }
      prewarmUpcomingVideo(activeKeys)
    } catch { /* prewarm must never break the frame */ }
    drawnMedia.forEach((cacheKey) => {
      const sp = spriteCache.get(cacheKey)
      if (!sp) return
      const v = videoCache.get(cacheKey)?.element
      if (!v || !isVideoFrameReady(cacheKey)) return
      updateVideoFrame(v, cacheKey)
      try { sp.texture.source.update() } catch { /* tainted texture: skip frame, keep preview alive */ }
    })

    const drewVideo = [...drawnMedia].some((cacheKey) => videoCache.has(cacheKey) && spriteCache.has(cacheKey))
    if (drewVideo) {
      lastVideoHoldKeys = [...drawnMedia].filter((cacheKey) => videoCache.has(cacheKey) && spriteCache.has(cacheKey))
    } else if (videoActive.length > 0 && !directComposition) {
      // Incoming clip still seeking on its first preview (e.g. right after an
      // AI cut): keep the previous frame for one frame instead of black.
      for (const cacheKey of lastVideoHoldKeys) {
        const sp = spriteCache.get(cacheKey)
        if (!sp) continue
        try {
          app.stage.addChildAt(sp, 0)
        } catch {
          try { app.stage.addChild(sp) } catch { /* hold is best-effort */ }
        }
      }
    } else {
      lastVideoHoldKeys = []
    }

    const activeTextItems = editor.getActiveTextItemsAt(editor.currentTime)
    textError = ''
    const liveTextIds = new Set(activeTextItems.map((item) => item.id))
    for (const [id, cached] of textSpriteCache) {
      if (liveTextIds.has(id)) continue
      if ('destroy' in cached.sprite) destroyOwnedSprite(cached.sprite)
      textSpriteCache.delete(id)
      textLayoutCache.delete(id)
    }
    for (const item of activeTextItems) {
      const sprite = getOrCreateTextSprite(item)
      if (sprite) app.stage.addChild(sprite)
    }
    directLayers.end()
    interactiveImageLayers.sort((left, right) => videoActive.findIndex(entry => entry.clip.id === left.clipId) - videoActive.findIndex(entry => entry.clip.id === right.clipId))
    syncImageSelectionRect()

    playback.stopInactive(activeVoiceKeys)
  }

  function releaseUnusedVisualMedia() {
    const liveVideoKeys = new Set<string>()
    const liveImageKeys = new Set<string>()
    const liveAudioKeys = new Set<string>()
    const liveSceneKeys = new Set<string>()
    for (const { channel, clip } of nearbyClips) {
      if (channel.type === 'video' && isLiveSceneFile(clip.fileName)) {
        liveSceneKeys.add(`clip:${clip.id}`)
        continue
      }
      if (!clip.scrubBlobUrl) continue
      const cacheKey = continuousMediaCacheKey(clip)
      if (channel.type === 'audio') {
        liveAudioKeys.add(cacheKey)
        liveAudioKeys.add(`clip:${clip.id}`)
      } else if (clip.mediaKind === 'image') liveImageKeys.add(cacheKey)
      else {
        liveVideoKeys.add(cacheKey)
        // Preserve nearby split voices when a drag makes their edges touch.
        liveVideoKeys.add(`clip:${clip.id}`)
      }
    }
    for (const key of lastVideoHoldKeys) {
      if (mediaIndex.sources.get(key) === videoCache.get(key)?.blobUrl) liveVideoKeys.add(key)
    }
    sceneTextures.retain(liveSceneKeys)
    directEffects.retain(new Set(nearbyClips.map(({ clip }) => clip.id)))
    for (const cacheKey of videoCache.keys()) {
      if (!liveVideoKeys.has(cacheKey)) releaseVideo(cacheKey)
    }
    for (const cacheKey of imageCache.keys()) {
      if (!liveImageKeys.has(cacheKey)) releaseImage(cacheKey)
    }
    for (const key of audioVoiceCache.keys()) {
      if (!liveAudioKeys.has(key)) releaseAudioVoice(key)
    }
    const activeIds = new Set(activeClips.filter(({ channel }) => channel.type === 'video').map(({ clip }) => clip.id))
    previewFilters.retain(activeIds)
    for (const [clipId, cached] of effectHistories) {
      if (activeIds.has(clipId)) continue
      cached.history.dispose()
      effectHistories.delete(clipId)
    }
  }

  let playStartWall = 0
  let playStartTime = 0

  function tick(now: number) {
    if (lowPowerPreview && lastPresentedMs > 0 && now - lastPresentedMs < LOW_POWER_FRAME_INTERVAL_MS - 1) {
      rafId = requestAnimationFrame(tick)
      return
    }
    lastPresentedMs = now
    if (lastTickMs > 0 && now > lastTickMs) {
      const instant = 1000 / Math.max(1, now - lastTickMs)
      pixiFps = pixiFps * 0.92 + Math.min(120, instant) * 0.08
    }
    lastTickMs = now
    try {
      if (editor.playing) {
        if (playStartWall === 0) {
          playStartWall = now
          playStartTime = editor.currentTime
        }
        const next = playStartTime + (now - playStartWall) / 1000
        if (next >= editor.totalDuration) {
          editor.setCurrentTime(editor.totalDuration)
          editor.setPlaying(false)
          playStartWall = 0
        } else editor.setCurrentTime(next)
      } else playStartWall = 0
      renderActiveClips()
    } catch {
      // One bad texture (e.g. tainted image canvas) must never kill the
      // preview loop. Skip the frame and keep ticking like video clips do.
    } finally {
      rafId = requestAnimationFrame(tick)
    }
  }

  function togglePlay() {
    playback.ensureAudio()
    void playback.resume()
    render.startPlayback()
  }

  function setVolume(value: number) {
    volume = Math.max(0, Math.min(100, value))
    playback.updateVolume()
  }

  function toggleMute() {
    muted = !muted
    playback.ensureAudio()
    void playback.resume()
    playback.updateVolume()
  }

  function toggleAspect() {
    const current = editor.effectiveProjectAspect
    const next = PROJECT_ASPECT_ORDER[(PROJECT_ASPECT_ORDER.indexOf(current) + 1) % PROJECT_ASPECT_ORDER.length]
    editor.setProjectAspect(next)
  }

  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    if (document.querySelector('dialog[open], [aria-modal="true"]')) return
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
    if (e.key === 'ArrowLeft') { e.preventDefault(); editor.setCurrentTime(Math.max(0, editor.currentTime - 1 / editor.fps)) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); editor.setCurrentTime(editor.currentTime + 1 / editor.fps) }
    else if (e.key === ' ') { e.preventDefault(); togglePlay() }
    else if (e.key.toLowerCase() === 'm') { e.preventDefault(); toggleMute() }
  }

  onMount(async () => {
    const pixiApp = new Application()
    const { width, height } = previewSize()
    await pixiApp.init({
      width,
      height,
      background: 0x000000,
      // WebGL must be created with alpha for the caption canvas above live layers.
      backgroundAlpha: 0,
      antialias: true,
      resolution: lowPowerPreview ? 1 : Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
      // Transition filters sample the stage behind the incoming clip via
      // uBackTexture (blendRequired). On WebGL Pixi skips such filters
      // entirely without a backbuffer, which made every xfade preview a hard
      // cut. Keep the backbuffer so preview xfade matches ffmpeg xfade.
      useBackBuffer: true,
    })
    if (previewDestroyed || !stageEl) {
      pixiApp.destroy(true, { children: true })
      return
    }
    app = pixiApp
    ;(pixiApp.canvas as HTMLCanvasElement).style.cssText = 'position:relative;z-index:1'
    stageEl.appendChild(pixiApp.canvas as HTMLCanvasElement)
    resizeApp()
    requestAnimationFrame(() => resizeApp())
    rafId = requestAnimationFrame(tick)
    window.addEventListener('keydown', onKey)
    resizeObserver = new ResizeObserver(() => resizeApp())
    resizeObserver.observe(stageEl)
  })

  onDestroy(() => {
    previewDestroyed = true
    sceneTextures.dispose()
    previewFilters.dispose()
    effectHistories.forEach(cached => cached.history.dispose())
    effectHistories.clear()
    cancelAnimationFrame(rafId)
    window.removeEventListener('keydown', onKey)
    stopTextDrag?.()
    stopImageDrag?.()
    stopImageResize?.()
    if (textDrag) editor.endHistory()
    if (imageInteraction.kind !== 'idle') editor.endHistory()
    textDrag = null
    imageInteraction = { kind: 'idle' }
    resizeObserver?.disconnect()
    for (const cacheKey of [...videoCache.keys()]) releaseVideo(cacheKey)
    for (const cacheKey of [...imageCache.keys()]) releaseImage(cacheKey)
    for (const voiceKey of [...audioVoiceCache.keys()]) releaseAudioVoice(voiceKey)
    directLayers.dispose()
    directEffects.dispose()
    playback.dispose()
    canvasCache.forEach((c) => c.remove())
    canvasCache.clear()
    spriteCache.clear()
    textSpriteCache.forEach(({ sprite }) => {
      if ('destroy' in sprite) destroyOwnedSprite(sprite)
    })
    textSpriteCache.clear()
    textLayoutCache.clear()
    if (app) {
      app.destroy(true, { children: true })
      app = null
    }
  })

  return {
    get sceneError() { return sceneError || textError },
    get stageEl() { return stageEl },
    set stageEl(value: HTMLDivElement | undefined) { stageEl = value },
    get imageSelectionRect() { return imageSelectionRect },
    get selectedImageActive() { return selectedImageActive },
    get draggingImage() { return draggingImage },
    get resizingImage() { return resizingImage },
    get selectedImageLocked() { return selectedImageLocked },
    get selectedImageZoom() { return selectedImageZoom },
    get selectedMediaLabel() { return selectedMediaLabel },
    get muted() { return muted },
    get volume() { return volume },
    togglePlay,
    toggleMute,
    setVolume,
    toggleAspect,
    onStagePointerDown,
    startImageResize,
    resizeImageWithKeyboard,
    get currentTime() { return editor.currentTime },
    get playing() { return editor.playing },
    get aspect() { return aspectLabel(editor.effectiveProjectAspect) },
    get activeSummary() {
      const activeChannels = new Set(activeClips.map(({ channel }) => channel.id))
      if (activeChannels.size === 0) return 'No active channel'
      const types = new Map<string, number>()
      for (const channelId of activeChannels) {
        const channel = editor.channels.find((candidate) => candidate.id === channelId)
        if (channel) types.set(channel.type, (types.get(channel.type) ?? 0) + 1)
      }
      const videoCount = types.get('video') ?? 0
      const audioCount = types.get('audio') ?? 0
      const total = videoCount + audioCount
      if (videoCount > 0 && audioCount > 0) return `${total} active channels (${videoCount} video, ${audioCount} audio)`
      const type = videoCount > 0 ? 'video' : 'audio'
      return `${total} active ${type} channel${total === 1 ? '' : 's'}`
    },
  }
}
