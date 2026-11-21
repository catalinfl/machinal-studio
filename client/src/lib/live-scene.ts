import { downloadFile } from './api'
import { validateEmbeddedSceneImages } from './scene-images'
import { validateEmbeddedSceneVideos } from './scene-videos'
import { validateSceneParameters, type SceneParameters } from './scene-parameters'
import { validateEmbeddedSceneModels } from './scene-models'

export interface LiveSceneSource {
  version: 1
  component: string
  explanation?: string
  text?: string
  visualMode?: 'auto' | '2d' | '3d'
  javascript: string
  config: { width: number; height: number; fps: number; durationInFrames: number; transparent?: boolean; captionSafeBottom?: number }
  audio?: { file: string; start: number; duration: number }
  images?: Record<string, string>
  videos?: Record<string, string>
  parameters?: SceneParameters
  models?: Record<string, string>
  environmentVersion?: number
}

const sources = new Map<string, Promise<LiveSceneSource>>()

export function isLiveSceneFile(file: string): boolean {
  return /^ai_scene_[a-f0-9]{32}_\d{2}\.scene\.json$/.test(file)
}

export function parseLiveScene(value: unknown): LiveSceneSource {
  const source = value as LiveSceneSource
  const config = source?.config
  if (source?.version !== 1 || !source.component || !source.javascript || !config
    || ![config.width, config.height, config.fps, config.durationInFrames].every(Number.isFinite)
    || ![config.width, config.height, config.durationInFrames].every(Number.isInteger)
    || config.width < 2 || config.height < 2 || config.width > 1920 || config.height > 1920
    || config.width % 2 || config.height % 2 || config.fps < 1 || config.fps > 60
    || config.durationInFrames < 1 || config.durationInFrames / config.fps > 60
    || config.transparent !== undefined && typeof config.transparent !== 'boolean'
    || config.captionSafeBottom !== undefined && (!Number.isFinite(config.captionSafeBottom) || config.captionSafeBottom < 0 || config.captionSafeBottom > 0.5)) {
    throw new Error('The generated scene source is invalid. Generate this scene again.')
  }
  validateEmbeddedSceneImages(source.images)
  validateEmbeddedSceneVideos(source.videos)
  validateSceneParameters(source.parameters)
  validateEmbeddedSceneModels(source.models)
  return source
}

export function rememberLiveScene(file: string, source: LiveSceneSource): void {
  sources.set(file, Promise.resolve(parseLiveScene(source)))
}

export function forgetLiveScene(file: string): void {
  sources.delete(file)
}

export function loadLiveScene(file: string): Promise<LiveSceneSource> {
  let pending = sources.get(file)
  if (!pending) {
    pending = downloadFile(file).then(blob => blob.text()).then(text => parseLiveScene(JSON.parse(text)))
    sources.set(file, pending)
    pending.catch(() => { if (sources.get(file) === pending) sources.delete(file) })
  }
  return pending
}

export function liveSceneFrame(source: LiveSceneSource, time: number): number {
  return Math.max(0, Math.min(source.config.durationInFrames - 1, Math.floor(time * source.config.fps + 0.00001)))
}

export class LiveScenePlayer {
  readonly iframe = document.createElement('iframe')
  readonly channel = crypto.randomUUID()
  #sequence = 0
  #disposed = false
  #pending = new Map<number, { resolve: (bitmap?: ImageBitmap) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  #loading: Promise<void>
  #rejectLoading?: (error: Error) => void
  #presentation?: Promise<void>
  #latestPresentation?: { frame: number; playing: boolean; playbackRate: number; matrices: number[][] }
  #presented = ''
  #renderScale = 1

  constructor(readonly source: LiveSceneSource, parent: HTMLElement) {
    this.iframe.title = 'Live generated scene'
    this.iframe.tabIndex = -1
    this.iframe.setAttribute('sandbox', 'allow-scripts')
    this.iframe.style.cssText = `border:0;display:block;width:${source.config.width}px;height:${source.config.height}px;transform-origin:top left;pointer-events:none;background:transparent;color-scheme:normal`
    const script = `data:application/javascript;base64,${btoa(Array.from(new TextEncoder().encode(source.javascript), byte => String.fromCharCode(byte)).join(''))}`
    this.iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src blob:; base-uri 'none'; form-action 'none'"><style>html,body,#scene{margin:0;width:100%;height:100%;overflow:hidden}*{box-sizing:border-box}</style></head><body><div id="scene"></div><script src="${script}"></script></body></html>`
    window.addEventListener('message', this.#receive)
    this.#loading = new Promise<void>((resolve, reject) => {
      this.#rejectLoading = reject
      this.iframe.onload = () => { this.#send('init').then(() => resolve(), reject) }
      this.iframe.onerror = () => reject(new Error('The scene preview could not load.'))
    })
    parent.appendChild(this.iframe)
  }

  #receive = (event: MessageEvent): void => {
    const data = event.data
    if (event.source !== this.iframe.contentWindow || data?.type !== 'live-scene:response' || data.channel !== this.channel) return
    const pending = this.#pending.get(data.id)
    if (!pending) { data.bitmap?.close(); return }
    clearTimeout(pending.timer)
    this.#pending.delete(data.id)
    if (data.error) pending.reject(new Error(data.error))
    else pending.resolve(data.bitmap)
  }

  #send(method: 'init' | 'seek', frame = 0, capture = false, fullResolution = false, playing = false, playbackRate = 1, matrices: number[][] = []): Promise<ImageBitmap | undefined> {
    if (this.#disposed) return Promise.reject(new Error('Scene preview closed'))
    return new Promise((resolve, reject) => {
      const id = ++this.#sequence
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error('The live scene preview timed out. Generate this scene again.'))
      }, 15000)
      this.#pending.set(id, { resolve, reject, timer })
      this.iframe.contentWindow?.postMessage({ type: 'live-scene:command', channel: this.channel, id, method, frame, capture, fullResolution, playing, playbackRate, matrices, renderScale: fullResolution ? 1 : this.#renderScale, config: { ...this.source.config }, ...(method === 'init' ? { images: { ...this.source.images }, videos: { ...this.source.videos }, parameters: this.source.parameters ?? {}, models: this.source.models ?? {} } : {}) }, '*')
    })
  }

  async ready(): Promise<void> {
    await this.#loading
  }

  setPreviewSize(width: number, height: number): void {
    if (![width, height].every(value => Number.isFinite(value) && value > 0)) return
    this.#renderScale = Math.min(1, width / this.source.config.width, height / this.source.config.height)
  }

  async seek(time: number, capture = false, fullResolution = false): Promise<ImageBitmap | undefined> {
    await this.#loading
    this.#presented = ''
    return this.#send('seek', liveSceneFrame(this.source, time), capture, fullResolution)
  }

  present(time: number, playing = false, playbackRate = 1, matrices: number[][] = []): Promise<void> {
    this.#latestPresentation = { frame: liveSceneFrame(this.source, time), playing, playbackRate, matrices }
    if (!this.#presentation) {
      this.#presentation = this.#presentLatest().finally(() => { this.#presentation = undefined })
    }
    return this.#presentation
  }

  async #presentLatest(): Promise<void> {
    await this.#loading
    while (this.#latestPresentation && !this.#disposed) {
      const next = this.#latestPresentation
      const signature = `${next.frame}:${next.playing}:${next.playbackRate}:${this.#renderScale}:${JSON.stringify(next.matrices)}`
      if (signature === this.#presented) return
      await this.#send('seek', next.frame, false, false, next.playing, next.playbackRate, next.matrices)
      this.#presented = signature
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#rejectLoading?.(new Error('Scene preview closed'))
    window.removeEventListener('message', this.#receive)
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Scene preview closed'))
    }
    this.#pending.clear()
    this.iframe.remove()
  }
}
