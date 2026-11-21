import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'

const pixiMocks = vi.hoisted(() => ({
  addChild: vi.fn(),
  drawImage: vi.fn(),
  init: vi.fn(),
  spriteDestroy: vi.fn(),
  textureFrom: vi.fn(),
  textureUpdate: vi.fn(),
}))
const renderMocks = vi.hoisted(() => ({
  nodes: [] as Array<Record<string, unknown>>,
  transitionNodes: [] as Array<Record<string, unknown>>,
  topNode: null as Record<string, unknown> | null,
  transitionNode: null as Record<string, unknown> | null,
}))

// Mock ResizeObserver (needed by Preview)
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverMock)

// Keep the latest callback so playback rendering can be advanced explicitly.
let rafCallback: FrameRequestCallback | null = null
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  rafCallback = cb
  return 1
})
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})

// Mock pixi.js Application entirely
vi.mock('pixi.js', () => {
  class MockFilter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resources: any = undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_options?: any) {
      this.resources = _options?.resources
    }
    destroy(): void {}
  }
  class MockColorMatrix extends MockFilter {
    matrix: unknown = null
    alpha = 1
    brightness(_v: number, _m: boolean): void {}
    saturate(_v: number, _m: boolean): void {}
    contrast(_v: number, _m: boolean): void {}
  }
  class MockBlur extends MockFilter {
    strength = 0
    strengthX = 0
    strengthY = 0
    quality = 2
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(options?: any) {
      super(options)
      this.strength = options?.strength ?? options?.strengthX ?? 0
      this.strengthX = options?.strengthX ?? options?.strength ?? 0
      this.strengthY = options?.strengthY ?? options?.strength ?? 0
      this.quality = options?.quality ?? 2
    }
  }
  class MockNoise extends MockFilter {
    noise = 0
    seed = 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(options?: any) {
      super(options)
      this.noise = options?.noise ?? 0
      this.seed = options?.seed ?? 1
    }
  }
  return {
    Application: class {
      stage = { removeChildren: () => {}, addChild: pixiMocks.addChild }
      screen = { width: 1920, height: 1080 }
      renderer = { resize: () => {} }
      canvas = document.createElement('canvas')
      async init(options: unknown): Promise<void> { pixiMocks.init(options) }
      destroy(): void {}
    },
    Sprite: class {
      anchor = { x: 0, y: 0, set: (x: number, y = x) => { this.anchor.x = x; this.anchor.y = y } }
      scale = { x: 1, y: 1, set: (x: number, y = x) => { this.scale.x = x; this.scale.y = y } }
      skew = { x: 0, y: 0, set: (x: number, y = x) => { this.skew.x = x; this.skew.y = y } }
      x = 0
      y = 0
      rotation = 0
      alpha = 1
      filters: unknown[] = []
      texture: { width: number; height: number; source: { update: () => void } }
      constructor(texture = { width: 100, height: 100, source: { update: pixiMocks.textureUpdate } }) { this.texture = texture }
      getBounds() {
        const width = Math.abs(this.texture.width * this.scale.x)
        const height = Math.abs(this.texture.height * this.scale.y)
        return { x: this.x - width * this.anchor.x, y: this.y - height * this.anchor.y, width, height }
      }
      destroy(options?: unknown): void { pixiMocks.spriteDestroy(options) }
    },
    Texture: class {
      static EMPTY = {}
      constructor() {}
      static from(canvas: HTMLCanvasElement) {
        pixiMocks.textureFrom(canvas)
        return { width: canvas.width, height: canvas.height, source: { update: pixiMocks.textureUpdate } }
      }
    },
    VideoSource: class {
      constructor() {}
      update(): void {}
    },
    Graphics: class {
      rect(): this { return this }
      fill(): this { return this }
    },
    Filter: MockFilter,
    BlurFilter: MockBlur,
    ColorMatrixFilter: MockColorMatrix,
    NoiseFilter: MockNoise,
    TexturePoolClass: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(_options?: any) {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getSameSizeTexture(_input?: any): object { return {} }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      returnTexture(_texture?: any): void {}
    },
    BufferImageSource: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(_options?: any) {}
    },
    RendererType: { WEBGL: 2, WEBGPU: 3 },
    GlProgram: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      static from(_options: any): object { return {} }
    },
    UniformGroup: class {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(public uniforms: any) {}
    },
  }
})

vi.mock('../../stores/editor.svelte', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const rate = (clip: { playbackRate?: number }) => clip.playbackRate ?? 1
  return {
    ...actual,
    clipPlaybackRate: rate,
    clipEnd: (clip: { start: number; inPoint: number; outPoint: number; playbackRate?: number }) =>
      clip.start + (clip.outPoint - clip.inPoint) / rate(clip),
    clipSourceTimeAt: (clip: { start: number; inPoint: number; playbackRate?: number }, time: number) =>
      clip.inPoint + (time - clip.start) * rate(clip),
  }
})

vi.mock('../../stores/render.svelte', () => {
  return {
    render: {
      get nodes() { return renderMocks.nodes },
      get transitionNodes() { return renderMocks.transitionNodes },
      get renderingForPlayback() { return false },
      getTopNodeAtStack: () => renderMocks.topNode,
      getTransitionAt: () => renderMocks.transitionNode,
      getTransitionNodeFor: () => null,
      startPlayback: vi.fn(() => { /* no-op */ }),
      ensureWasm: vi.fn(),
    }
  }
})

import Preview from '../../components/Preview.svelte'
import { editor } from '../../stores/editor.svelte'
import { clearMediaBinSources, registerMediaBinSource } from '../../lib/media-bin'

describe('Preview', () => {
  beforeEach(() => {
    clearMediaBinSources()
    pixiMocks.addChild.mockClear()
    pixiMocks.drawImage.mockReset()
    pixiMocks.init.mockClear()
    pixiMocks.spriteDestroy.mockReset()
    pixiMocks.textureFrom.mockReset()
    pixiMocks.textureUpdate.mockReset()
    renderMocks.nodes = []
    renderMocks.transitionNodes = []
    renderMocks.topNode = null
    renderMocks.transitionNode = null
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
      font: '', textAlign: 'left', textBaseline: 'middle', lineJoin: 'round', globalAlpha: 1,
      fillStyle: '', strokeStyle: '', lineWidth: 0,
      measureText: (text: string) => ({ width: text.length * 50 }),
      fillText: vi.fn(), strokeText: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: pixiMocks.drawImage,
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D)) as unknown as typeof HTMLCanvasElement.prototype.getContext)
    while (editor.textItems.length > 0) editor.removeTextItem(editor.textItems[0].id)
    rafCallback = null
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.selectClip(null)
    editor.setCurrentTime(0)
    editor.setPlaying(false)
    editor.setResolution('1080p')
    editor.resetProjectAspect()
    editor.setFps(30)
  })

  it('renders the stage container and overlay timecode', async () => {
    const { getByText } = render(Preview)
    await new Promise((r) => setTimeout(r, 10))
    editor.setCurrentTime(2.34)
    await new Promise((r) => setTimeout(r, 10))
    expect(getByText(/s$/)).toBeTruthy()
  })

  it('initializes a viewport-sized portrait canvas instead of an output-sized framebuffer', async () => {
    editor.initializeProjectAspect(720, 1280)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(pixiMocks.init).toHaveBeenCalledWith(expect.objectContaining({ width: 203, height: 360 }))
  })

  it('renders the play, mute and aspect controls', () => {
    const { container } = render(Preview)
    const buttons = container.querySelectorAll('button.cbtn')
    expect(buttons.length).toBe(3)
  })

  it('renders active text as a Pixi sprite at design-space coordinates', async () => {
    editor.addTextItem(0, { text: 'Pixi title', x: 480, y: 270, duration: 2, backgroundOpacity: 0.7 })
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    rafCallback?.(100)

    const sprite = pixiMocks.addChild.mock.calls.map(([child]) => child).find((child) => child?.texture)
    expect(sprite).toMatchObject({ x: 480, y: 270 })
  })

  it('shows "no active channel" when none are active', () => {
    const { getByText } = render(Preview)
    expect(getByText(/No active channel/i)).toBeTruthy()
  })

  it('shows the type and count of active channels', () => {
    editor.addClip(editor.channels[0].id, {
      fileName: 'clip.mp4',
      scrubBlobUrl: 'blob:x',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    editor.setCurrentTime(2)
    const { getByText } = render(Preview)
    expect(getByText(/1 active video channel/)).toBeTruthy()
  })

  it('counts overlapping clips on one channel only once', () => {
    for (const start of [0, 1]) {
      editor.addClip(editor.channels[0].id, {
        fileName: `clip-${start}.mp4`,
        scrubBlobUrl: `blob:${start}`,
        sourceDuration: 10,
        inPoint: 0,
        outPoint: 5,
        start,
      })
    }
    editor.setCurrentTime(2)

    const { getByText } = render(Preview)
    expect(getByText(/1 active video channel/)).toBeTruthy()
  })

  it('shows separate video and audio active-channel counts', () => {
    for (const channel of editor.channels) {
      editor.addClip(channel.id, {
        fileName: `${channel.type}.mp4`,
        scrubBlobUrl: `blob:${channel.type}`,
        sourceDuration: 10,
        inPoint: 0,
        outPoint: 5,
        start: 0,
      })
    }
    editor.setCurrentTime(2)

    const { getByText } = render(Preview)
    expect(getByText(/2 active channels \(1 video, 1 audio\)/)).toBeTruthy()
  })

  it('keeps a large image in one bounded static texture', async () => {
    const nativeImage = globalThis.Image
    class LoadedImage {
      complete = true
      naturalWidth = 8000
      naturalHeight = 6000
      width = 8000
      height = 6000
      decoding = ''
      onload: (() => void) | null = null
      src = 'blob:image'
    }
    vi.stubGlobal('Image', LoadedImage)

    try {
      const video = editor.channels.find((channel) => channel.type === 'video')!
      const clip = editor.addClip(video.id, {
        fileName: 'still.jpg',
        mediaKind: 'image',
        scrubBlobUrl: 'blob:image',
        sourceDuration: 10,
        inPoint: 0,
        outPoint: 10,
        start: 0,
      })
      editor.addEffectBlock(video.id, 'soft-focus', 0, 10)
      editor.setCurrentTime(1)
      render(Preview)
      await new Promise((resolve) => setTimeout(resolve, 10))
      rafCallback?.(100)
      rafCallback?.(116)
      rafCallback?.(132)

      expect(pixiMocks.addChild.mock.calls.some(([child]) => child?.texture?.width === 2048)).toBe(true)
      expect(pixiMocks.drawImage).toHaveBeenCalledWith(expect.any(LoadedImage), 0, 0, 2048, 1536)
      expect([...document.querySelectorAll('video')].some((element) => element.src === 'blob:image')).toBe(false)
      expect(pixiMocks.textureFrom).toHaveBeenCalledTimes(1)
      expect(pixiMocks.textureUpdate).not.toHaveBeenCalled()
      const sprite = pixiMocks.addChild.mock.calls.map(([child]) => child).find((child) => child?.texture?.width === 2048)
      // The fitted image is 1440px wide, but the blur belongs to its 8000px
      // source: the gaussian pipeline's blur passes scale sampling to source
      // pixels, and intensity lives on the trailing combine pass.
      const pipeline = sprite.filters[0]
      const blurUniforms = pipeline.passes[0].resources.customUniforms.uniforms
      expect(blurUniforms.uPixelScale.value).toBeCloseTo(1440 / 8000)
      expect(pipeline.passes[pipeline.passes.length - 1].resources.customUniforms.uniforms.uIntensity.value).toBe(1)

      registerMediaBinSource({ id: 'still', name: 'still.jpg', kind: 'image', duration: 10, width: 16000, height: 12000 })
      rafCallback?.(140)
      const scaledUniforms = sprite.filters[0].passes[0].resources.customUniforms.uniforms
      expect(scaledUniforms.uPixelScale.value).toBeCloseTo(1440 / 16000)

      editor.removeClip(video.id, clip.id)
      rafCallback?.(148)
      expect(pixiMocks.spriteDestroy).toHaveBeenCalledWith({ texture: true, textureSource: true })
    } finally {
      vi.stubGlobal('Image', nativeImage)
    }
  })

  it('selects and repositions an image overlay directly in the preview', async () => {
    const nativeImage = globalThis.Image
    class LoadedImage {
      complete = true
      naturalWidth = 1920
      naturalHeight = 1080
      width = 1920
      height = 1080
      decoding = ''
      onload: (() => void) | null = null
      src = 'blob:overlay'
    }
    vi.stubGlobal('Image', LoadedImage)

    try {
      const video = editor.channels.find((channel) => channel.type === 'video')!
      const overlay = editor.addClip(video.id, {
        fileName: 'overlay.png', mediaKind: 'image', scrubBlobUrl: 'blob:overlay', sourceDuration: 4,
        inPoint: 0, outPoint: 4, start: 0, transform: {
          zoomX: 0.5, zoomY: 0.5, linkZoom: true, positionX: 0, positionY: 0,
          rotation: 0, anchorX: 0.5, anchorY: 0.5, pitch: 0, yaw: 0, flipH: false, flipV: false,
        },
      })
      editor.setCurrentTime(1)
      const onOpenClipInspector = vi.fn()
      const { container } = render(Preview, { props: { onOpenClipInspector } })
      await new Promise((resolve) => setTimeout(resolve, 10))
      rafCallback?.(100)

      const canvas = container.querySelector('canvas')!
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080, x: 0, y: 0, toJSON: () => ({}),
      }))
      const stage = container.querySelector('.stage')!
      await fireEvent.pointerDown(stage, { button: 0, pointerId: 7, clientX: 960, clientY: 540 })
      await fireEvent.pointerMove(window, { pointerId: 7, clientX: 1152, clientY: 648 })
      await fireEvent.pointerUp(window, { pointerId: 7, clientX: 1152, clientY: 648 })

      expect(editor.selectedClipId).toBe(overlay.id)
      expect(onOpenClipInspector).not.toHaveBeenCalled()
      expect(editor.getClipById(overlay.id)?.clip.transform).toMatchObject({ positionX: 10, positionY: 10 })

      // A second tap opens the inspector without moving the image.
      await fireEvent.pointerDown(stage, { button: 0, pointerId: 8, clientX: 1152, clientY: 648 })
      await fireEvent.pointerUp(window, { pointerId: 8, clientX: 1152, clientY: 648 })
      expect(onOpenClipInspector).toHaveBeenCalledTimes(1)
    } finally {
      vi.stubGlobal('Image', nativeImage)
    }
  })

  it.each(['image', 'video'] as const)('resizes a selected first-channel %s proportionally from a corner handle', async (mediaKind) => {
    const nativeImage = globalThis.Image
    class LoadedImage {
      complete = true
      naturalWidth = 1920
      naturalHeight = 1080
      width = 1920
      height = 1080
      decoding = ''
      onload: (() => void) | null = null
      src = 'blob:resize'
    }
    vi.stubGlobal('Image', LoadedImage)

    try {
      const video = editor.channels.find((channel) => channel.type === 'video')!
      const image = editor.addClip(video.id, {
        fileName: mediaKind === 'image' ? 'resize.png' : 'resize.mp4', mediaKind, scrubBlobUrl: 'blob:resize', sourceDuration: 4,
        inPoint: 0, outPoint: 4, start: 0, transform: {
          zoomX: 0.5, zoomY: 0.5, linkZoom: true, positionX: 0, positionY: 0,
          rotation: 0, anchorX: 0.5, anchorY: 0.5, pitch: 0, yaw: 0, flipH: false, flipV: false,
        },
      })
      editor.selectClip(image.id)
      editor.setCurrentTime(1)
      const { container } = render(Preview)
      await new Promise((resolve) => setTimeout(resolve, 10))

      if (mediaKind === 'video') {
        const original = [...document.querySelectorAll('video')].find(element => element.src === 'blob:resize')!
        Object.defineProperties(original, {
          readyState: { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA },
          videoWidth: { configurable: true, value: 1920 },
          videoHeight: { configurable: true, value: 1080 },
        })
      }

      const bounds = {
        left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080, x: 0, y: 0, toJSON: () => ({}),
      }
      const canvas = container.querySelector('canvas')!
      canvas.getBoundingClientRect = vi.fn(() => bounds)
      const stage = container.querySelector('.stage') as HTMLElement
      stage.getBoundingClientRect = vi.fn(() => bounds)
      rafCallback?.(100)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(container.querySelectorAll('[data-resize-corner]')).toHaveLength(4)
      const handle = container.querySelector('[data-resize-corner="se"]')!
      await fireEvent.pointerDown(handle, { button: 0, pointerId: 9, clientX: 1440, clientY: 810 })
      await fireEvent.pointerMove(window, { pointerId: 9, clientX: 1920, clientY: 1080 })
      await fireEvent.pointerUp(window, { pointerId: 9, clientX: 1920, clientY: 1080 })

      expect(editor.getClipById(image.id)?.clip.transform).toMatchObject({ zoomX: 1, zoomY: 1 })
      editor.undo()
      expect(editor.getClipById(image.id)?.clip.transform).toMatchObject({ zoomX: 0.5, zoomY: 0.5 })
    } finally {
      vi.stubGlobal('Image', nativeImage)
    }
  })

  it('moves the image selected on the timeline when active images overlap', async () => {
    const nativeImage = globalThis.Image
    class LoadedImage {
      complete = true
      naturalWidth = 1920
      naturalHeight = 1080
      width = 1920
      height = 1080
      decoding = ''
      onload: (() => void) | null = null
      src = ''
    }
    vi.stubGlobal('Image', LoadedImage)

    try {
      const lowerTrack = editor.channels.find((channel) => channel.type === 'video')!
      const upperTrack = editor.addChannel('video')
      const lower = editor.addClip(lowerTrack.id, {
        fileName: 'selected.png', mediaKind: 'image', scrubBlobUrl: 'blob:selected', sourceDuration: 4,
        inPoint: 0, outPoint: 4, start: 0,
      })
      editor.addClip(upperTrack.id, {
        fileName: 'top.png', mediaKind: 'image', scrubBlobUrl: 'blob:top', sourceDuration: 4,
        inPoint: 0, outPoint: 4, start: 0,
      })
      editor.selectClip(lower.id)
      editor.setCurrentTime(1)
      const { container } = render(Preview)
      await new Promise((resolve) => setTimeout(resolve, 10))
      rafCallback?.(100)

      const canvas = container.querySelector('canvas')!
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080, x: 0, y: 0, toJSON: () => ({}),
      }))
      const stage = container.querySelector('.stage')!
      await fireEvent.pointerDown(stage, { button: 0, pointerId: 8, clientX: 960, clientY: 540 })
      await fireEvent.pointerMove(window, { pointerId: 8, clientX: 768, clientY: 540 })
      await fireEvent.pointerUp(window, { pointerId: 8, clientX: 768, clientY: 540 })

      expect(editor.selectedClipId).toBe(lower.id)
      expect(editor.getClipById(lower.id)?.clip.transform?.positionX).toBe(-10)
    } finally {
      vi.stubGlobal('Image', nativeImage)
    }
  })

  it('fades an image layer over the visual track below it', async () => {
    const nativeImage = globalThis.Image
    class LoadedImage {
      complete = true
      naturalWidth = 1920
      naturalHeight = 1080
      width = 1920
      height = 1080
      decoding = ''
      onload: (() => void) | null = null
      src = 'blob:image'
    }
    vi.stubGlobal('Image', LoadedImage)

    try {
      const base = editor.channels.find((channel) => channel.type === 'video')!
      const overlay = editor.addChannel('video')
      editor.addClip(base.id, {
        fileName: 'base.jpg', mediaKind: 'image', scrubBlobUrl: 'blob:base', sourceDuration: 4,
        inPoint: 0, outPoint: 4, start: 0,
      })
      editor.addClip(overlay.id, {
        fileName: 'b-roll.jpg', mediaKind: 'image', scrubBlobUrl: 'blob:b-roll', sourceDuration: 4,
        inPoint: 0, outPoint: 4, start: 0, opacity: 0.8, fadeIn: 2, fadeOut: 1,
      })
      editor.setCurrentTime(1)
      render(Preview)
      await new Promise((resolve) => setTimeout(resolve, 10))
      pixiMocks.addChild.mockClear()

      rafCallback?.(100)

      const sprites = pixiMocks.addChild.mock.calls.map(([sprite]) => sprite).filter((sprite) => sprite?.texture)
      expect(sprites).toHaveLength(2)
      expect(sprites[0].alpha).toBe(1)
      expect(sprites[1].alpha).toBeCloseTo(0.4)
    } finally {
      vi.stubGlobal('Image', nativeImage)
    }
  })

  it('keeps upper-track transition padding transparent', async () => {
    const nativeImage = globalThis.Image
    class LoadedImage {
      complete = true
      naturalWidth = 400
      naturalHeight = 300
      width = 400
      height = 300
      decoding = ''
      onload: (() => void) | null = null
      src = 'blob:image'
    }
    vi.stubGlobal('Image', LoadedImage)

    try {
      const base = editor.channels.find((channel) => channel.type === 'video')!
      const overlay = editor.addChannel('video')
      editor.addClip(base.id, {
        fileName: 'base.jpg', mediaKind: 'image', scrubBlobUrl: 'blob:base', sourceDuration: 3,
        inPoint: 0, outPoint: 3, start: 0,
      })
      const left = editor.addClip(overlay.id, {
        fileName: 'left.jpg', mediaKind: 'image', scrubBlobUrl: 'blob:left', sourceDuration: 2,
        inPoint: 0, outPoint: 2, start: 0,
      })
      const right = editor.addClip(overlay.id, {
        fileName: 'right.jpg', mediaKind: 'image', scrubBlobUrl: 'blob:right', sourceDuration: 2,
        inPoint: 0, outPoint: 2, start: 1,
      })
      const node = {
        id: 'upper-transition',
        channelId: overlay.id,
        leftClipId: left.id,
        rightClipId: right.id,
        start: 1,
        end: 2,
        isAudio: false,
        outputBlobUrl: 'blob:opaque-transition',
        state: 'ready',
      }
      renderMocks.transitionNodes = [node]
      renderMocks.transitionNode = node
      editor.setCurrentTime(1.5)
      render(Preview)
      await new Promise((resolve) => setTimeout(resolve, 10))
      pixiMocks.addChild.mockClear()

      rafCallback?.(100)

      const sprites = pixiMocks.addChild.mock.calls.map(([sprite]) => sprite).filter((sprite) => sprite?.texture)
      expect(sprites).toHaveLength(3)
      expect(sprites.at(-1)?.alpha).toBeCloseTo(0.5)
    } finally {
      vi.stubGlobal('Image', nativeImage)
    }
  })

  it('creates independent audio voices for simultaneous channels sharing one source', async () => {
    const firstAudio = editor.channels.find((channel) => channel.type === 'audio')!
    const secondAudio = editor.addChannel('audio')
    for (const channel of [firstAudio, secondAudio]) {
      editor.addClip(channel.id, {
        fileName: 'shared.m4a',
        scrubBlobUrl: 'blob:shared-audio',
        sourceDuration: 10,
        inPoint: 0,
        outPoint: 5,
        start: 0,
      })
    }
    editor.setCurrentTime(1)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    rafCallback?.(100)

    const voices = document.querySelectorAll('video[data-preview-audio-voice]')
    expect(voices).toHaveLength(2)
    expect(voices[0].getAttribute('data-preview-audio-voice')).not.toBe(
      voices[1].getAttribute('data-preview-audio-voice'),
    )
  })

  it('keeps one media voice across contiguous split halves', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const video = editor.channels.find((channel) => channel.type === 'video')!
    const audio = editor.channels.find((channel) => channel.type === 'audio')!
    for (const channel of [video, audio]) {
      editor.addClip(channel.id, {
        fileName: `continuous.${channel.type === 'video' ? 'mp4' : 'm4a'}`,
        mediaKind: channel.type,
        scrubBlobUrl: `blob:continuous-${channel.type}`,
        sourceDuration: 4,
        inPoint: 0,
        outPoint: 2,
        start: 0,
      })
      editor.addClip(channel.id, {
        fileName: `continuous.${channel.type === 'video' ? 'mp4' : 'm4a'}`,
        mediaKind: channel.type,
        scrubBlobUrl: `blob:continuous-${channel.type}`,
        sourceDuration: 4,
        inPoint: 2,
        outPoint: 4,
        start: 2,
      })
    }
    editor.setCurrentTime(1.9)
    editor.setPlaying(true)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    rafCallback?.(100)
    await new Promise((resolve) => setTimeout(resolve, 0))
    rafCallback?.(301)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.querySelectorAll('video[data-preview-audio-voice]')).toHaveLength(1)
    expect([...document.querySelectorAll('video')].filter((element) => element.src === 'blob:continuous-video')).toHaveLength(1)
    expect(play).toHaveBeenCalledTimes(2)
    play.mockRestore()
  })

  it.each(['video', 'audio'] as const)('reuses loaded %s voices when split clips repeatedly touch and overlap', async (type) => {
    const channel = editor.channels.find((entry) => entry.type === type)!
    editor.addClip(channel.id, {
      fileName: 'shared.mp4', mediaKind: type, scrubBlobUrl: 'blob:drag-source',
      sourceDuration: 4, inPoint: 0, outPoint: 2, start: 0,
    })
    const right = editor.addClip(channel.id, {
      fileName: 'shared.mp4', mediaKind: type, scrubBlobUrl: 'blob:drag-source',
      sourceDuration: 4, inPoint: 2, outPoint: 4, start: 1,
    })
    render(Preview)
    await tick()
    const voices = [...document.querySelectorAll('video')]
    expect(voices).toHaveLength(2)

    for (const start of [2, 1, 2, 1]) {
      editor.getClipById(right.id)!.clip.start = start
      await tick()
      rafCallback?.(100)
      expect([...document.querySelectorAll('video')]).toEqual(voices)
      expect(voices.every((voice) => voice.src === 'blob:drag-source')).toBe(true)
    }

    editor.removeClip(channel.id, right.id)
    await tick()
    rafCallback?.(100)
    expect(document.querySelectorAll('video')).toHaveLength(1)
    expect(voices[1].isConnected).toBe(false)
  })

  it('lets creators switch between whole-image fitting and centered cropping', async () => {
    const { getByRole } = render(Preview)
    const framing = getByRole('combobox', { name: 'Video framing' })
    expect(framing).toHaveValue('contain')
    await fireEvent.change(framing, { target: { value: 'cover' } })
    expect(editor.videoFit).toBe('cover')
    expect(framing).toHaveValue('cover')
    await fireEvent.keyDown(framing, { key: 'ArrowRight' })
    await fireEvent.keyDown(framing, { key: ' ' })
    expect(editor.currentTime).toBe(0)
    expect(editor.playing).toBe(false)
    await fireEvent.change(framing, { target: { value: 'contain' } })
    expect(editor.videoFit).toBe('contain')
  })

  it('does not merge touching clips with discontinuous source windows', async () => {
    const audio = editor.channels.find((channel) => channel.type === 'audio')!
    for (const sourceRange of [[0, 2], [3, 5]] as const) {
      editor.addClip(audio.id, {
        fileName: 'discontinuous.m4a',
        mediaKind: 'audio',
        scrubBlobUrl: 'blob:discontinuous-audio',
        sourceDuration: 5,
        inPoint: sourceRange[0],
        outPoint: sourceRange[1],
        start: sourceRange[0] === 0 ? 0 : 2,
      })
    }
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(document.querySelectorAll('video[data-preview-audio-voice]')).toHaveLength(2)
  })

  it('clamps boosted clip volume while using the media-element fallback', async () => {
    const audio = editor.channels.find((channel) => channel.type === 'audio')!
    editor.addClip(audio.id, {
      fileName: 'boosted.m4a',
      scrubBlobUrl: 'blob:boosted-audio',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
      volume: 104,
    })
    editor.setCurrentTime(1)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(() => rafCallback?.(100)).not.toThrow()
    const voice = document.querySelector('video[data-preview-audio-voice]') as HTMLVideoElement
    expect(voice.volume).toBe(1)
  })

  it('maps timeline time to source time and sets original media playback rate', async () => {
    const audio = editor.channels.find((channel) => channel.type === 'audio')!
    editor.addClip(audio.id, {
      fileName: 'fast.m4a',
      scrubBlobUrl: 'blob:fast-audio',
      sourceDuration: 10,
      inPoint: 1,
      outPoint: 9,
      start: 0,
      playbackRate: 2,
    })
    editor.setCurrentTime(1.5)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    rafCallback?.(100)

    const voice = document.querySelector('video[data-preview-audio-voice]') as HTMLVideoElement
    expect(voice.currentTime).toBe(4)
    expect(voice.playbackRate).toBe(2)
  })

  it('plays original media live in Pixi with clip rate (no baked blob)', async () => {
    const videoChannel = editor.channels.find((channel) => channel.type === 'video')!
    editor.addClip(videoChannel.id, {
      fileName: 'effect.mp4',
      scrubBlobUrl: 'blob:effect-source',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 8,
      start: 0,
      playbackRate: 2,
    })
    renderMocks.nodes = []
    renderMocks.topNode = null
    editor.setCurrentTime(1.5)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    rafCallback?.(100)

    const original = [...document.querySelectorAll('video')]
      .find((element) => element.src === 'blob:effect-source')
    expect(original).toBeTruthy()
    expect(original?.currentTime).toBe(3)
    expect(original?.playbackRate).toBe(2)
    expect([...document.querySelectorAll('video')].some((element) => element.src === 'blob:effect-output')).toBe(false)
  })

  it('switches cached video when the clip source changes (no node blobs)', async () => {
    const videoChannel = editor.channels.find((channel) => channel.type === 'video')!
    const clip = editor.addClip(videoChannel.id, {
      fileName: 'retry.mp4',
      scrubBlobUrl: 'blob:retry-source',
      sourceDuration: 4,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    renderMocks.nodes = []
    renderMocks.topNode = null
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect([...document.querySelectorAll('video')].some((element) => element.src === 'blob:retry-source')).toBe(true)

    editor.getClipById(clip.id)!.clip.scrubBlobUrl = 'blob:retry-output'
    rafCallback?.(100)

    expect([...document.querySelectorAll('video')].some((element) => element.src === 'blob:retry-source')).toBe(false)
    expect([...document.querySelectorAll('video')].some((element) => element.src === 'blob:retry-output')).toBe(true)
  })

  it('releases changed inactive media and reloads it only when it is needed', async () => {
    const channel = editor.channels.find((entry) => entry.type === 'video')!
    const clip = editor.addClip(channel.id, {
      fileName: 'source.mp4', scrubBlobUrl: 'blob:old-source',
      sourceDuration: 4, inPoint: 0, outPoint: 4, start: 0,
    })
    render(Preview)
    await tick()
    const original = document.querySelector('video')!
    Object.defineProperties(original, {
      readyState: { value: HTMLMediaElement.HAVE_ENOUGH_DATA },
      videoWidth: { value: 640 },
      videoHeight: { value: 360 },
    })
    rafCallback?.(100)
    expect(pixiMocks.textureFrom).toHaveBeenCalled()

    editor.setCurrentTime(5)
    editor.getClipById(clip.id)!.clip.scrubBlobUrl = 'blob:new-source'
    await tick()

    expect(original.isConnected).toBe(false)
    expect(document.querySelector('video')).toBeNull()
    expect(pixiMocks.spriteDestroy).toHaveBeenCalled()
    editor.setCurrentTime(0)
    await tick()
    expect(document.querySelector('video')?.src).toBe('blob:new-source')
  })

  it('loads only nearby media when a timeline has hundreds of recordings', async () => {
    for (const channel of editor.channels) {
      for (let i = 0; i < 200; i++) {
        editor.addClip(channel.id, {
          fileName: `recording-${i}.mp4`, scrubBlobUrl: `blob:recording-${i}`,
          sourceDuration: 5, inPoint: 0, outPoint: 5, start: i * 5,
        })
      }
    }
    render(Preview)
    await tick()
    expect(document.querySelectorAll('video')).toHaveLength(2)
    editor.setCurrentTime(497)
    await tick()
    rafCallback?.(100)
    expect(document.querySelectorAll('video')).toHaveLength(2)
    expect([...document.querySelectorAll('video')].every(video => video.src === 'blob:recording-99')).toBe(true)
  })

  it('releases cached original video when its clip disappears', async () => {
    const videoChannel = editor.channels.find((channel) => channel.type === 'video')!
    const clip = editor.addClip(videoChannel.id, {
      fileName: 'removed.mp4',
      scrubBlobUrl: 'blob:removed-output',
      sourceDuration: 4,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect([...document.querySelectorAll('video')].some((element) => element.src === 'blob:removed-output')).toBe(true)

    editor.removeClip(videoChannel.id, clip.id)
    rafCallback?.(100)

    expect([...document.querySelectorAll('video')].some((element) => element.src === 'blob:removed-output')).toBe(false)
  })

  it('applies a ramped effect live as Pixi filters on one layer', async () => {
    const videoChannel = editor.channels.find((channel) => channel.type === 'video')!
    editor.addClip(videoChannel.id, {
      fileName: 'ramp.mp4',
      scrubBlobUrl: 'blob:ramp-source',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 8,
      start: 0,
      playbackRate: 2,
    })
    editor.addEffectBlock(videoChannel.id, 'sepia', 0, 4)
    renderMocks.nodes = []
    renderMocks.topNode = null
    editor.setCurrentTime(1)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    const original = [...document.querySelectorAll('video')]
      .find((element) => element.src === 'blob:ramp-source')!
    Object.defineProperty(original, 'readyState', { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA })
    Object.defineProperty(original, 'videoWidth', { configurable: true, value: 1920 })
    Object.defineProperty(original, 'videoHeight', { configurable: true, value: 1080 })
    const drawnTimes: number[] = []
    pixiMocks.drawImage.mockImplementation((source) => {
      if (source === original) drawnTimes.push(original.currentTime)
    })
    pixiMocks.addChild.mockClear()
    rafCallback?.(100)

    expect(original.currentTime).toBe(2)
    expect(original.playbackRate).toBe(2)
    expect(drawnTimes[0]).toBe(2)

    const sprites = pixiMocks.addChild.mock.calls.map(([sprite]) => sprite)
    expect(sprites).toHaveLength(1)
    expect(sprites[0].alpha).toBe(1)
    expect(sprites[0].filters.length).toBeGreaterThan(0)
  })

  it.each(['effect', 'style'] as const)('updates a held frame with a new %s while a cut video is seeking', async (treatment) => {
    const channel = editor.channels.find((candidate) => candidate.type === 'video')!
    const clip = editor.addClip(channel.id, {
      fileName: 'long.mp4', scrubBlobUrl: 'blob:long-video', sourceDuration: 180,
      inPoint: 0, outPoint: 180, start: 0,
    })
    editor.setCurrentTime(1)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const video = [...document.querySelectorAll('video')].find((element) => element.src === 'blob:long-video')!
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA },
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    })
    rafCallback?.(100)
    const heldSprite = pixiMocks.addChild.mock.calls.map(([child]) => child).find((child) => child?.texture)
    expect(heldSprite.filters).toHaveLength(0)

    const right = editor.splitClip(clip.id, 5)!
    editor.splitClip(right.id, 10)
    editor.setCurrentTime(7)
    Object.defineProperty(video, 'seeking', { configurable: true, value: true })
    if (treatment === 'effect') {
      const block = editor.addEffectBlock(channel.id, 'grayscale', 5, 5)!
      editor.anchorEffectBlock(block.id, 7)
    } else {
      editor.applyClipLook(right.id, 'sepia-strobe')
    }
    pixiMocks.addChild.mockClear()
    pixiMocks.drawImage.mockClear()
    rafCallback?.(116)

    expect(pixiMocks.addChild).toHaveBeenCalledWith(heldSprite)
    expect(heldSprite.filters.length).toBeGreaterThan(0)
    expect(pixiMocks.drawImage).not.toHaveBeenCalled()
    if (treatment === 'effect') {
      editor.moveEffectBlock(editor.effectBlocks[0].id, 15)
      rafCallback?.(132)
      expect(heldSprite.filters).toHaveLength(0)
    }
  })

  it('waits for an in-flight seek before requesting the latest playback position', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const channel = editor.channels.find((candidate) => candidate.type === 'video')!
    editor.addClip(channel.id, {
      fileName: 'slow.mp4', scrubBlobUrl: 'blob:slow-video', sourceDuration: 180,
      inPoint: 0, outPoint: 180, start: 0,
    })
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const video = [...document.querySelectorAll('video')].find((element) => element.src === 'blob:slow-video')!
    let decodedTime = 0
    let seeking = false
    const seek = vi.fn(() => { seeking = true })
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => decodedTime, set: seek },
      seeking: { configurable: true, get: () => seeking },
    })
    editor.setCurrentTime(5)
    editor.setPlaying(true)
    rafCallback?.(100)
    expect(seek).toHaveBeenCalledTimes(1)

    rafCallback?.(116)
    rafCallback?.(132)
    expect(seek).toHaveBeenCalledTimes(1)

    editor.setPlaying(false)
    editor.setCurrentTime(10)
    rafCallback?.(148)
    expect(seek).toHaveBeenCalledTimes(1)
    decodedTime = 5
    seeking = false
    video.dispatchEvent(new Event('seeked'))
    expect(seek).toHaveBeenCalledTimes(2)
    expect(seek).toHaveBeenLastCalledWith(10)
    play.mockRestore()
  })

  it('prewarms the earliest upcoming cut once without interrupting its pending seek', async () => {
    const channel = editor.channels.find((candidate) => candidate.type === 'video')!
    editor.addClip(channel.id, {
      fileName: 'outgoing.mp4', scrubBlobUrl: 'blob:outgoing', sourceDuration: 2,
      inPoint: 0, outPoint: 2, start: 0,
    })
    for (const offset of [0, 0.25]) {
      editor.addClip(channel.id, {
        fileName: 'incoming.mp4', scrubBlobUrl: 'blob:incoming', sourceDuration: 180,
        inPoint: 20 + offset, outPoint: 20.25 + offset, start: 2 + offset,
      })
    }
    editor.setCurrentTime(1.5)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const video = [...document.querySelectorAll('video')].find((element) => element.src === 'blob:incoming')!
    let decodedTime = 0
    let seeking = true
    const seek = vi.fn(() => { seeking = true })
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => decodedTime, set: seek },
      seeking: { configurable: true, get: () => seeking },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_METADATA },
    })

    rafCallback?.(100)
    expect(seek).not.toHaveBeenCalled()
    seeking = false
    rafCallback?.(116)
    expect(seek).toHaveBeenCalledExactlyOnceWith(20)

    decodedTime = 20
    seeking = false
    rafCallback?.(132)
    expect(seek).toHaveBeenCalledTimes(1)
  })

  it('re-seeks a previously requested position when the decoded video has drifted', async () => {
    const channel = editor.channels.find((candidate) => candidate.type === 'video')!
    editor.addClip(channel.id, {
      fileName: 'drift.mp4', scrubBlobUrl: 'blob:drift-video', sourceDuration: 180,
      inPoint: 0, outPoint: 180, start: 0,
    })
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const video = [...document.querySelectorAll('video')].find((element) => element.src === 'blob:drift-video')!
    let decodedTime = 0
    let seeking = false
    const seek = vi.fn(() => { seeking = true })
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => decodedTime, set: seek },
      seeking: { configurable: true, get: () => seeking },
    })
    editor.setCurrentTime(5)
    rafCallback?.(100)
    expect(seek).toHaveBeenCalledExactlyOnceWith(5)
    decodedTime = 5
    seeking = false
    video.dispatchEvent(new Event('seeked'))
    expect(seek).toHaveBeenCalledTimes(1)

    decodedTime = 6
    rafCallback?.(116)
    expect(seek).toHaveBeenCalledTimes(2)
    expect(seek).toHaveBeenLastCalledWith(5)
  })

  it('plays overlapping audio live with per-clip rates during a transition', async () => {
    const audioChannel = editor.channels.find((channel) => channel.type === 'audio')!
    const left = editor.addClip(audioChannel.id, {
      fileName: 'left.m4a',
      scrubBlobUrl: 'blob:left-audio',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 8,
      start: 0,
      playbackRate: 2,
    })
    const right = editor.addClip(audioChannel.id, {
      fileName: 'right.m4a',
      scrubBlobUrl: 'blob:right-audio',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 8,
      start: 1,
      playbackRate: 2,
    })
    // Audio transitions are live (no prerendered acrossfade blob): both sides
    // stay audible with a gain crossfade at their own clip rates.
    renderMocks.transitionNodes = []
    renderMocks.transitionNode = null
    editor.setCurrentTime(1.5)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    rafCallback?.(100)

    expect(document.querySelector(
      'video[data-preview-audio-voice="transition:transition-node"]',
    )).toBeNull()
    const voices = [...document.querySelectorAll('video[data-preview-audio-voice]')]
    expect(voices).toHaveLength(2)
    const bySrc = new Map(voices.map((element) => [(element as HTMLVideoElement).src, element as HTMLVideoElement]))
    // t=1.5 timeline -> left source 0 + 1.5*2 = 3, right source 0 + 0.5*2 = 1
    expect(bySrc.get('blob:left-audio')?.currentTime).toBe(3)
    expect(bySrc.get('blob:left-audio')?.playbackRate).toBe(2)
    expect(bySrc.get('blob:right-audio')?.currentTime).toBe(1)
    expect(bySrc.get('blob:right-audio')?.playbackRate).toBe(2)
    expect(left).toBeTruthy()
    expect(right).toBeTruthy()
  })

  it('retries an audio voice when media playback is initially rejected', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
    const audio = editor.channels.find((channel) => channel.type === 'audio')!
    editor.addClip(audio.id, {
      fileName: 'retry.m4a',
      scrubBlobUrl: 'blob:retry-audio',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    editor.setPlaying(true)
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))

    rafCallback?.(100)
    await new Promise((resolve) => setTimeout(resolve, 0))
    rafCallback?.(116)

    expect(play).toHaveBeenCalledTimes(2)
    play.mockRestore()
  })

  it('removes playback voices for clips deleted from the timeline', async () => {
    const audio = editor.channels.find((channel) => channel.type === 'audio')!
    const clip = editor.addClip(audio.id, {
      fileName: 'removed.m4a',
      scrubBlobUrl: 'blob:removed-audio',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    render(Preview)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(document.querySelectorAll('video[data-preview-audio-voice]')).toHaveLength(1)

    editor.removeClip(audio.id, clip.id)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(document.querySelectorAll('video[data-preview-audio-voice]')).toHaveLength(0)
  })

  it('play button toggles between play and pause icons', async () => {
    editor.setPlaying(false)
    render(Preview)
    await new Promise((r) => setTimeout(r, 10))
    const buttons = document.querySelectorAll('button.cbtn')
    const playBtn = buttons[0]
    expect(playBtn?.getAttribute('aria-label')).toBe('Play preview')
    editor.setPlaying(true)
    await new Promise((r) => setTimeout(r, 10))
    expect(playBtn?.getAttribute('aria-label')).toBe('Pause preview')
  })

  it('mute button toggles mute icon', async () => {
    const { container } = render(Preview)
    const muteBtn = container.querySelectorAll<HTMLButtonElement>('button.cbtn')[1]
    const initialLabel = muteBtn?.getAttribute('aria-label')
    await muteBtn?.click()
    await new Promise((r) => setTimeout(r, 10))
    expect(muteBtn?.getAttribute('aria-label')).not.toBe(initialLabel)
  })

  it('ArrowLeft key moves playhead backward by one frame', async () => {
    editor.setCurrentTime(2)
    editor.setFps(30)
    render(Preview)
    await new Promise((r) => setTimeout(r, 20))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(editor.currentTime).toBeCloseTo(2 - 1 / 30)
  })

  it('ArrowRight key moves playhead forward by one frame', async () => {
    editor.setCurrentTime(2)
    editor.setFps(30)
    render(Preview)
    await new Promise((r) => setTimeout(r, 20))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(editor.currentTime).toBeCloseTo(2 + 1 / 30)
  })

  it('ArrowLeft key does not move playhead below 0', async () => {
    editor.setCurrentTime(0)
    editor.setFps(30)
    render(Preview)
    await new Promise((r) => setTimeout(r, 20))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(editor.currentTime).toBe(0)
  })

  it('M key triggers mute toggle', async () => {
    const { container } = render(Preview)
    await new Promise((r) => setTimeout(r, 20))
    const muteBtn = container.querySelectorAll<HTMLButtonElement>('button.cbtn')[1]
    const beforeLabel = muteBtn?.getAttribute('aria-label')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))
    await new Promise((r) => setTimeout(r, 10))
    expect(muteBtn?.getAttribute('aria-label')).not.toBe(beforeLabel)
  })
})
